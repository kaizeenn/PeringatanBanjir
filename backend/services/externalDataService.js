const db = require('../config/db');
const https = require('https');
const dns = require('dns');

const FETCH_COOLDOWN_DEFAULTS = {
  weatherMs: 10 * 60 * 1000,
  tideMs: 30 * 60 * 1000,
};

const lastFetchAt = {
  weather: 0,
  tide: 0,
};

const CONFIG_DEFS = {
  weatherApiBaseUrl: {
    env: 'WEATHER_API_BASE_URL',
    dbKey: 'weather_api_base_url',
    type: 'string',
    description: 'Base URL API cuaca',
  },
  weatherApiKey: {
    env: 'WEATHER_API_KEY',
    dbKey: 'weather_api_key',
    type: 'string',
    description: 'API key layanan cuaca',
  },
  weatherBmkgAdm4: {
    env: 'WEATHER_BMKG_ADM4',
    dbKey: 'weather_bmkg_adm4',
    type: 'string',
    description: 'Kode wilayah administrasi tingkat IV BMKG',
  },
  tideApiBaseUrl: {
    env: 'TIDE_API_BASE_URL',
    dbKey: 'tide_api_base_url',
    type: 'string',
    description: 'Base URL API pasang surut',
  },
  tideApiKey: {
    env: 'TIDE_API_KEY',
    dbKey: 'tide_api_key',
    type: 'string',
    description: 'API key layanan pasang surut',
  },
  tideStationCode: {
    env: 'TIDE_STATION_CODE',
    dbKey: 'tide_station_code',
    type: 'string',
    description: 'Kode stasiun pasang surut',
  },
};

const KEY_CANDIDATES = ['appid', 'key', 'apikey', 'api_key', 'token', 'access_key'];

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function inferRainIntensity(rainfallMm) {
  if (!Number.isFinite(rainfallMm) || rainfallMm <= 0) return 'none';
  if (rainfallMm < 5) return 'light';
  if (rainfallMm < 20) return 'moderate';
  if (rainfallMm < 50) return 'heavy';
  return 'very_heavy';
}

function inferRainIntensityFromWeatherDesc(weatherDesc) {
  const text = String(weatherDesc || '').toLowerCase();
  if (!text.includes('hujan') && !text.includes('rain')) return 'none';
  if (text.includes('ringan') || text.includes('light')) return 'light';
  if (text.includes('sedang') || text.includes('moderate')) return 'moderate';
  if (text.includes('lebat') || text.includes('heavy')) return 'heavy';
  return 'moderate';
}

function isRainyForecastSlot(slot) {
  const desc = String(slot?.weather_desc || slot?.weather_desc_en || '').toLowerCase();
  if (desc.includes('hujan') || desc.includes('rain')) return true;

  const weatherCode = toNumber(slot?.weather);
  if (weatherCode == null) return false;
  return weatherCode >= 60;
}

function toDateSafe(value) {
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function estimateBmkgRainDurationHours(payload) {
  const slots = Array.isArray(payload?.data)
    ? payload.data
        .flatMap((region) => (Array.isArray(region?.cuaca) ? region.cuaca : []))
        .flat()
        .filter(Boolean)
    : [];

  if (slots.length === 0) return null;

  const normalizedSlots = slots
    .map((slot) => ({
      ...slot,
      _time: toDateSafe(slot?.local_datetime || slot?.utc_datetime),
    }))
    .filter((slot) => slot._time)
    .sort((a, b) => a._time.getTime() - b._time.getTime());

  if (normalizedSlots.length === 0) return null;

  const now = new Date();
  let startIndex = normalizedSlots.findIndex((slot) => slot._time.getTime() >= now.getTime());
  if (startIndex < 0) startIndex = normalizedSlots.length - 1;

  if (!isRainyForecastSlot(normalizedSlots[startIndex])) {
    return 0;
  }

  let rainySlots = 0;
  for (let i = startIndex; i < normalizedSlots.length; i += 1) {
    if (!isRainyForecastSlot(normalizedSlots[i])) break;
    rainySlots += 1;
  }

  return rainySlots * 3;
}

function inferWindDirection(deg) {
  if (!Number.isFinite(deg)) return null;
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const idx = Math.round(deg / 45) % 8;
  return dirs[idx];
}

function normalizeToCm(value, unitHint = '') {
  const numericValue = toNumber(value);
  if (!Number.isFinite(numericValue)) return null;

  if (String(unitHint).toLowerCase() === 'm') {
    return Number((numericValue * 100).toFixed(2));
  }

  return Number(numericValue.toFixed(2));
}

function isStormGlassUrl(url) {
  return url.hostname.toLowerCase().includes('stormglass.io');
}

function detectApiKeyParam(url) {
  const hostname = url.hostname.toLowerCase();

  if (hostname.includes('openweathermap')) return 'appid';
  if (hostname.includes('weatherapi')) return 'key';

  return 'apikey';
}

function attachApiKey(url, apiKey) {
  if (!apiKey) return;
  // StormGlass uses Authorization header, not query param
  if (isStormGlassUrl(url)) return;

  const alreadyHasKey = KEY_CANDIDATES.some((candidate) => url.searchParams.has(candidate));
  if (alreadyHasKey) return;

  url.searchParams.set(detectApiKeyParam(url), apiKey);
}

function buildBmkgWeatherUrl(config) {
  const adm4 = String(config.weatherBmkgAdm4 || '').trim() || '97.73.04';
  return new URL(`https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4=${encodeURIComponent(adm4)}`);
}

function withTimeout(ms) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);

  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeoutId),
  };
}

