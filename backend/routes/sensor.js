const express = require('express');
const router = express.Router();
const db = require('../config/db');

// GET semua data sensor
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, device_id, water_level, water_status, created_at FROM sensor_data ORDER BY created_at DESC, id DESC LIMIT 500'
    );

    res.json({
      message: 'Data sensor berhasil diambil',
      data: rows
    });
  } catch (error) {
    res.status(500).json({
      message: 'Gagal mengambil data sensor',
      error: error.message
    });
  }
});

// GET data sensor terbaru per device
router.get('/latest', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT s1.id, s1.device_id, s1.water_level, s1.water_status, s1.created_at
       FROM sensor_data s1
       INNER JOIN (
         SELECT device_id, MAX(id) AS max_id
         FROM sensor_data
         GROUP BY device_id
       ) s2 ON s1.device_id = s2.device_id AND s1.id = s2.max_id
       ORDER BY s1.created_at DESC, s1.id DESC`
    );

    res.json({
      message: 'Data sensor terbaru berhasil diambil',
      data: rows
    });
  } catch (error) {
    res.status(500).json({
      message: 'Gagal mengambil data sensor terbaru',
      error: error.message
    });
  }
});

// GET data sensor berdasarkan device_id
router.get('/:device_id', async (req, res) => {
  try {
    const { device_id } = req.params;
    const [rows] = await db.query(
      'SELECT id, device_id, water_level, water_status, created_at FROM sensor_data WHERE device_id = ? ORDER BY created_at DESC, id DESC LIMIT 500',
      [device_id]
    );

    res.json({
      message: `Data sensor untuk device ${device_id}`,
      data: rows
    });
  } catch (error) {
    res.status(500).json({
      message: 'Gagal mengambil data sensor per device',
      error: error.message
    });
  }
});

function toNullableNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getWaterStatus(waterLevelCm) {
  const alertThreshold = Number(process.env.STATUS_ALERT_WATER_LEVEL_CM || 60);
  const dangerThreshold = Number(process.env.STATUS_DANGER_WATER_LEVEL_CM || 80);

  if (!Number.isFinite(waterLevelCm)) return 'safe';
  if (waterLevelCm >= dangerThreshold) return 'danger';
  if (waterLevelCm >= alertThreshold) return 'alert';
  return 'safe';
}

function resolveWaterLevel(body) {
  const waterLevel = toNullableNumber(body.water_level);
  if (waterLevel !== null) {
    return waterLevel;
  }

  const distanceCm = toNullableNumber(body.distance_cm);
  if (distanceCm === null) {
    return null;
  }

  const sensorHeightCm = toNullableNumber(body.sensor_height_cm) ?? Number(process.env.MQTT_SENSOR_HEIGHT_CM || 100);
  return Math.max(0, Number((sensorHeightCm - distanceCm).toFixed(2)));
}

// POST - terima data dari wokwi / ESP32
router.post('/', async (req, res) => {
  try {
    const { device_id } = req.body;
    const parsedWaterLevel = resolveWaterLevel(req.body);
    const distanceCm = toNullableNumber(req.body.distance_cm);

    if (!device_id || parsedWaterLevel === null) {
      return res.status(400).json({
        message: 'Data tidak lengkap. Kirim device_id dan water_level atau distance_cm.'
      });
    }

    const waterStatus = getWaterStatus(parsedWaterLevel);

    const [result] = await db.query(
      'INSERT INTO sensor_data (device_id, water_level, distance_cm, water_status) VALUES (?, ?, ?, ?)',
      [device_id, parsedWaterLevel, distanceCm, waterStatus]
    );

    const [insertedRows] = await db.query(
      'SELECT id, device_id, water_level, water_status, created_at FROM sensor_data WHERE id = ?',
      [result.insertId]
    );

    res.json({
      message: 'Data berhasil diterima',
      data: insertedRows[0]
    });
  } catch (error) {
    res.status(500).json({
      message: 'Gagal menyimpan data sensor',
      error: error.message
    });
  }
});

module.exports = router;
