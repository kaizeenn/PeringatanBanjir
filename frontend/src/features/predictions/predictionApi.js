import { getAuthToken } from '@/features/auth/authStorage';

const API_PREFIX = import.meta.env.VITE_PREDICTION_API_PREFIX || '/api/predictions';

async function requestJson(pathname = '', options = {}) {
  const token = getAuthToken();
  const response = await fetch(`${API_PREFIX}${pathname}`, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload?.error || payload?.message || `Request prediksi gagal (${response.status})`);
  }

  return payload?.data ?? payload;
}

export function fetchPredictionMeta() {
  return requestJson('/meta');
}

export function fetchLatestPrediction() {
  return requestJson('/latest');
}

export function fetchPredictionHistory(limit = 30) {
  return requestJson(`/history?limit=${limit}`);
}

export function runManualPrediction(input) {
  return requestJson('/run', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function testPredictionModel(input) {
  return requestJson('/test', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function runAutoPrediction() {
  return requestJson('/run-auto', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}