function requestJsonViaHttps(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    dns.resolve4(url.hostname, (dnsError, addresses) => {
      if (dnsError || !Array.isArray(addresses) || addresses.length === 0) {
        reject(dnsError || new Error('DNS IPv4 tidak ditemukan untuk endpoint pasang surut'));
        return;
      }

      const targetIp = addresses[0];

      const request = https.request(
        {
          protocol: url.protocol,
          hostname: targetIp,
          servername: url.hostname,
          port: url.port || 443,
          path: `${url.pathname}${url.search}`,
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Host: url.hostname,
          },
        },
        (response) => {
          let body = '';

          response.on('data', (chunk) => {
            body += chunk;
          });

          response.on('end', () => {
            if (response.statusCode < 200 || response.statusCode >= 300) {
              reject(new Error(`Gagal memuat pasang surut (${response.statusCode})`));
              return;
            }

            try {
              resolve(JSON.parse(body));
            } catch (error) {
              reject(new Error('Response pasang surut bukan JSON valid'));
            }
          });
        }
      );

      request.setTimeout(timeoutMs, () => {
        request.destroy(new Error('Request pasang surut timeout'));
      });

      request.on('error', (error) => {
        reject(error);
      });

      request.end();
    });
  });
}

async function readIntegrationSettingsFromDb() {
  const dbKeys = Object.values(CONFIG_DEFS).map((item) => item.dbKey);

  const [rows] = await db.query(
    `SELECT \`key\`, \`value\`
     FROM system_settings
     WHERE \`key\` IN (${dbKeys.map(() => '?').join(', ')})`,
    dbKeys
  );

  const mapped = {};
  for (const row of rows) {
    const pair = Object.entries(CONFIG_DEFS).find(([, def]) => def.dbKey === row.key);
    if (!pair) continue;
    mapped[pair[0]] = row.value;
  }

  return mapped;
}

async function getIntegrationConfig() {
  const fallback = {};

  for (const [name, def] of Object.entries(CONFIG_DEFS)) {
    fallback[name] = process.env[def.env] || '';
  }

  try {
    const dbConfig = await readIntegrationSettingsFromDb();
    return {
      ...fallback,
      ...dbConfig,
    };
  } catch (error) {
    return fallback;
  }
}

function getLocationCodeFromUrl(urlValue) {
  try {
    if (!urlValue) return null;
    const url = new URL(urlValue);
    return url.searchParams.get('adm4') || url.searchParams.get('adm3') || url.searchParams.get('location') || null;
  } catch (error) {
    return null;
  }
}

function flattenBmkgForecastSlots(cuaca) {
  if (!Array.isArray(cuaca)) return [];

  return cuaca
    .flatMap((item) => (Array.isArray(item) ? item : [item]))
    .flatMap((item) => (Array.isArray(item) ? item : [item]))
    .filter(Boolean);
}

