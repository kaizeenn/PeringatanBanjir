require('dotenv').config();
const dns = require('dns');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var cors = require('cors');
var crypto = require('crypto');

try {
  dns.setDefaultResultOrder('ipv4first');
} catch (error) {
  // Keep default DNS order if current Node version does not support this API.
}

var usersRouter = require('./routes/users');
var sensorRouter = require('./routes/sensor');
var externalRouter = require('./routes/external');
var predictionsRouter = require('./routes/predictions');
var externalService = require('./services/externalDataService');
var floodPredictionService = require('./services/floodPrediction');
var db = require('./config/db');
var authRouter = require('./routes/auth');
var authMiddleware = require('./middleware/auth');

// MQTT Subscriber for ESP32 sensor data
var mqttSubscriber = require('./mqtt/subscriber');

var app = express();
var frontendDistPath = path.join(__dirname, '..', 'frontend', 'dist');
var internalSchedulerToken = process.env.INTERNAL_API_TOKEN || crypto.randomUUID();

app.set('etag', false);

app.use(cors());
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});
app.use(express.static(frontendDistPath));

app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/sensor-data', authMiddleware, sensorRouter);
app.use('/api/external', authMiddleware, externalRouter);
app.use('/api/predictions', (req, res, next) => {
  if (req.get('x-internal-scheduler-token') === internalSchedulerToken) {
    return next();
  }

  return authMiddleware(req, res, next);
}, predictionsRouter);

app.get('*', function(req, res, next) {
  if (req.path.startsWith('/api/')) {
    return next();
  }

  res.sendFile(path.join(frontendDistPath, 'index.html'));
});

// Start MQTT subscriber
mqttSubscriber.connect();

function getIntervalMs(envKey, fallbackMs) {
  var rawValue = Number(process.env[envKey]);
  if (!Number.isFinite(rawValue) || rawValue <= 0) return fallbackMs;
  return rawValue;
}

function shouldEnableScheduler() {
  var value = String(process.env.ENABLE_EXTERNAL_SCHEDULER || '').toLowerCase();
  if (!value) return true;
  return value !== 'false' && value !== '0' && value !== 'off';
}

async function hasRecentPrediction() {
  try {
    var rows = await db.query('SELECT id FROM flood_predictions ORDER BY prediction_time DESC, id DESC LIMIT 1');
    return rows[0].length > 0;
  } catch (error) {
    return false;
  }
}

async function buildPredictionInputFromDatabase() {
  var sensorRows = await db.query(
    `SELECT device_id, water_level AS water_level_cm
     FROM sensor_data
     ORDER BY created_at DESC, id DESC
     LIMIT 1`
  );
  var weatherRows = await db.query(
    `SELECT rainfall_mm
     FROM weather_data
     ORDER BY forecast_date DESC, COALESCE(forecast_hour, 0) DESC, recorded_at DESC, id DESC
     LIMIT 7`
  );
  var tideRows = await db.query(
    `SELECT tide_level_cm, high_tide_level_cm
     FROM tidal_data
     ORDER BY prediction_date DESC, recorded_at DESC, id DESC
     LIMIT 1`
  );

  var sensor = sensorRows[0][0] || null;
  var weather = weatherRows[0] || [];
  var tide = tideRows[0][0] || null;
  var rainfallValues = weather.map((row) => Number(row.rainfall_mm) || 0);
  var tideCm = Number(tide && (tide.high_tide_level_cm || tide.tide_level_cm)) || 50;
  var waterLevel = Number(sensor && sensor.water_level_cm);

  return {
    device_id: sensor && sensor.device_id ? sensor.device_id : 'AUTO',
    rainfall_mm: rainfallValues[0] || 0,
    rainfall_lag1: rainfallValues[1] || 0,
    rainfall_lag2: rainfallValues[2] || 0,
    rainfall_7day: rainfallValues.reduce((sum, value) => sum + value, 0),
    tide_max_m: tideCm / 100,
    month: new Date().getMonth() + 1,
    ...(Number.isFinite(waterLevel) ? { water_level_cm: waterLevel } : {}),
  };
}

