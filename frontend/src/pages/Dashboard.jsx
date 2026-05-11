import { useMemo } from 'react';
import { Droplets, CloudRain, Cpu, Bell, TrendingUp, Activity } from 'lucide-react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import {
  useLatestTideQuery,
  useLatestSensorByDeviceQuery,
  useLatestWeatherQuery,
  useTideHistoryQuery,
  useSensorHistoryQuery,
  useWeatherHistoryQuery,
} from '@/features/sensor/hooks/useSensorQueries';
import {
  buildDashboardStatus,
  buildNotificationRows,
  buildRainfallChartData,
  buildTideChartData,
  buildWaterLevelChartData,
} from '@/features/sensor/utils/sensorMappers';
import { statusLabels } from '@/shared/constants/status';
import { useLatestPredictionQuery } from '@/features/predictions/usePredictionQueries';
const statusColorMap = {
    safe: 'status-badge-safe',
    alert: 'status-badge-alert',
    danger: 'status-badge-danger',
};
const statusBgMap = {
    safe: 'bg-status-safe',
    alert: 'bg-status-alert',
    danger: 'bg-status-danger',
};
const tideStatusLabelMap = {
  high: 'Pasang',
  low: 'Surut',
  rising: 'Naik',
  falling: 'Turun',
};
const tideStatusBadgeClassMap = {
  high: 'bg-amber-500/20 text-amber-100 border border-amber-200/40',
  low: 'bg-cyan-500/20 text-cyan-100 border border-cyan-200/40',
  rising: 'bg-emerald-500/20 text-emerald-100 border border-emerald-200/40',
  falling: 'bg-rose-500/20 text-rose-100 border border-rose-200/40',
};

function formatTideTime(value) {
  if (!value || typeof value !== 'string') return '--:--';

  const [hour, minute] = value.split(':');
  if (hour == null || minute == null) return '--:--';

  return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
}

function formatPredictionTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