function pickBestBmkgEntry(payload) {
  if (!Array.isArray(payload?.data)) return null;

  const now = new Date();
  const candidates = [];

  for (const region of payload.data) {
    const lokasi = region?.lokasi || payload?.lokasi || null;
    const slots = flattenBmkgForecastSlots(region?.cuaca);

    for (const entry of slots) {
      const time = toDateSafe(entry?.local_datetime || entry?.utc_datetime || entry?.datetime);
      candidates.push({ entry, lokasi, time });
    }
  }

  if (candidates.length === 0) return null;

  const withTime = candidates.filter((candidate) => candidate.time);
  if (withTime.length === 0) return candidates[0];

  withTime.sort((a, b) => {
    const aFuturePenalty = a.time.getTime() < now.getTime() ? 24 * 60 * 60 * 1000 : 0;
    const bFuturePenalty = b.time.getTime() < now.getTime() ? 24 * 60 * 60 * 1000 : 0;
    return Math.abs(a.time.getTime() - now.getTime()) + aFuturePenalty
      - (Math.abs(b.time.getTime() - now.getTime()) + bFuturePenalty);
  });

  return withTime[0];
}

async function saveIntegrationConfig(inputConfig = {}) {
  const updates = [];

  for (const [name, value] of Object.entries(inputConfig)) {
    if (!Object.prototype.hasOwnProperty.call(CONFIG_DEFS, name)) continue;

    const stringValue = String(value ?? '').trim();
    const definition = CONFIG_DEFS[name];

    updates.push({
      ...definition,
      value: stringValue,
    });

    process.env[definition.env] = stringValue;
  }

  if (updates.length === 0) {
    return getIntegrationConfig();
  }

  const upsertSql = `
    INSERT INTO system_settings (\`key\`, \`value\`, \`type\`, description, category, is_public)
    VALUES (?, ?, ?, ?, 'integration', FALSE)
    ON DUPLICATE KEY UPDATE
      \`value\` = VALUES(\`value\`),
      \`type\` = VALUES(\`type\`),
      description = VALUES(description),
      category = 'integration'
  `;

  try {
    for (const update of updates) {
      await db.query(upsertSql, [update.dbKey, update.value, update.type, update.description]);
    }
  } catch (error) {
    // If system_settings is unavailable, values still apply from process.env for current runtime.
  }

  return getIntegrationConfig();
}

