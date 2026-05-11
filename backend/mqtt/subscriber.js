/**
 * MQTT Subscriber for FloodGuard Sensor Data
 * 
 * Listens to MQTT topics from ESP32 sensors and stores data in MySQL database.
 * 
 * Topic format:
 * - {prefix}/sensor/{device_id}/data (legacy)
 * - sensor/ultrasonic (ESP32 simple topic)
 * 
 * Expected payload (JSON):
 * {
 *   "water_level": 45.2,        // Preferred: water level in cm
 *   "distance_cm": 150.5,       // Optional: raw ultrasonic distance
 *   "device_id": "SENSOR-001", // Required for simple topic, optional for legacy topic
 *   "battery_level": 85,        // Optional: battery percentage (0-100)
 *   "signal_strength": -67      // Optional: WiFi signal in dBm
 * }
 */

const mqtt = require('mqtt');
const pool = require('../config/db');

// Configuration from environment variables
const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
const MQTT_USERNAME = process.env.MQTT_USERNAME || '';
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || '';
const MQTT_TOPIC_PREFIX = process.env.MQTT_TOPIC_PREFIX || 'floodguard';
const MQTT_SIMPLE_TOPIC = process.env.MQTT_SIMPLE_TOPIC || 'sensor/ultrasonic';
const MQTT_DEFAULT_DEVICE_ID = process.env.MQTT_DEFAULT_DEVICE_ID || 'SENSOR-001';
// Tinggi pemasangan sensor dari dasar sungai (cm).
// Sensor ultrasonic membaca JARAK sensor ke permukaan air, sedangkan sistem/model ML butuh TINGGI AIR.
// Jika tinggi sensor dari dasar sungai = 100 cm dan jarak terbaca = 30 cm,
// maka tinggi air = 100 - 30 = 70 cm.
const MQTT_SENSOR_HEIGHT_CM = process.env.MQTT_SENSOR_HEIGHT_CM || 100;

// Topic pattern: floodguard/sensor/+/data (+ is wildcard for device_id)
const SENSOR_DATA_TOPIC = `${MQTT_TOPIC_PREFIX}/sensor/+/data`;

let client = null;

/**
 * Tentukan status dari TINGGI AIR sungai (bukan jarak ultrasonic).
 * Untuk sungai/skala 100 cm:
 * - < 60 cm  = aman
 * - 60-79 cm = siaga
 * - >= 80 cm = bahaya
 */
const STATUS_ALERT_WATER_LEVEL_CM = Number(process.env.STATUS_ALERT_WATER_LEVEL_CM || 60);
const STATUS_DANGER_WATER_LEVEL_CM = Number(process.env.STATUS_DANGER_WATER_LEVEL_CM || 80);

function getWaterStatus(waterLevelCm) {
  if (!Number.isFinite(waterLevelCm)) return 'safe';
  if (waterLevelCm >= STATUS_DANGER_WATER_LEVEL_CM) return 'danger';
  if (waterLevelCm >= STATUS_ALERT_WATER_LEVEL_CM) return 'alert';
  return 'safe';
}

/**
 * Extract device_id from topic
 * Topic format: floodguard/sensor/{device_id}/data
 */
function extractDeviceId(topic) {
  const parts = topic.split('/');
  // parts[0] = floodguard, parts[1] = sensor, parts[2] = device_id, parts[3] = data
  if (parts.length >= 4 && parts[1] === 'sensor' && parts[3] === 'data') {
    return parts[2];
  }
  return null;
}

function toNullableNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveWaterLevel(payload) {
  const waterLevel = toNullableNumber(payload.water_level);
  if (waterLevel !== null) return waterLevel;

  const distanceCm = toNullableNumber(payload.distance_cm);
  if (distanceCm === null) return null;

  const payloadSensorHeight = toNullableNumber(payload.sensor_height_cm);
  const envSensorHeight = toNullableNumber(MQTT_SENSOR_HEIGHT_CM);
  const sensorHeight = payloadSensorHeight ?? envSensorHeight;

  if (sensorHeight !== null) {
    return Math.max(0, Number((sensorHeight - distanceCm).toFixed(2)));
  }

  return distanceCm;
}

