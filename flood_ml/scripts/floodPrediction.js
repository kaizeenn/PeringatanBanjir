/**
 * ============================================================
 * FLOOD PREDICTION SERVICE - floodPrediction.js
 * ============================================================
 * Taruh file ini di: backend/services/floodPrediction.js
 *
 * Cara pakai di route Express:
 *   const { runPrediction } = require('../services/floodPrediction')
 *   const result = await runPrediction(inputData)
 * ============================================================
 */

const { spawn } = require('child_process')
const path      = require('path')

// Path ke script Python — sesuaikan dengan struktur project kamu
const PYTHON_SCRIPT = path.join(__dirname, '../../ml/scripts/predict_api.py')
const PYTHON_CMD    = process.platform === 'win32' ? 'python' : 'python3'

/**
 * Jalankan prediksi banjir via Python ML model
 * @param {Object} inputData
 * @param {number} inputData.rainfall_mm      - Curah hujan hari ini (mm)
 * @param {number} inputData.rainfall_lag1    - Curah hujan kemarin (mm)
 * @param {number} inputData.rainfall_lag2    - Curah hujan 2 hari lalu (mm)
 * @param {number} inputData.rainfall_7day    - Total curah hujan 7 hari (mm)
 * @param {number} inputData.tide_max_m       - Pasut tertinggi hari ini (meter)
 * @param {number} inputData.month            - Bulan saat ini (1-12)
 * @param {number} [inputData.water_level_cm] - Opsional: tinggi air sensor (cm)
 * @returns {Promise<Object>} hasil prediksi
 */
function runPrediction(inputData) {
  return new Promise((resolve, reject) => {
    const process = spawn(PYTHON_CMD, [PYTHON_SCRIPT])

    let stdout = ''
    let stderr = ''

    process.stdout.on('data', (data) => { stdout += data.toString() })
    process.stderr.on('data', (data) => { stderr += data.toString() })

    process.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`Python error: ${stderr}`))
      }
      try {
        const result = JSON.parse(stdout.trim())
        resolve(result)
      } catch (e) {
        reject(new Error(`JSON parse error: ${stdout}`))
      }
    })

    // Kirim input ke Python via stdin
    process.stdin.write(JSON.stringify(inputData))
    process.stdin.end()
  })
}

/**
 * Tentukan apakah perlu buat alert berdasarkan hasil prediksi
 */
function shouldCreateAlert(prediction) {
  return prediction.risk_level >= 1
}

/**
 * Map risk_level ke alert_type di tabel alerts kamu
 */
function getAlertType(riskLevel) {
  const map = {
    0: 'info',
    1: 'warning',
    2: 'danger',
  }
  return map[riskLevel] || 'info'
}

module.exports = { runPrediction, shouldCreateAlert, getAlertType }
