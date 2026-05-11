import { deriveUiStatusByWaterLevel, mapBackendWaterStatus, statusLabels } from '@/shared/constants/status';

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

const DEVICE_OFFLINE_THRESHOLD_MS = 2 * 60 * 1000;

function isDeviceOnline(lastSeen, now = new Date()) {
  const seenAt = new Date(lastSeen);
  if (Number.isNaN(seenAt.getTime())) {
    return false;
  }

  return now.getTime() - seenAt.getTime() <= DEVICE_OFFLINE_THRESHOLD_MS;
}

export function mapSensorRowToUi(row) {
  const waterLevel = toNumber(row?.water_level);
  const uiStatus = row?.water_status
    ? mapBackendWaterStatus(row.water_status)
    : deriveUiStatusByWaterLevel(waterLevel);

  return {
    id: row?.id,
    deviceId: row?.device_id ?? '-',
    timestamp: row?.created_at,
    waterLevel,
    status: uiStatus,
    statusLabel: statusLabels[uiStatus],
  };
}

function toTimestamp(value) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function formatWaterRiseRate(deltaLevelCm, elapsedMinutes) {
  if (!Number.isFinite(deltaLevelCm) || !Number.isFinite(elapsedMinutes) || elapsedMinutes <= 0) {
    return '-';
  }

  const absoluteDelta = Math.abs(deltaLevelCm).toFixed(2);
  const durationLabel = elapsedMinutes >= 60
    ? `${(elapsedMinutes / 60).toFixed(1)} jam`
    : `${elapsedMinutes.toFixed(1)} menit`;

  if (deltaLevelCm > 0) return `Naik ${absoluteDelta} cm/${durationLabel}`;
  if (deltaLevelCm < 0) return `Turun ${absoluteDelta} cm/${durationLabel}`;
  return `0.00 cm/${durationLabel}`;
}

export function buildSensorTableRows(historyRows) {
  const MIN_COMPARISON_MINUTES = 2;
  const MAX_LOOKAHEAD_ROWS = 40;
  const normalized = (historyRows ?? [])
    .map(mapSensorRowToUi)
    .map((row) => ({
      ...row,
      timestampMs: toTimestamp(row.timestamp),
    }))
    .filter((row) => row.timestampMs != null)
    .sort((a, b) => b.timestampMs - a.timestampMs);

  return normalized.map((row, index) => {
    let comparisonRow = null;
    let elapsedMinutes = null;

    const maxIndex = Math.min(normalized.length, index + 1 + MAX_LOOKAHEAD_ROWS);
    for (let i = index + 1; i < maxIndex; i += 1) {
      const candidate = normalized[i];
      const candidateMinutes = (row.timestampMs - candidate.timestampMs) / (1000 * 60);

      if (Number.isFinite(candidateMinutes) && candidateMinutes >= MIN_COMPARISON_MINUTES) {
        comparisonRow = candidate;
        elapsedMinutes = candidateMinutes;
        break;
      }
    }

    if (!comparisonRow) {
      return {
        ...row,
        waterRiseRateText: '-',
      };
    }

    // waterLevel sudah dinormalisasi menjadi tinggi air sungai.
    // Nilai lebih besar berarti permukaan air lebih tinggi.
    const deltaLevel = row.waterLevel - comparisonRow.waterLevel;

    if (!Number.isFinite(elapsedMinutes) || elapsedMinutes <= 0) {
      return {
        ...row,
        waterRiseRateText: '-',
      };
    }

    return {
      ...row,
      waterRiseRateText: formatWaterRiseRate(deltaLevel, elapsedMinutes),
    };
  });
}