function parseWeatherPayload(payload, config) {
  const bmkgSelection = pickBestBmkgEntry(payload);

  if (bmkgSelection?.entry) {
    const bmkgEntry = bmkgSelection.entry;
    const parsedDate = new Date(bmkgEntry.local_datetime || bmkgEntry.datetime || Date.now());
    const isValidDate = !Number.isNaN(parsedDate.getTime());

    const rainfallMm = toNumber(bmkgEntry.tp) ?? toNumber(bmkgEntry.rainfall_mm) ?? 0;
    const humidity = toNumber(bmkgEntry.hu) ?? toNumber(bmkgEntry.humidity) ?? null;
    const temperature = toNumber(bmkgEntry.t) ?? toNumber(bmkgEntry.temperature) ?? null;
    const windSpeedKmh = toNumber(bmkgEntry.ws) ?? toNumber(bmkgEntry.wind_speed) ?? null;

    const windDirection =
      bmkgEntry.wd ||
      bmkgEntry.wind_direction ||
      inferWindDirection(toNumber(bmkgEntry.wd_deg) ?? toNumber(bmkgEntry.wind_deg));

    return {
      rainfallMm: Number(rainfallMm.toFixed(2)),
      humidity,
      temperature,
      windSpeedKmh,
      windDirection,
      weatherCode: bmkgEntry.weather == null ? null : String(bmkgEntry.weather),
      weatherDesc: bmkgEntry.weather_desc || bmkgEntry.weather_desc_en || null,
      forecastDate: (isValidDate ? parsedDate : new Date()).toISOString().slice(0, 10),
      forecastHour: isValidDate ? parsedDate.getHours() : new Date().getHours(),
      rainIntensity: inferRainIntensity(rainfallMm),
      source: 'BMKG',
      locationCode:
        bmkgSelection?.lokasi?.adm4 ||
        bmkgSelection?.lokasi?.adm3 ||
        getLocationCodeFromUrl(config.weatherApiBaseUrl) ||
        `${config.weatherLocationLat || ''},${config.weatherLocationLon || ''}`.replace(/^,|,$/g, '') ||
        null,
    };
  }

  const now = new Date();
  const openMeteoCurrent = payload?.current || {};
  const openMeteoDaily = payload?.daily || {};
  const openMeteoHourly = payload?.hourly || {};

  const bmkgForecast = Array.isArray(payload?.data)
    ? payload.data.flatMap((region) => Array.isArray(region?.cuaca) ? region.cuaca : [])
    : [];
  const bmkgSlots = bmkgForecast.flat().filter(Boolean);
  const bmkgCurrent = bmkgSlots.length > 0
    ? bmkgSlots
      .map((slot) => ({
        slot,
        time: toDateSafe(slot?.local_datetime || slot?.utc_datetime || slot?.datetime),
      }))
      .filter((item) => item.time)
      .sort((a, b) => Math.abs(a.time.getTime() - now.getTime()) - Math.abs(b.time.getTime() - now.getTime()))
      .map((item) => item.slot)[0]
    : null;

  const weatherCode =
    bmkgCurrent?.weather ??
    payload?.weather?.[0]?.id ??
    payload?.current?.condition?.code ??
    payload?.weather_code ??
    null;

  const weatherDesc =
    bmkgCurrent?.weather_desc ??
    payload?.weather?.[0]?.description ??
    payload?.current?.condition?.text ??
    payload?.weather_desc ??
    null;
  const weatherDescEn = bmkgCurrent?.weather_desc_en || null;
  const cloudCoverPercent = toNumber(bmkgCurrent?.tcc);
  const windDirectionTo = bmkgCurrent?.wd_to || null;
  const visibilityKm = toNumber(bmkgCurrent?.vis ?? bmkgCurrent?.visibility);
  const bmkgLocalDate = toDateSafe(bmkgCurrent?.local_datetime);
  const bmkgUtcDate = toDateSafe(bmkgCurrent?.utc_datetime);
  const bmkgRaw = bmkgCurrent ? JSON.stringify(bmkgCurrent) : null;

  const rainfallMm =
    toNumber(openMeteoCurrent?.rain) ??
    toNumber(openMeteoCurrent?.precipitation) ??
    toNumber(bmkgCurrent?.rainfall) ??
    toNumber(bmkgCurrent?.rainfall_mm) ??
    (Array.isArray(openMeteoHourly?.precipitation) ? toNumber(openMeteoHourly.precipitation[0]) : null) ??
    toNumber(payload?.rain?.['1h']) ??
    toNumber(payload?.rain?.['3h']) ??
    toNumber(payload?.current?.precip_mm) ??
    toNumber(payload?.precip_mm) ??
    toNumber(payload?.rainfall_mm) ??
    null;

  const humidity =
    toNumber(openMeteoCurrent?.relative_humidity_2m) ??
    toNumber(bmkgCurrent?.hu) ??
    toNumber(payload?.main?.humidity) ??
    toNumber(payload?.current?.humidity) ??
    toNumber(payload?.humidity) ??
    null;

  const temperature =
    toNumber(openMeteoCurrent?.temperature_2m) ??
    toNumber(bmkgCurrent?.t) ??
    toNumber(payload?.main?.temp) ??
    toNumber(payload?.current?.temp_c) ??
    toNumber(payload?.temperature) ??
    null;

  const windSpeedKmhDirect =
    toNumber(openMeteoCurrent?.wind_speed_10m) ??
    toNumber(bmkgCurrent?.ws) ??
    toNumber(payload?.current?.wind_kph) ??
    null;
  const windSpeedFromMs =
    toNumber(payload?.wind?.speed) ??
    toNumber(payload?.wind_speed) ??
    null;

  const windSpeedKmh = windSpeedKmhDirect != null
    ? Number(windSpeedKmhDirect.toFixed(2))
    : windSpeedFromMs == null
      ? null
      : Number((windSpeedFromMs * 3.6).toFixed(2));
  const windDirection =
    bmkgCurrent?.wd ??
    (openMeteoCurrent?.wind_direction_10m != null
      ? inferWindDirection(toNumber(openMeteoCurrent.wind_direction_10m))
      : null) ??
    (payload?.wind?.deg != null
      ? inferWindDirection(toNumber(payload.wind.deg))
      : payload?.current?.wind_dir || payload?.wind_direction || null);

  const openMeteoPrecipProb = Array.isArray(openMeteoHourly?.precipitation_probability)
    ? toNumber(openMeteoHourly.precipitation_probability[0])
    : null;
  const weatherDescFromRain =
    rainfallMm == null
      ? null
      : rainfallMm <= 0
        ? (openMeteoPrecipProb != null && openMeteoPrecipProb >= 50 ? 'Berawan' : 'Cerah')
        : rainfallMm < 5
          ? 'Hujan Ringan'
          : rainfallMm < 20
            ? 'Hujan Sedang'
            : 'Hujan Lebat';

  const rainDurationHours = estimateBmkgRainDurationHours(payload);
  const locationCode = String(config.weatherBmkgAdm4 || '').trim() || '97.73.04';

  return {
    rainfallMm: rainfallMm == null ? null : Number(rainfallMm.toFixed(2)),
    humidity,
    temperature,
    windSpeedKmh,
    windDirection,
    weatherCode: weatherCode == null ? null : String(weatherCode),
    weatherDesc: weatherDesc || weatherDescFromRain,
    weatherDescEn,
    cloudCoverPercent: cloudCoverPercent == null ? null : Math.round(cloudCoverPercent),
    windDirectionTo,
    visibilityKm,
    bmkgLocalDatetime: bmkgLocalDate ? bmkgLocalDate.toISOString().slice(0, 19).replace('T', ' ') : null,
    bmkgUtcDatetime: bmkgUtcDate ? bmkgUtcDate.toISOString().slice(0, 19).replace('T', ' ') : null,
    bmkgRaw,
    forecastDate: now.toISOString().slice(0, 10),
    forecastHour: now.getHours(),
    rainDurationHours,
    rainIntensity:
      rainfallMm == null
        ? inferRainIntensityFromWeatherDesc(weatherDesc)
        : inferRainIntensity(rainfallMm),
    source: payload?.source || 'BMKG',
    locationCode,
  };
}

