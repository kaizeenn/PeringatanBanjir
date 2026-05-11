/**
 * Service untuk menjalankan model ML prediksi banjir.
 * Node.js memanggil script Python (predict_api.py) via child_process.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const ML_DIR = process.env.FLOOD_ML_DIR || path.join(PROJECT_ROOT, 'flood_ml');
const PYTHON_SCRIPT = process.env.FLOOD_ML_SCRIPT || path.join(ML_DIR, 'scripts', 'predict_api.py');
const VENV_PYTHON = path.join(ML_DIR, '.venv', 'bin', 'python');
const PYTHON_CMD = process.env.FLOOD_ML_PYTHON || (fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : (process.platform === 'win32' ? 'python' : 'python3'));
const MODEL_META_PATH = path.join(ML_DIR, 'models', 'flood_model_meta.json');

const RISK_LABEL_TO_DB = {
  aman: 'safe',
  waspada: 'medium',
  banjir: 'high',
};

const RISK_LEVEL_TO_ALERT_LEVEL = {
  0: 1,
  1: 2,
  2: 3,
};

const RISK_LABEL_TO_STATUS = {
  aman: 'safe',
  waspada: 'alert',
  banjir: 'danger',
};

function normalizeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function readModelMeta() {
  try {
    return JSON.parse(fs.readFileSync(MODEL_META_PATH, 'utf8'));
  } catch (error) {
    return null;
  }
}

function runPrediction(inputData) {
  return new Promise((resolve, reject) => {
    const pythonProcess = spawn(PYTHON_CMD, [PYTHON_SCRIPT], {
      cwd: ML_DIR,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => { stdout += data.toString(); });
    pythonProcess.stderr.on('data', (data) => { stderr += data.toString(); });

    pythonProcess.on('error', (error) => {
      reject(new Error(`Gagal menjalankan Python (${PYTHON_CMD}): ${error.message}`));
    });

    pythonProcess.on('close', (code) => {
      const output = stdout.trim();

      if (code !== 0) {
        return reject(new Error(`Python ML error (${code}): ${stderr || output}`));
      }

      try {
        resolve(JSON.parse(output));
      } catch (error) {
        reject(new Error(`Output ML bukan JSON valid: ${output || stderr}`));
      }
    });

    pythonProcess.stdin.write(JSON.stringify(inputData || {}));
    pythonProcess.stdin.end();
  });
}

function shouldCreateAlert(prediction) {
  return normalizeNumber(prediction?.risk_level, 0) >= 1;
}

function getAlertLevel(riskLevel) {
  return RISK_LEVEL_TO_ALERT_LEVEL[normalizeNumber(riskLevel, 0)] || 1;
}

function getRiskLevelForDb(prediction) {
  return RISK_LABEL_TO_DB[prediction?.risk_label] || 'safe';
}

function getStatusForFrontend(prediction) {
  return RISK_LABEL_TO_STATUS[prediction?.risk_label] || 'safe';
}

function buildAlertContent(prediction) {
  const label = String(prediction?.risk_label || 'aman').toUpperCase();
  const probability = Math.round(normalizeNumber(prediction?.flood_probability, 0) * 100);
  const waterLevel = normalizeNumber(prediction?.water_level_cm, 0).toFixed(1);

  return {
    title: `Prediksi banjir: ${label}`,
    message: `Model ML memprediksi status ${label} dengan probabilitas banjir ${probability}% dan estimasi tinggi air ${waterLevel} cm.`,
    recommendation: prediction?.action || 'Pantau kondisi sungai dan informasi resmi secara berkala.',
  };
}

module.exports = {
  ML_DIR,
  PYTHON_CMD,
  PYTHON_SCRIPT,
  MODEL_META_PATH,
  runPrediction,
  shouldCreateAlert,
  getAlertLevel,
  getRiskLevelForDb,
  getStatusForFrontend,
  buildAlertContent,
  readModelMeta,
};