async function runInitialFloodPredictionIfNeeded() {
  if (String(process.env.ML_RUN_ON_STARTUP || 'true').toLowerCase() === 'false') {
    return;
  }

  try {
    if (await hasRecentPrediction()) return;

    var input = await buildPredictionInputFromDatabase();
    var predictionInput = { ...input };
    delete predictionInput.device_id;

    var prediction = await floodPredictionService.runPrediction(predictionInput);
    if (!prediction.success) {
      throw new Error(prediction.error || 'Prediksi ML gagal');
    }

    var meta = floodPredictionService.readModelMeta() || {};
    await db.query(
      `INSERT INTO flood_predictions (
         device_id, prediction_time, prediction_window_hours,
         flood_probability, predicted_level_cm, risk_level,
         model_version, model_name, features_used, confidence_score,
         input_water_level, input_rainfall_mm, input_tide_level_cm,
         is_backwater_risk
       ) VALUES (
         (SELECT id FROM devices WHERE id = ? LIMIT 1), DATE_ADD(NOW(), INTERVAL 1 DAY), 24,
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       )`,
      [
        input.device_id,
        Number(prediction.flood_probability) || 0,
        Number(prediction.water_level_cm) || 0,
        floodPredictionService.getRiskLevelForDb(prediction),
        meta.trained_on || 'local',
        meta.model_type || 'Flood ML',
        JSON.stringify(prediction.input_received || predictionInput),
        Math.max(
          Number(prediction.probability && prediction.probability.aman) || 0,
          Number(prediction.probability && prediction.probability.waspada) || 0,
          Number(prediction.probability && prediction.probability.banjir) || 0
        ),
        Number.isFinite(Number(input.water_level_cm)) ? Number(input.water_level_cm) : null,
        Number(input.rainfall_mm) || 0,
        Number(input.tide_max_m) * 100 || null,
        (Number(input.rainfall_mm) || 0) >= 20 && (Number(input.tide_max_m) || 0) >= 1,
      ]
    );

    console.log('[ML] Initial prediction created for dashboard realtime status');
  } catch (error) {
    console.error('[ML] Initial prediction failed:', error.message);
  }
}

function startExternalScheduler() {
  if (!shouldEnableScheduler()) {
    return;
  }

  var weatherIntervalMs = getIntervalMs('WEATHER_FETCH_INTERVAL_MS', 15 * 60 * 1000);
  var tideIntervalMs = getIntervalMs('TIDE_FETCH_INTERVAL_MS', 60 * 60 * 1000);
  var predictionIntervalMs = getIntervalMs('ML_PREDICTION_INTERVAL_MS', 60 * 60 * 1000);

  var runWeatherFetch = async () => {
    try {
      var config = await externalService.getIntegrationConfig();
      await externalService.fetchWeatherDataWithCooldown(config);
    } catch (error) {
      console.error('Scheduler weather fetch failed:', error.message);
    }
  };

  var runTideFetch = async () => {
    try {
      var config = await externalService.getIntegrationConfig();
      await externalService.fetchTideDataWithCooldown(config);
    } catch (error) {
      console.error('Scheduler tide fetch failed:', error.message);
    }
  };

  var runFloodPrediction = async () => {
    try {
      await fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/predictions/run-auto', {
        method: 'POST',
        headers: {
          'x-internal-scheduler-token': internalSchedulerToken,
        },
      });
    } catch (error) {
      console.error('Scheduler ML prediction failed:', error.message);
    }
  };

  setTimeout(runWeatherFetch, 5000);
  setTimeout(runTideFetch, 7000);
  setTimeout(runFloodPrediction, 10000);
  setInterval(runWeatherFetch, weatherIntervalMs);
  setInterval(runTideFetch, tideIntervalMs);
  setInterval(runFloodPrediction, predictionIntervalMs);
}

startExternalScheduler();
setTimeout(runInitialFloodPredictionIfNeeded, 12000);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  mqttSubscriber.disconnect();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down...');
  mqttSubscriber.disconnect();
  process.exit(0);
});

module.exports = app;