/**
 * Parse StormGlass tide/extremes/point response.
 *
 * Response format:
 * {
 *   "data": [
 *     { "height": 2.45, "time": "2024-01-01T02:15:00+00:00", "type": "high" },
 *     { "height": 0.12, "time": "2024-01-01T08:45:00+00:00", "type": "low" }
 *   ],
 *   "meta": { "station": { "name": "...", "lat": ..., "lng": ... } }
 * }
 */
function parseStormGlassTidePayload(payload, config) {
  const now = new Date();
  const events = Array.isArray(payload?.data) ? payload.data : [];
  const meta = payload?.meta || {};
  const station = meta.station || {};

  // Find the nearest upcoming high and low events
  const nowMs = now.getTime();
  const futureEvents = events
    .map((e) => ({ ...e, _ms: new Date(e.time).getTime() }))
    .filter((e) => Number.isFinite(e._ms))
    .sort((a, b) => a._ms - b._ms);

  const highEvent = futureEvents.find((e) => String(e.type).toLowerCase() === 'high' && e._ms >= nowMs)
    || futureEvents.find((e) => String(e.type).toLowerCase() === 'high');
  const lowEvent = futureEvents.find((e) => String(e.type).toLowerCase() === 'low' && e._ms >= nowMs)
    || futureEvents.find((e) => String(e.type).toLowerCase() === 'low');

  // Find the most recent past event to determine current status
  const pastEvents = futureEvents.filter((e) => e._ms <= nowMs);
  const lastEvent = pastEvents.length > 0 ? pastEvents[pastEvents.length - 1] : null;
  const nextEvent = futureEvents.find((e) => e._ms > nowMs);

  let tideStatus = 'rising';
  if (lastEvent && nextEvent) {
    // After a low tide → rising; after a high tide → falling
    tideStatus = String(lastEvent.type).toLowerCase() === 'low' ? 'rising' : 'falling';
  } else if (nextEvent) {
    tideStatus = String(nextEvent.type).toLowerCase() === 'high' ? 'rising' : 'falling';
  }

  // Estimate current tide level by interpolating between last and next events
  let tideLevelCm = null;
  if (lastEvent && nextEvent && lastEvent._ms !== nextEvent._ms) {
    const progress = (nowMs - lastEvent._ms) / (nextEvent._ms - lastEvent._ms);
    const interpolated = lastEvent.height + (nextEvent.height - lastEvent.height) * progress;
    tideLevelCm = normalizeToCm(interpolated, 'm');
  } else if (nextEvent) {
    tideLevelCm = normalizeToCm(nextEvent.height, 'm');
  } else if (lastEvent) {
    tideLevelCm = normalizeToCm(lastEvent.height, 'm');
  }

  const highTideLevelCm = highEvent ? normalizeToCm(highEvent.height, 'm') : null;
  const lowTideLevelCm = lowEvent ? normalizeToCm(lowEvent.height, 'm') : null;
  const highTideTime = highEvent ? new Date(highEvent.time).toTimeString().slice(0, 8) : null;
  const lowTideTime = lowEvent ? new Date(lowEvent.time).toTimeString().slice(0, 8) : null;

  return {
    tideLevelCm,
    tideStatus,
    highTideTime,
    highTideLevelCm,
    lowTideTime,
    lowTideLevelCm,
    predictionDate: now.toISOString().slice(0, 10),
    source: 'STORMGLASS',
    stationCode: station.name || config.tideStationCode || 'stormglass',
  };
}