export function buildWaterLevelChartData(historyRows, limit = 24) {
  const now = Date.now();
  const last24h = now - 24 * 60 * 60 * 1000;

  const normalized = (historyRows ?? [])
    .map(mapSensorRowToUi)
    .filter((row) => {
      const ts = new Date(row.timestamp).getTime();
      return Number.isFinite(ts) && ts >= last24h && ts <= now;
    });

  const groupedByHour = normalized.reduce((acc, row) => {
    const date = new Date(row.timestamp);
    const hourKey = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      date.getHours(),
      0,
      0,
      0
    ).toISOString();

    if (!acc[hourKey]) {
      acc[hourKey] = {
        total: 0,
        count: 0,
        date,
      };
    }

    acc[hourKey].total += row.waterLevel;
    acc[hourKey].count += 1;
    return acc;
  }, {});

  return Object.values(groupedByHour)
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(-limit)
    .map((bucket) => ({
      time: bucket.date.toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
      }),
      level: Number((bucket.total / bucket.count).toFixed(2)),
    }));
}

export function buildRainfallChartData(historyRows, limit = 24) {
  const chronological = (historyRows ?? []).slice().reverse().slice(-limit);

  return chronological.map((row) => ({
    time: new Date(row.recorded_at || row.forecast_date || row.created_at || Date.now()).toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
    }),
    rainfall: Number(row?.rainfall_mm ?? 0),
  }));
}

export function buildTideChartData(historyRows, limit = 24) {
  const chronological = (historyRows ?? []).slice().reverse().slice(-limit);

  return chronological.map((row) => ({
    time: new Date(row.recorded_at || row.prediction_date || Date.now()).toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
    }),
    level: Number(row?.tide_level_cm ?? 0),
  }));
}

export function buildDashboardStatus(latestRows, historyRows) {
  const latestNormalized = (latestRows ?? []).map(mapSensorRowToUi);
  const historyNormalized = (historyRows ?? []).map(mapSensorRowToUi);
  const now = new Date();

  const latestWaterLevel = latestNormalized[0]?.waterLevel ?? 0;
  const latestStatus = latestNormalized[0]?.status ?? 'safe';
  const avgWaterLevel = historyNormalized.length
    ? historyNormalized.reduce((total, item) => total + item.waterLevel, 0) / historyNormalized.length
    : 0;

  const totalDevices = latestNormalized.length;
  const devicesOnline = latestNormalized.filter((item) => isDeviceOnline(item.timestamp, now)).length;
  const todayNotifications = historyNormalized.filter((item) => {
    const createdAt = new Date(item.timestamp);
    const now = new Date();
    return createdAt.toDateString() === now.toDateString() && item.status !== 'safe';
  }).length;

  return {
    status: latestStatus,
    waterLevel: latestWaterLevel,
    rainfall: 0,
    devicesOnline,
    devicesTotal: totalDevices,
    todayNotifications,
    avgWaterLevel: Number(avgWaterLevel.toFixed(1)),
  };
}

export function buildDeviceRows(latestRows) {
  const now = new Date();

  return (latestRows ?? []).map((row) => {
    const normalized = mapSensorRowToUi(row);

    return {
      id: normalized.deviceId,
      name: normalized.deviceId,
      location: 'Lokasi belum diatur',
      status: isDeviceOnline(normalized.timestamp, now) ? 'online' : 'offline',
      battery: '-',
      lastSeen: normalized.timestamp,
      lat: -6.86,
      lng: 107.63,
    };
  });
}

export function buildNotificationRows(historyRows, limit = 4) {
  const normalized = (historyRows ?? []).map(mapSensorRowToUi);
  const active = normalized
    .filter((row) => row.status !== 'safe')
    .slice(0, limit)
    .map((row, index) => ({
      id: `${row.id}-${index}`,
      type: row.status,
      title: `Status ${row.statusLabel}`,
      message: `Perangkat ${row.deviceId} membaca tinggi air ${row.waterLevel.toFixed(1)} cm`,
      timestamp: row.timestamp,
      read: index > 1,
    }));

  if (active.length > 0) {
    return active;
  }

  return [
    {
      id: 'no-alert',
      type: 'safe',
      title: 'Status Normal',
      message: 'Belum ada notifikasi peringatan dari data sensor terbaru.',
      timestamp: new Date().toISOString(),
      read: true,
    },
  ];
}
