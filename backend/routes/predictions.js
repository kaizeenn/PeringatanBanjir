const express = require('express');
const router = express.Router();
const db = require('../config/db');

const {
  ML_DIR,
  PYTHON_CMD,
  PYTHON_SCRIPT,
  runPrediction,
  shouldCreateAlert,
  getAlertLevel,
  getRiskLevelForDb,
  getStatusForFrontend,
  buildAlertContent,
  readModelMeta,
} = require('../services/floodPrediction');

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toNullableNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function safeJson(value) {
  if (value == null) return null;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function mapPredictionRow(row) {
  if (!row) return null;

  const probability = toNumber(row.flood_probability, 0);
  const predictedLevel = toNumber(row.predicted_level_cm, 0);
  const inputWaterLevel = toNullableNumber(row.input_water_level);
  const statusByDbRisk = {
    safe: 'safe',
    low: 'safe',
    medium: 'alert',
    high: 'danger',
    critical: 'danger',
  };

  return {
    id: row.id,
    device_id: row.device_id,
    prediction_time: row.prediction_time,
    created_at: row.created_at,
    flood_probability: probability,
    confidence_score: toNumber(row.confidence_score, probability),
    predicted_level_cm: predictedLevel,
    actual_level_cm: inputWaterLevel,
    risk_level: row.risk_level,
    status: statusByDbRisk[row.risk_level] || 'safe',
    model_version: row.model_version,
    model_name: row.model_name,
    input_rainfall_mm: toNullableNumber(row.input_rainfall_mm),
    input_tide_level_cm: toNullableNumber(row.input_tide_level_cm),
  };
}

async function getLatestSensor() {
  const [rows] = await db.query(
    `SELECT device_id, water_level AS water_level_cm, created_at
     FROM sensor_data
     ORDER BY created_at DESC, id DESC
     LIMIT 1`
  );
  return rows[0] || null;
}

async function getRecentWeather(limit = 7) {
  const [rows] = await db.query(
    `SELECT rainfall_mm, forecast_date, forecast_hour, recorded_at
     FROM weather_data
     ORDER BY forecast_date DESC, COALESCE(forecast_hour, 0) DESC, recorded_at DESC, id DESC
     LIMIT ?`,
    [limit]
  );
  return rows;
}

async function getLatestTide() {
  const [rows] = await db.query(
    `SELECT tide_level_cm, high_tide_level_cm, prediction_date, recorded_at
     FROM tidal_data
     ORDER BY prediction_date DESC, recorded_at DESC, id DESC
     LIMIT 1`
  );
  return rows[0] || null;
}

function buildAutoInput(sensor, weather, tide) {
  const rainfallValues = weather.map((row) => toNumber(row.rainfall_mm, 0));
  const tideCm = toNumber(tide?.high_tide_level_cm ?? tide?.tide_level_cm, 50);
  const waterLevel = toNullableNumber(sensor?.water_level_cm);

  return {
    device_id: sensor?.device_id || 'AUTO',
    rainfall_mm: rainfallValues[0] || 0,
    rainfall_lag1: rainfallValues[1] || 0,
    rainfall_lag2: rainfallValues[2] || 0,
    rainfall_7day: rainfallValues.reduce((sum, value) => sum + value, 0),
    tide_max_m: tideCm / 100,
    month: new Date().getMonth() + 1,
    ...(waterLevel != null ? { water_level_cm: waterLevel } : {}),
  };
}

async function resolveDeviceIdForDb(deviceId) {
  if (!deviceId) return null;
  const [rows] = await db.query('SELECT id FROM devices WHERE id = ? LIMIT 1', [deviceId]);
  return rows.length > 0 ? deviceId : null;
}

async function savePrediction({ deviceId, input, prediction }) {
  const meta = readModelMeta();
  const predictionTime = addDays(new Date(), 1);
  const riskLevelDb = getRiskLevelForDb(prediction);
  const deviceIdForDb = await resolveDeviceIdForDb(deviceId);
  const confidence = Math.max(
    toNumber(prediction?.probability?.aman, 0),
    toNumber(prediction?.probability?.waspada, 0),
    toNumber(prediction?.probability?.banjir, 0)
  );

  const [result] = await db.query(
    `INSERT INTO flood_predictions (
       device_id, prediction_time, prediction_window_hours,
       flood_probability, predicted_level_cm, risk_level,
       model_version, model_name, features_used, confidence_score,
       input_water_level, input_rainfall_mm, input_tide_level_cm,
       is_backwater_risk
     ) VALUES (?, ?, 24, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      deviceIdForDb,
      predictionTime,
      toNumber(prediction.flood_probability, 0),
      toNumber(prediction.water_level_cm, 0),
      riskLevelDb,
      meta?.trained_on || 'local',
      meta?.model_type || 'Flood ML',
      safeJson(prediction.input_received || input),
      confidence,
      toNullableNumber(input.water_level_cm),
      toNullableNumber(input.rainfall_mm),
      toNullableNumber(input.tide_max_m) == null ? null : toNumber(input.tide_max_m, 0) * 100,
      toNumber(input.rainfall_mm, 0) >= 20 && toNumber(input.tide_max_m, 0) >= 1,
    ]
  );

  return result.insertId;
}

async function saveAlertIfNeeded({ predictionId, deviceId, prediction }) {
  if (!shouldCreateAlert(prediction)) return null;

  const content = buildAlertContent(prediction);
  const deviceIdForDb = await resolveDeviceIdForDb(deviceId);
  const [result] = await db.query(
    `INSERT INTO alerts (
       prediction_id, device_id, alert_level, alert_type,
       title, message, recommendation,
       is_active, is_sent_web, valid_from, expires_at, triggered_by
     ) VALUES (?, ?, ?, 'prediction', ?, ?, ?, TRUE, FALSE, NOW(), DATE_ADD(NOW(), INTERVAL 24 HOUR), 'ml_prediction')`,
    [
      predictionId,
      deviceIdForDb,
      getAlertLevel(prediction.risk_level),
      content.title,
      content.message,
      content.recommendation,
    ]
  );

  return result.insertId;
}

async function runAndPersist(input) {
  const deviceId = input.device_id || 'MANUAL';
  const predictionInput = { ...input };
  delete predictionInput.device_id;

  const prediction = await runPrediction(predictionInput);
  if (!prediction.success) {
    throw new Error(prediction.error || 'Prediksi ML gagal');
  }

  const predictionId = await savePrediction({ deviceId, input: predictionInput, prediction });
  const alertId = await saveAlertIfNeeded({ predictionId, deviceId, prediction });

  return {
    ...prediction,
    prediction_id: predictionId,
    alert_id: alertId,
    alert_created: Boolean(alertId),
    status: getStatusForFrontend(prediction),
  };
}

router.get('/meta', async (req, res) => {
  res.json({
    message: 'Metadata model ML berhasil diambil',
    data: {
      ml_dir: ML_DIR,
      python_cmd: PYTHON_CMD,
      python_script: PYTHON_SCRIPT,
      model: readModelMeta(),
    },
  });
});

function buildManualInput(body = {}, defaultDeviceId = 'MANUAL') {
  return {
    device_id: body.device_id || defaultDeviceId,
    rainfall_mm: toNumber(body.rainfall_mm, 0),
    rainfall_lag1: toNumber(body.rainfall_lag1, 0),
    rainfall_lag2: toNumber(body.rainfall_lag2, 0),
    rainfall_7day: toNumber(body.rainfall_7day, 0),
    tide_max_m: toNumber(body.tide_max_m, 0.5),
    month: Math.min(Math.max(Math.trunc(toNumber(body.month, new Date().getMonth() + 1)), 1), 12),
    ...(body.water_level_cm !== undefined && body.water_level_cm !== ''
      ? { water_level_cm: toNumber(body.water_level_cm, 0) }
      : {}),
  };
}

router.post('/test', async (req, res) => {
  try {
    const input = buildManualInput(req.body, 'TEST-MODEL');
    const predictionInput = { ...input };
    delete predictionInput.device_id;

    const prediction = await runPrediction(predictionInput);
    if (!prediction.success) {
      return res.status(500).json({ message: 'Gagal menjalankan test model', error: prediction.error });
    }

    res.json({
      message: 'Test model berhasil dijalankan tanpa menyimpan ke database',
      data: {
        ...prediction,
        device_id: input.device_id,
        status: getStatusForFrontend(prediction),
        simulated: true,
        saved_to_database: false,
        alert_created: false,
      },
    });
  } catch (error) {
    console.error('[predictions/test]', error);
    res.status(500).json({ message: 'Gagal menjalankan test model', error: error.message });
  }
});

router.post('/run', async (req, res) => {
  try {
    const input = buildManualInput(req.body, 'MANUAL');
    const result = await runAndPersist(input);

    res.json({
      message: 'Prediksi banjir berhasil dijalankan',
      data: result,
    });
  } catch (error) {
    console.error('[predictions/run]', error);
    res.status(500).json({ message: 'Gagal menjalankan prediksi banjir', error: error.message });
  }
});

router.post('/run-auto', async (req, res) => {
  try {
    const [sensor, weather, tide] = await Promise.all([
      getLatestSensor(),
      getRecentWeather(7),
      getLatestTide(),
    ]);

    const input = buildAutoInput(sensor, weather, tide);
    const result = await runAndPersist(input);

    res.json({
      message: 'Prediksi otomatis berhasil dijalankan',
      data: {
        ...result,
        device_id: input.device_id,
        input,
      },
    });
  } catch (error) {
    console.error('[predictions/run-auto]', error);
    res.status(500).json({ message: 'Gagal menjalankan prediksi otomatis', error: error.message });
  }
});

router.get('/latest', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT *
       FROM flood_predictions
       ORDER BY prediction_time DESC, id DESC
       LIMIT 1`
    );

    res.json({
      message: 'Prediksi terbaru berhasil diambil',
      data: mapPredictionRow(rows[0]),
    });
  } catch (error) {
    res.status(500).json({ message: 'Gagal mengambil prediksi terbaru', error: error.message });
  }
});

router.get('/history', async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 200);
    const [rows] = await db.query(
      `SELECT *
       FROM flood_predictions
       ORDER BY prediction_time DESC, id DESC
       LIMIT ?`,
      [limit]
    );

    res.json({
      message: 'Riwayat prediksi berhasil diambil',
      data: rows.map(mapPredictionRow),
    });
  } catch (error) {
    res.status(500).json({ message: 'Gagal mengambil riwayat prediksi', error: error.message });
  }
});

module.exports = router;