function parseTidePayload(payload, config) {
  const now = new Date();

  const marineTimes = Array.isArray(payload?.hourly?.time) ? payload.hourly.time : [];
  const marineWaveHeights = Array.isArray(payload?.hourly?.wave_height) ? payload.hourly.wave_height : [];

  let marineCurrentHeightM = null;
  let marineCurrentDirectionDeg = null;
  let marineCurrentPeriodS = null;
  let marineNextHeightM = null;
  let marineHighHeightM = null;
  let marineLowHeightM = null;
  let marineHighTime = null;
  let marineLowTime = null;

  if (marineTimes.length > 0 && marineWaveHeights.length > 0) {
    const nowMs = now.getTime();
    let currentIndex = marineTimes.findIndex((timeValue) => {
      const parsedTime = new Date(timeValue).getTime();
      return Number.isFinite(parsedTime) && parsedTime >= nowMs;
    });

    if (currentIndex < 0) {
      currentIndex = 0;
    }

    marineCurrentHeightM = toNumber(marineWaveHeights[currentIndex]);
    const marineWaveDirections = Array.isArray(payload?.hourly?.wave_direction) ? payload.hourly.wave_direction : [];
    const marineWavePeriods = Array.isArray(payload?.hourly?.wave_period) ? payload.hourly.wave_period : [];
    marineCurrentDirectionDeg = toNumber(marineWaveDirections[currentIndex]);
    marineCurrentPeriodS = toNumber(marineWavePeriods[currentIndex]);
    marineNextHeightM = toNumber(marineWaveHeights[currentIndex + 1]);

    const maxRange = Math.min(marineWaveHeights.length, currentIndex + 24);
    for (let idx = currentIndex; idx < maxRange; idx += 1) {
      const value = toNumber(marineWaveHeights[idx]);
      if (!Number.isFinite(value)) continue;

      if (marineHighHeightM == null || value > marineHighHeightM) {
        marineHighHeightM = value;
        marineHighTime = marineTimes[idx] || null;
      }

      if (marineLowHeightM == null || value < marineLowHeightM) {
        marineLowHeightM = value;
        marineLowTime = marineTimes[idx] || null;
      }
    }
  }

  const heights = Array.isArray(payload?.heights) ? payload.heights : [];
  const latestHeight = heights.length > 0 ? heights[0] : null;
  const nextHeight = heights.length > 1 ? heights[1] : null;

  const events = Array.isArray(payload?.extremes) ? payload.extremes : [];
  const highEvent = events.find((item) => String(item?.type || '').toLowerCase().includes('high'));
  const lowEvent = events.find((item) => String(item?.type || '').toLowerCase().includes('low'));

  const unitHint = payload?.unit || payload?.units || '';
  const marineUnitHint = marineCurrentHeightM == null ? '' : 'm';

  const tideLevelCm = normalizeToCm(
    latestHeight?.height ?? payload?.tide_level ?? payload?.current?.height ?? marineCurrentHeightM,
    unitHint || marineUnitHint
  );

  let tideStatus = String(payload?.tide_status || '').toLowerCase();
  if (!['high', 'low', 'rising', 'falling'].includes(tideStatus)) {
    const nextHeightValue = nextHeight?.height ?? marineNextHeightM;
    const latestHeightValue = latestHeight?.height ?? marineCurrentHeightM;

    if (nextHeightValue != null && latestHeightValue != null) {
      tideStatus = nextHeightValue > latestHeightValue ? 'rising' : 'falling';
    } else {
      tideStatus = 'rising';
    }
  }

  const highTideLevelCm = normalizeToCm(highEvent?.height ?? marineHighHeightM, unitHint || marineUnitHint);
  const lowTideLevelCm = normalizeToCm(lowEvent?.height ?? marineLowHeightM, unitHint || marineUnitHint);

  const highTideDateTime = highEvent?.date || marineHighTime;
  const lowTideDateTime = lowEvent?.date || marineLowTime;

  const highTideTime = highTideDateTime ? new Date(highTideDateTime).toTimeString().slice(0, 8) : null;
  const lowTideTime = lowTideDateTime ? new Date(lowTideDateTime).toTimeString().slice(0, 8) : null;

  return {
    tideLevelCm,
    tideStatus,
    highTideTime,
    highTideLevelCm,
    lowTideTime,
    lowTideLevelCm,
    predictionDate: now.toISOString().slice(0, 10),
    source: payload?.source || (marineWaveHeights.length > 0 ? 'OPEN_METEO_MARINE' : 'EXTERNAL_API'),
    stationCode: config.tideStationCode || (marineWaveHeights.length > 0 ? 'open-meteo-marine' : null),
  };
}