async function ensureDeviceExists(deviceId) {
  const [rows] = await pool.execute('SELECT id FROM devices WHERE id = ? LIMIT 1', [deviceId]);
  if (rows.length > 0) return;

  await pool.execute(
    `INSERT INTO devices (id, name, description, status)
     VALUES (?, ?, ?, 'active')`,
    [deviceId, `Device ${deviceId}`, 'Auto-created from MQTT subscriber']
  );

  console.log(`[MQTT] Device created automatically: ${deviceId}`);
}

/**
 * Save sensor data to database
 */
async function saveSensorData(deviceId, data) {
  try {
    const waterLevel = resolveWaterLevel(data);
    const distanceCm = toNullableNumber(data.distance_cm);
    const batteryLevel = toNullableNumber(data.battery_level);
    const signalStrength = toNullableNumber(data.signal_strength);
    
    if (waterLevel === null) {
      console.error(`[MQTT] Invalid payload from ${deviceId}: water_level/distance_cm missing or invalid`);
      return false;
    }

    await ensureDeviceExists(deviceId);

    const waterStatus = getWaterStatus(waterLevel);
    
    const query = `
      INSERT INTO sensor_data (device_id, water_level, distance_cm, battery_level, signal_strength, water_status)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    
    const values = [
      deviceId,
      waterLevel,
      distanceCm,
      batteryLevel,
      signalStrength,
      waterStatus
    ];

    await pool.execute(query, values);
    
    console.log(`[MQTT] Data saved: ${deviceId} - water_level: ${waterLevel}cm (${waterStatus})`);
    return true;
  } catch (error) {
    console.error(`[MQTT] Error saving data for ${deviceId}:`, error.message);
    return false;
  }
}

/**
 * Handle incoming MQTT messages
 */
function handleMessage(topic, message) {
  try {
    const payload = JSON.parse(message.toString());
    const deviceIdFromTopic = extractDeviceId(topic);
    const deviceId = payload.device_id || deviceIdFromTopic || MQTT_DEFAULT_DEVICE_ID;
    
    if (!deviceId) {
      console.warn(`[MQTT] Could not extract device_id from topic: ${topic}`);
      return;
    }
    
    console.log(`[MQTT] Received from ${deviceId}:`, payload);

    // Save to database
    saveSensorData(deviceId, payload);
    
  } catch (error) {
    console.error('[MQTT] Error processing message:', error.message);
  }
}

/**
 * Connect to MQTT broker and start listening
 */
function connect() {
  console.log(`[MQTT] Connecting to broker: ${MQTT_BROKER_URL}`);

  const connectOptions = {
    clientId: `floodguard-server-${Date.now()}`,
    clean: true,
    connectTimeout: 4000,
    reconnectPeriod: 5000, // Auto-reconnect every 5 seconds
  };

  if (MQTT_USERNAME || MQTT_PASSWORD) {
    connectOptions.username = MQTT_USERNAME;
    connectOptions.password = MQTT_PASSWORD;
  }

  client = mqtt.connect(MQTT_BROKER_URL, connectOptions);

  client.on('connect', () => {
    console.log('[MQTT] Connected to broker');

    const topics = [SENSOR_DATA_TOPIC, MQTT_SIMPLE_TOPIC];
    topics.forEach((topic) => {
      client.subscribe(topic, { qos: 1 }, (err) => {
        if (err) {
          console.error(`[MQTT] Subscribe error for ${topic}:`, err);
        } else {
          console.log(`[MQTT] Subscribed to: ${topic}`);
        }
      });
    });
  });

  client.on('message', handleMessage);

  client.on('error', (error) => {
    console.error('[MQTT] Connection error:', error.message);
  });

  client.on('close', () => {
    console.log('[MQTT] Connection closed');
  });

  client.on('reconnect', () => {
    console.log('[MQTT] Attempting to reconnect...');
  });

  client.on('offline', () => {
    console.log('[MQTT] Client is offline');
  });

  return client;
}

/**
 * Disconnect from MQTT broker
 */
function disconnect() {
  if (client) {
    client.end(true);
    console.log('[MQTT] Disconnected from broker');
  }
}

/**
 * Get connection status
 */
function isConnected() {
  return client && client.connected;
}

module.exports = {
  connect,
  disconnect,
  isConnected
};