const Dashboard = () => {
    const historyQuery = useSensorHistoryQuery();
    const latestQuery = useLatestSensorByDeviceQuery();
    const latestWeatherQuery = useLatestWeatherQuery();
    const latestTideQuery = useLatestTideQuery();
    const weatherHistoryQuery = useWeatherHistoryQuery();
    const tideHistoryQuery = useTideHistoryQuery();
    const latestPredictionQuery = useLatestPredictionQuery();
    const data = useMemo(() => buildDashboardStatus(latestQuery.data, historyQuery.data), [latestQuery.data, historyQuery.data]);
    const waterLevelChartData = useMemo(() => buildWaterLevelChartData(historyQuery.data), [historyQuery.data]);
    const rainfallChartData = useMemo(() => buildRainfallChartData(weatherHistoryQuery.data), [weatherHistoryQuery.data]);
    const tideChartData = useMemo(() => buildTideChartData(tideHistoryQuery.data), [tideHistoryQuery.data]);
    const notifications = useMemo(() => buildNotificationRows(historyQuery.data), [historyQuery.data]);
    const latestWeather = latestWeatherQuery.data;
    const latestTide = latestTideQuery.data;
    const latestPrediction = latestPredictionQuery.data;
    const hasPrediction = Boolean(latestPrediction);
    const realtimeStatus = hasPrediction ? latestPrediction.status : 'safe';
    const realtimeWaterLevel = hasPrediction && latestPrediction.predicted_level_cm != null
      ? toNumber(latestPrediction.predicted_level_cm)
      : 0;
    const realtimeProbability = latestPrediction?.flood_probability != null
      ? toNumber(latestPrediction.flood_probability)
      : null;
    const rainfallDisplay = useMemo(() => {
      const hasRainfallValue = latestWeather?.rainfall_mm != null && latestWeather?.rainfall_mm !== '';
      const rainfall = Number(latestWeather?.rainfall_mm);
      const rainfallText = hasRainfallValue && Number.isFinite(rainfall) ? `${rainfall.toFixed(1)} mm` : '';
      const weatherDesc = latestWeather?.weather_desc || '';

      if (weatherDesc && rainfallText) return `${weatherDesc} - ${rainfallText}`;
      return weatherDesc || rainfallText || '-';
    }, [latestWeather]);
    const rainMetaText = useMemo(() => {
      const probability = Number(latestWeather?.precipitation_probability);
      const probabilityMax = Number(latestWeather?.precipitation_probability_max);
      const durationHours = Number(latestWeather?.precipitation_hours);
      const sumMm = Number(latestWeather?.precipitation_sum_mm);
      const parts = [];

      if (Number.isFinite(probability)) {
        parts.push(`Peluang ${probability.toFixed(0)}%`);
      }

      if (Number.isFinite(probabilityMax)) {
        parts.push(`Max ${probabilityMax.toFixed(0)}%`);
      }

      if (Number.isFinite(durationHours)) {
        parts.push(`Durasi ${durationHours.toFixed(1)} jam`);
      }

      if (Number.isFinite(sumMm)) {
        parts.push(`Akumulasi ${sumMm.toFixed(1)} mm`);
      }

      return parts.length ? parts.join(' - ') : '-';
    }, [latestWeather]);
    const weatherSourceText = useMemo(() => {
      const lat = Number(latestWeather?.open_meteo_lat);
      const lon = Number(latestWeather?.open_meteo_lon);
      const timezone = latestWeather?.open_meteo_timezone;

      if (Number.isFinite(lat) && Number.isFinite(lon) && timezone) {
        return `Open-Meteo ${lat.toFixed(2)}, ${lon.toFixed(2)} (${timezone})`;
      }

      if (latestWeather?.source) {
        return `Sumber ${latestWeather.source}`;
      }

      return '';
    }, [latestWeather]);
    const tideDisplay = useMemo(() => {
      const tideLevel = Number(latestTide?.tide_level_cm);
      const tideLevelText = Number.isFinite(tideLevel) ? `${tideLevel.toFixed(1)}` : '-';
      const tideStatusText = tideStatusLabelMap[latestTide?.tide_status] || '';

      if (tideStatusText) return `${tideLevelText} - ${tideStatusText}`;
      return tideLevelText;
    }, [latestTide]);
    const tideStatusLabel = tideStatusLabelMap[latestTide?.tide_status] || 'Tidak tersedia';
    const tideStatusBadgeClass = tideStatusBadgeClassMap[latestTide?.tide_status] || 'bg-white/15 text-white border border-white/30';
    const highTideTimeText = formatTideTime(latestTide?.high_tide_time);
    const lowTideTimeText = formatTideTime(latestTide?.low_tide_time);
    const stats = [
        { icon: Cpu, label: 'Total Perangkat', value: data.devicesTotal, sub: `${data.devicesOnline} online` },
        { icon: Activity, label: 'Perangkat Online', value: data.devicesOnline, sub: `dari ${data.devicesTotal}` },
        { icon: Bell, label: 'Probabilitas ML', value: realtimeProbability == null ? '-' : `${Math.round(realtimeProbability * 100)}%`, sub: latestPrediction ? 'prediksi terbaru' : 'belum ada prediksi' },
        { icon: TrendingUp, label: 'Rata-rata Tinggi Air', value: `${data.avgWaterLevel} cm`, sub: '24 jam terakhir' },
    ];
    if (
      historyQuery.isLoading ||
      latestQuery.isLoading ||
      latestWeatherQuery.isLoading ||
      latestTideQuery.isLoading ||
      weatherHistoryQuery.isLoading ||
      tideHistoryQuery.isLoading ||
      latestPredictionQuery.isLoading
    ) {
        return (<div className="flood-card">
        <p className="text-sm text-muted-foreground">Memuat data dashboard dan prediksi model...</p>
      </div>);
    }
    if (
      historyQuery.isError ||
      latestQuery.isError ||
      latestWeatherQuery.isError ||
      latestTideQuery.isError ||
      weatherHistoryQuery.isError ||
      tideHistoryQuery.isError ||
      latestPredictionQuery.isError
    ) {
        return (<div className="flood-card border border-status-danger/40">
        <p className="text-sm text-status-danger">Gagal memuat data dashboard/prediksi. Pastikan backend berjalan di port 3000 dan sudah login.</p>
      </div>);
    }
    return (<div className="space-y-6">
      {/* Status banner */}
      <div className={`rounded-xl p-6 ${statusBgMap[realtimeStatus]} text-primary-foreground flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4`}>
        <div>
          <p className="text-sm font-medium opacity-90">Status Banjir Saat Ini</p>
          <h2 className="text-3xl font-bold mt-1">{hasPrediction ? statusLabels[realtimeStatus].toUpperCase() : 'BELUM ADA PREDIKSI'}</h2>
          <p className="text-sm opacity-80 mt-1">
            Status realtime hanya memakai prediksi model ML{latestPrediction?.prediction_time ? ` · ${formatPredictionTime(latestPrediction.prediction_time)}` : ' · jalankan prediksi terlebih dahulu'}
          </p>
        </div>
        <div className="flex gap-6">
          <div className="text-center">
            <Droplets className="w-8 h-8 mx-auto mb-1 opacity-80"/>
            <p className="text-2xl font-bold">{hasPrediction ? realtimeWaterLevel.toFixed(1) : '-'}</p>
            <p className="text-xs opacity-80">cm (Prediksi ML)</p>
          </div>
          <div className="text-center">
            <CloudRain className="w-8 h-8 mx-auto mb-1 opacity-80"/>
            <p className="text-2xl font-bold">{rainfallDisplay}</p>
            <p className="text-[11px] opacity-80 mt-1">{rainMetaText}</p>
            {weatherSourceText ? (<p className="text-[10px] opacity-70 mt-1">{weatherSourceText}</p>) : null}
          </div>
          <div className="text-center">
            <Droplets className="w-8 h-8 mx-auto mb-1 opacity-80"/>
            <p className="text-2xl font-bold">{tideDisplay}</p>
            <p className="text-[11px] opacity-90 mt-1">High {highTideTimeText} • Low {lowTideTimeText}</p>
          </div>
        </div>
      </div>

      {/* Status indicators */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {['safe', 'alert', 'danger'].map(s => (<div key={s} className={`rounded-lg px-4 py-3 text-center font-semibold text-sm ${statusColorMap[s]} ${hasPrediction && realtimeStatus === s ? 'ring-2 ring-offset-2 ring-offset-background' : 'opacity-50'}`} style={{ ['--tw-ring-color']: undefined }}>
            {statusLabels[s]}
          </div>))}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(({ icon: Icon, label, value, sub }) => (<div key={label} className="stat-card">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Icon className="w-5 h-5 text-primary"/>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-lg font-bold text-card-foreground">{value}</p>
              <p className="text-[11px] text-muted-foreground">{sub}</p>
            </div>
          </div>))}
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="flood-card">
          <h3 className="text-sm font-semibold text-card-foreground mb-4">📊 Tren Tinggi Air (24 Jam)</h3>
          {waterLevelChartData.length === 0 ? (
            <div className="h-[250px] rounded-lg border border-dashed border-border flex items-center justify-center text-center px-4">
              <p className="text-sm text-muted-foreground">Belum ada data realtime tinggi air dalam 24 jam terakhir.</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={waterLevelChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))"/>
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}/>
                <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}/>
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', color: 'hsl(var(--card-foreground))' }}/>
                <Area type="monotone" dataKey="level" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.15} strokeWidth={2}/>
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="flood-card">
          <h3 className="text-sm font-semibold text-card-foreground mb-4">🌧️ Curah Hujan (24 Jam)</h3>
          {rainfallChartData.length === 0 ? (
            <div className="h-[250px] rounded-lg border border-dashed border-border flex items-center justify-center text-center px-4">
              <p className="text-sm text-muted-foreground">Belum ada data curah hujan Open-Meteo dalam 24 jam terakhir.</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={rainfallChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))"/>
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}/>
                <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}/>
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', color: 'hsl(var(--card-foreground))' }}/>
                <Bar dataKey="rainfall" fill="hsl(var(--status-alert))" radius={[4, 4, 0, 0]}/>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="flood-card">
          <h3 className="text-sm font-semibold text-card-foreground mb-4">🌊 Pasang Surut (24 Jam)</h3>
          {tideChartData.length === 0 ? (
            <div className="h-[250px] rounded-lg border border-dashed border-border flex items-center justify-center text-center px-4">
              <p className="text-sm text-muted-foreground">Belum ada data pasang surut dalam 24 jam terakhir.</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={tideChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))"/>
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}/>
                <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}/>
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', color: 'hsl(var(--card-foreground))' }}/>
                <Area type="monotone" dataKey="level" stroke="hsl(var(--status-alert))" fill="hsl(var(--status-alert))" fillOpacity={0.18} strokeWidth={2}/>
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Notifications */}
      <div className="flood-card">
        <h3 className="text-sm font-semibold text-card-foreground mb-4">🔔 Notifikasi Aktif</h3>
        <div className="space-y-2">
          {notifications.slice(0, 4).map(n => (<div key={n.id} className={`flex items-start gap-3 p-3 rounded-lg border ${!n.read ? 'bg-muted/50' : ''}`}>
              <span className={`mt-0.5 inline-block px-2 py-0.5 rounded text-[10px] font-bold ${statusColorMap[n.type]}`}>
                {statusLabels[n.type]}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-card-foreground">{n.title}</p>
                <p className="text-xs text-muted-foreground truncate">{n.message}</p>
              </div>
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                {new Date(n.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>))}
        </div>
      </div>
    </div>);
};
export default Dashboard;