async function persistWeatherData(weatherData) {
  const sql = `
    INSERT INTO weather_data (
      rainfall_mm, humidity, temperature, wind_speed, wind_direction,
      weather_code, weather_desc, weather_desc_en, cloud_cover_percent, wind_direction_to,
      visibility_km, bmkg_local_datetime, bmkg_utc_datetime, bmkg_raw,
      forecast_date, forecast_hour, rain_duration_hours, rain_intensity,
      source, location_code
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  await db.query(sql, [
    weatherData.rainfallMm,
    weatherData.humidity,
    weatherData.temperature,
    weatherData.windSpeedKmh,
    weatherData.windDirection,
    weatherData.weatherCode,
    weatherData.weatherDesc,
    weatherData.weatherDescEn,
    weatherData.cloudCoverPercent,
    weatherData.windDirectionTo,
    weatherData.visibilityKm,
    weatherData.bmkgLocalDatetime,
    weatherData.bmkgUtcDatetime,
    weatherData.bmkgRaw,
    weatherData.forecastDate,
    weatherData.forecastHour,
    weatherData.rainDurationHours,
    weatherData.rainIntensity,
    weatherData.source,
    weatherData.locationCode,
  ]);
}

async function persistTideData(tideData) {
  const sql = `
    INSERT INTO tidal_data (
      tide_level_cm, tide_status, high_tide_time, high_tide_level_cm,
      low_tide_time, low_tide_level_cm, prediction_date,
      source, station_code
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  await db.query(sql, [
    tideData.tideLevelCm,
    tideData.tideStatus,
    tideData.highTideTime,
    tideData.highTideLevelCm,
    tideData.lowTideTime,
    tideData.lowTideLevelCm,
    tideData.predictionDate,
    tideData.source,
    tideData.stationCode,
  ]);
}

async function fetchWeatherData(config) {
  const url = config.weatherApiBaseUrl
    ? new URL(config.weatherApiBaseUrl)
    : buildBmkgWeatherUrl(config);

  if (url.hostname.includes('bmkg.go.id') && !url.searchParams.has('adm4')) {
    url.searchParams.set('adm4', String(config.weatherBmkgAdm4 || '').trim() || '97.73.04');
  }

  attachApiKey(url, config.weatherApiKey);

  const timeout = withTimeout(10000);

  try {
    let payload;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'curl/7.68.0',
        },
        signal: timeout.signal,
      });

      if (!response.ok) {
        throw new Error(`Gagal memuat cuaca (${response.status})`);
      }

      payload = await response.json();
    } catch (error) {
      if (!String(error?.message || '').toLowerCase().includes('fetch failed')) {
        throw error;
      }

      payload = await requestJsonViaHttps(url, 10000);
    }

    if (url.hostname.includes('open-meteo.com')) {
      payload.source = 'OPEN_METEO';
    }
    const weatherData = parseWeatherPayload(payload, config);

    try {
      await persistWeatherData(weatherData);
    } catch (error) {
      // Keep API response even if persistence fails.
    }

    return {
      requestUrl: url.toString(),
      weatherData,
      raw: payload,
    };
  } finally {
    timeout.cleanup();
  }
}

