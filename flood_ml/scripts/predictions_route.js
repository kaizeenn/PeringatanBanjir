/**
 * ============================================================
 * FLOOD PREDICTION ROUTES - predictions.js
 * ============================================================
 * Taruh file ini di: backend/routes/predictions.js
 *
 * Daftarkan di app.js:
 *   const predictionsRouter = require('./routes/predictions')
 *   app.use('/api/predictions', predictionsRouter)
 * ============================================================
 */

const express    = require('express')
const router     = express.Router()
const db         = require('../config/db')         // koneksi MySQL kamu
const { runPrediction, shouldCreateAlert, getAlertType } = require('../services/floodPrediction')

/**
 * POST /api/predictions/run
 * Jalankan prediksi manual dengan input dari body
 *
 * Body JSON:
 * {
 *   "device_id"     : "SENSOR-001",
 *   "rainfall_mm"   : 45.0,
 *   "rainfall_lag1" : 20.0,
 *   "rainfall_lag2" : 10.0,
 *   "rainfall_7day" : 100.0,
 *   "tide_max_m"    : 1.1,
 *   "month"         : 12,
 *   "water_level_cm": 175.0   // opsional
 * }
 */
router.post('/run', async (req, res) => {
  try {
    const {
      device_id,
      rainfall_mm   = 0,
      rainfall_lag1 = 0,
      rainfall_lag2 = 0,
      rainfall_7day = 0,
      tide_max_m    = 0.5,
      month         = new Date().getMonth() + 1,
      water_level_cm,
    } = req.body

    // Jalankan ML model
    const prediction = await runPrediction({
      rainfall_mm,
      rainfall_lag1,
      rainfall_lag2,
      rainfall_7day,
      tide_max_m,
      month,
      ...(water_level_cm && { water_level_cm }),
    })

    if (!prediction.success) {
      return res.status(500).json({ error: prediction.error })
    }

    // Simpan ke tabel flood_predictions
    await db.execute(
      `INSERT INTO flood_predictions
       (device_id, predicted_level_cm, flood_probability, risk_level, prediction_time)
       VALUES (?, ?, ?, ?, NOW())`,
      [
        device_id || 'MANUAL',
        prediction.water_level_cm,
        prediction.flood_probability,
        prediction.risk_label,
      ]
    )

    // Buat alert kalau risiko waspada/banjir
    if (shouldCreateAlert(prediction)) {
      await db.execute(
        `INSERT INTO alerts
         (device_id, alert_type, message, created_at)
         VALUES (?, ?, ?, NOW())`,
        [
          device_id || 'MANUAL',
          getAlertType(prediction.risk_level),
          prediction.action,
        ]
      )
    }

    return res.json({
      success          : true,
      risk_level       : prediction.risk_level,
      risk_label       : prediction.risk_label,
      flood_probability: prediction.flood_probability,
      probability      : prediction.probability,
      action           : prediction.action,
      water_level_cm   : prediction.water_level_cm,
      alert_created    : shouldCreateAlert(prediction),
    })

  } catch (err) {
    console.error('[predictions/run]', err)
    return res.status(500).json({ error: err.message })
  }
})

/**
 * POST /api/predictions/run-auto
 * Jalankan prediksi otomatis dari data sensor & BMKG terbaru di database
 * Dipanggil oleh cron job setiap 1 jam
 */
router.post('/run-auto', async (req, res) => {
  try {
    // 1. Ambil data sensor terbaru
    const [sensors] = await db.execute(
      `SELECT device_id, water_level as water_level_cm
       FROM sensor_data
       WHERE created_at >= NOW() - INTERVAL 1 HOUR
       ORDER BY created_at DESC
       LIMIT 1`
    )

    // 2. Ambil data curah hujan dari BMKG
    const [weather] = await db.execute(
      `SELECT
         rainfall_mm,
         forecast_date
       FROM weather_data
       WHERE forecast_date >= CURDATE() - INTERVAL 7 DAY
       ORDER BY forecast_date DESC
       LIMIT 7`
    )

    // 3. Ambil data pasut hari ini
    const [tidal] = await db.execute(
      `SELECT tide_level_cm / 100 as tide_max_m
       FROM tidal_data
       WHERE prediction_date = CURDATE()
       ORDER BY tide_level_cm DESC
       LIMIT 1`
    )

    // Hitung fitur dari data database
    const rainfall_mm   = weather[0]?.rainfall_mm || 0
    const rainfall_lag1 = weather[1]?.rainfall_mm || 0
    const rainfall_lag2 = weather[2]?.rainfall_mm || 0
    const rainfall_7day = weather.reduce((s, w) => s + (w.rainfall_mm || 0), 0)
    const tide_max_m    = tidal[0]?.tide_max_m    || 0.5
    const water_level   = sensors[0]?.water_level_cm
    const month         = new Date().getMonth() + 1
    const device_id     = sensors[0]?.device_id || 'AUTO'

    const prediction = await runPrediction({
      rainfall_mm,
      rainfall_lag1,
      rainfall_lag2,
      rainfall_7day,
      tide_max_m,
      month,
      ...(water_level && { water_level_cm: water_level }),
    })

    if (!prediction.success) {
      return res.status(500).json({ error: prediction.error })
    }

    // Simpan ke flood_predictions
    await db.execute(
      `INSERT INTO flood_predictions
       (device_id, predicted_level_cm, flood_probability, risk_level, prediction_time)
       VALUES (?, ?, ?, ?, NOW())`,
      [device_id, prediction.water_level_cm, prediction.flood_probability, prediction.risk_label]
    )

    // Buat alert jika perlu
    if (shouldCreateAlert(prediction)) {
      await db.execute(
        `INSERT INTO alerts (device_id, alert_type, message, created_at)
         VALUES (?, ?, ?, NOW())`,
        [device_id, getAlertType(prediction.risk_level), prediction.action]
      )
    }

    return res.json({
      success          : true,
      device_id,
      risk_label       : prediction.risk_label,
      flood_probability: prediction.flood_probability,
      water_level_cm   : prediction.water_level_cm,
      alert_created    : shouldCreateAlert(prediction),
    })

  } catch (err) {
    console.error('[predictions/run-auto]', err)
    return res.status(500).json({ error: err.message })
  }
})

/**
 * GET /api/predictions/latest
 * Ambil hasil prediksi terbaru
 */
router.get('/latest', async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT *
       FROM flood_predictions
       ORDER BY prediction_time DESC
       LIMIT 1`
    )
    return res.json(rows[0] || null)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
})

/**
 * GET /api/predictions/history?limit=30
 * Ambil riwayat prediksi
 */
router.get('/history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 30
    const [rows] = await db.execute(
      `SELECT *
       FROM flood_predictions
       ORDER BY prediction_time DESC
       LIMIT ?`,
      [limit]
    )
    return res.json(rows)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
})

module.exports = router