function getCooldownMs(envKey, fallbackMs) {
  const rawValue = Number(process.env[envKey]);
  if (!Number.isFinite(rawValue) || rawValue <= 0) return fallbackMs;
  return rawValue;
}

async function fetchWeatherDataWithCooldown(config, options = {}) {
  const cooldownMs = getCooldownMs('WEATHER_FETCH_COOLDOWN_MS', FETCH_COOLDOWN_DEFAULTS.weatherMs);
  const now = Date.now();
  const since = now - lastFetchAt.weather;

  if (!options.force && lastFetchAt.weather && since < cooldownMs) {
    return {
      skipped: true,
      reason: 'cooldown',
      cooldownMs,
      lastFetchAt: new Date(lastFetchAt.weather).toISOString(),
      retryAfterMs: cooldownMs - since,
    };
  }

  const result = await fetchWeatherData(config);
  lastFetchAt.weather = Date.now();
  return {
    skipped: false,
    cooldownMs,
    lastFetchAt: new Date(lastFetchAt.weather).toISOString(),
    result,
  };
}

async function fetchTideData(config) {
  if (!config.tideApiBaseUrl) {
    throw new Error('TIDE_API_BASE_URL belum diatur');
  }

  const url = new URL(config.tideApiBaseUrl);
  const useStormGlass = isStormGlassUrl(url);

  if (config.tideStationCode && !url.searchParams.has('station') && !useStormGlass && !url.hostname.includes('open-meteo.com')) {
    url.searchParams.set('station', config.tideStationCode);
  }

  attachApiKey(url, config.tideApiKey);

  // Build request headers
  const requestHeaders = { Accept: 'application/json' };
  if (useStormGlass && config.tideApiKey) {
    requestHeaders['Authorization'] = config.tideApiKey;
  }

  const timeout = withTimeout(10000);

  try {
    let payload;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: requestHeaders,
        signal: timeout.signal,
      });

      if (!response.ok) {
        throw new Error(`Gagal memuat pasang surut (${response.status})`);
      }

      payload = await response.json();
    } catch (error) {
      if (!String(error?.message || '').toLowerCase().includes('fetch failed')) {
        throw error;
      }

      payload = await requestJsonViaHttps(url, 10000);
    }

    // Use StormGlass-specific parser when applicable
    const tideData = useStormGlass
      ? parseStormGlassTidePayload(payload, config)
      : parseTidePayload(payload, config);

    try {
      await persistTideData(tideData);
    } catch (error) {
      // Keep API response even if persistence fails.
    }

    return {
      requestUrl: url.toString(),
      tideData,
      raw: payload,
    };
  } finally {
    timeout.cleanup();
  }
}

async function fetchTideDataWithCooldown(config, options = {}) {
  const cooldownMs = getCooldownMs('TIDE_FETCH_COOLDOWN_MS', FETCH_COOLDOWN_DEFAULTS.tideMs);
  const now = Date.now();
  const since = now - lastFetchAt.tide;

  if (!options.force && lastFetchAt.tide && since < cooldownMs) {
    return {
      skipped: true,
      reason: 'cooldown',
      cooldownMs,
      lastFetchAt: new Date(lastFetchAt.tide).toISOString(),
      retryAfterMs: cooldownMs - since,
    };
  }

  const result = await fetchTideData(config);
  lastFetchAt.tide = Date.now();
  return {
    skipped: false,
    cooldownMs,
    lastFetchAt: new Date(lastFetchAt.tide).toISOString(),
    result,
  };
}

function toPublicConfig(config) {
  return {
    weatherApiBaseUrl: config.weatherApiBaseUrl || '',
    weatherApiKey: config.weatherApiKey || '',
    weatherBmkgAdm4: config.weatherBmkgAdm4 || '',
    tideApiBaseUrl: config.tideApiBaseUrl || '',
    tideApiKey: config.tideApiKey || '',
    tideStationCode: config.tideStationCode || '',
  };
}

module.exports = {
  getIntegrationConfig,
  saveIntegrationConfig,
  fetchWeatherData,
  fetchTideData,
  fetchWeatherDataWithCooldown,
  fetchTideDataWithCooldown,
  toPublicConfig,
};
