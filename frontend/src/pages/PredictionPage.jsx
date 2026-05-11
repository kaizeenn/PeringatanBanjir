import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { AlertTriangle, BrainCircuit, Play, RefreshCw, ShieldCheck } from 'lucide-react';
import Swal from 'sweetalert2';
import {
  fetchPredictionHistory,
  fetchPredictionMeta,
  runAutoPrediction,
  runManualPrediction,
} from '@/features/predictions/predictionApi';

const badgeClass = {
  safe: 'status-badge-safe',
  alert: 'status-badge-alert',
  danger: 'status-badge-danger',
};

const statusLabels = {
  safe: 'Aman',
  alert: 'Waspada',
  danger: 'Banjir',
};

const SENSOR_HEIGHT_CM = 100;

const initialForm = {
  device_id: 'MANUAL',
  distance_cm: 30,
  rainfall_mm: 45,
  rainfall_lag1: 20,
  rainfall_lag2: 10,
  rainfall_7day: 100,
  tide_max_m: 1.1,
  month: new Date().getMonth() + 1,
};

const scenarioButtons = [
  {
    label: 'Aman',
    input: { distance_cm: 85, rainfall_mm: 0, rainfall_lag1: 0, rainfall_lag2: 0, rainfall_7day: 5, tide_max_m: 0.4 },
  },
  {
    label: 'Waspada',
    input: { distance_cm: 35, rainfall_mm: 25, rainfall_lag1: 15, rainfall_lag2: 10, rainfall_7day: 75, tide_max_m: 0.8 },
  },
  {
    label: 'Banjir',
    input: { distance_cm: 10, rainfall_mm: 70, rainfall_lag1: 45, rainfall_lag2: 25, rainfall_7day: 180, tide_max_m: 1.3 },
  },
];

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function formatPercent(value) {
  return `${Math.round(toNumber(value, 0) * 100)}%`;
}

function toDateLabel(value) {
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

function getWaterStatus(waterLevelCm) {
  if (waterLevelCm >= 80) return { label: 'Bahaya', className: 'status-badge-danger' };
  if (waterLevelCm >= 60) return { label: 'Siaga', className: 'status-badge-alert' };
  return { label: 'Aman', className: 'status-badge-safe' };
}

const PredictionPage = () => {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(initialForm);

  const metaQuery = useQuery({
    queryKey: ['prediction-meta'],
    queryFn: fetchPredictionMeta,
  });

  const historyQuery = useQuery({
    queryKey: ['prediction-history'],
    queryFn: () => fetchPredictionHistory(30),
    refetchInterval: 60_000,
  });

  const manualMutation = useMutation({
    mutationFn: runManualPrediction,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['prediction-history'] });
      Swal.fire({
        title: 'Prediksi berhasil',
        text: `Status: ${result.risk_label?.toUpperCase()} (${formatPercent(result.flood_probability)})`,
        icon: result.status === 'danger' ? 'warning' : 'success',
        background: 'hsl(222, 25%, 12%)',
        color: 'hsl(210, 20%, 92%)',
        confirmButtonColor: 'hsl(142, 72%, 29%)',
      });
    },
    onError: (error) => {
      Swal.fire({ title: 'Gagal', text: error.message, icon: 'error', background: 'hsl(222, 25%, 12%)', color: 'hsl(210, 20%, 92%)' });
    },
  });

  const autoMutation = useMutation({
    mutationFn: runAutoPrediction,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['prediction-history'] });
      Swal.fire({
        title: 'Prediksi otomatis selesai',
        text: `Status: ${result.risk_label?.toUpperCase()} untuk ${result.device_id || 'AUTO'}`,
        icon: result.status === 'danger' ? 'warning' : 'success',
        background: 'hsl(222, 25%, 12%)',
        color: 'hsl(210, 20%, 92%)',
        confirmButtonColor: 'hsl(142, 72%, 29%)',
      });
    },
    onError: (error) => {
      Swal.fire({ title: 'Gagal', text: error.message, icon: 'error', background: 'hsl(222, 25%, 12%)', color: 'hsl(210, 20%, 92%)' });
    },
  });

  const history = historyQuery.data || [];
  const latest = history[0] || null;
  const model = metaQuery.data?.model;
  const distanceCm = toNumber(form.distance_cm, 0);
  const waterLevelCm = Math.max(0, Number((SENSOR_HEIGHT_CM - distanceCm).toFixed(2)));
  const waterStatus = getWaterStatus(waterLevelCm);

  const chartData = useMemo(() => history.slice().reverse().map((item) => ({
    time: toDateLabel(item.prediction_time),
    actual: item.actual_level_cm ?? item.predicted_level_cm,
    predicted: item.predicted_level_cm,
    probability: Math.round(toNumber(item.flood_probability, 0) * 100),
  })), [history]);

  const handleChange = (key) => (event) => {
    setForm((current) => ({
      ...current,
      [key]: event.target.value,
    }));
  };

  const applyScenario = (input) => {
    setForm((current) => ({ ...current, ...input }));
  };

  const handleManualSubmit = (event) => {
    event.preventDefault();
    manualMutation.mutate({
      device_id: form.device_id || 'MANUAL',
      rainfall_mm: toNumber(form.rainfall_mm),
      rainfall_lag1: toNumber(form.rainfall_lag1),
      rainfall_lag2: toNumber(form.rainfall_lag2),
      rainfall_7day: toNumber(form.rainfall_7day),
      tide_max_m: toNumber(form.tide_max_m, 0.5),
      month: toNumber(form.month, new Date().getMonth() + 1),
      water_level_cm: waterLevelCm,
    });
  };

  const handleAutoRun = () => {
    Swal.fire({
      title: 'Jalankan prediksi otomatis?',
      text: 'Sistem akan memakai data sensor, cuaca, dan pasang surut terbaru dari database.',
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: 'hsl(142, 72%, 29%)',
      confirmButtonText: 'Jalankan',
      cancelButtonText: 'Batal',
      background: 'hsl(222, 25%, 12%)',
      color: 'hsl(210, 20%, 92%)',
    }).then((result) => {
      if (result.isConfirmed) autoMutation.mutate();
    });
  };

  const loading = historyQuery.isLoading || metaQuery.isLoading;

  return (<div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-card-foreground">🧠 Prediksi Machine Learning</h2>
          <p className="text-sm text-muted-foreground">Terintegrasi dengan model lokal flood_ml (Python + XGBoost).</p>
        </div>
        <button onClick={handleAutoRun} disabled={autoMutation.isPending} className="flex items-center justify-center gap-2 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity disabled:opacity-60">
          <RefreshCw className={`w-4 h-4 ${autoMutation.isPending ? 'animate-spin' : ''}`}/> Run Auto
        </button>
      </div>

      {historyQuery.error && <div className="flood-card border-destructive/50 text-sm text-destructive">{historyQuery.error.message}</div>}

      <div className="grid sm:grid-cols-4 gap-4">
        <div className="flood-card text-center">
          <BrainCircuit className="w-8 h-8 text-primary mx-auto mb-2"/>
          <p className="text-xs text-muted-foreground">Model</p>
          <p className="text-xl font-bold text-card-foreground">{model?.model_type || 'Flood ML'}</p>
          <p className="text-xs text-muted-foreground mt-2">Akurasi: {model?.accuracy ? formatPercent(model.accuracy) : '-'}</p>
        </div>
        <div className="flood-card text-center">
          <ShieldCheck className="w-8 h-8 text-primary mx-auto mb-2"/>
          <p className="text-xs text-muted-foreground">Prediksi Terbaru</p>
          <p className="text-2xl font-bold text-card-foreground">{latest ? `${toNumber(latest.predicted_level_cm).toFixed(1)} cm` : '-'}</p>
          <span className={`inline-block mt-2 px-2 py-0.5 rounded text-[11px] font-semibold ${badgeClass[latest?.status] || 'status-badge-safe'}`}>
            {statusLabels[latest?.status] || (loading ? 'Memuat...' : 'Belum Ada')}
          </span>
        </div>
        <div className="flood-card text-center">
          <AlertTriangle className="w-8 h-8 text-status-alert mx-auto mb-2"/>
          <p className="text-xs text-muted-foreground">Probabilitas Banjir</p>
          <p className="text-2xl font-bold text-primary mt-3">{latest ? formatPercent(latest.flood_probability) : '-'}</p>
          <p className="text-xs text-muted-foreground mt-2">Confidence: {latest ? formatPercent(latest.confidence_score) : '-'}</p>
        </div>
        <div className="flood-card text-center">
          <p className="text-xs text-muted-foreground">Prediksi H-1</p>
          <p className="text-xl font-bold text-card-foreground mt-3">{latest ? toDateLabel(latest.prediction_time) : '-'}</p>
          <p className="text-xs text-muted-foreground mt-2">Total riwayat tampil: {history.length}</p>
        </div>
      </div>

      <form onSubmit={handleManualSubmit} className="flood-card space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-card-foreground">▶️ Prediksi Manual</h3>
            <p className="text-xs text-muted-foreground mt-1">Input jarak ultrasonic akan dikonversi ke tinggi air: 100 cm - jarak sensor. Hasil prediksi ini disimpan ke database.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {scenarioButtons.map((scenario) => (<button key={scenario.label} type="button" onClick={() => applyScenario(scenario.input)} className="px-3 py-1.5 text-xs rounded-lg border border-border text-card-foreground hover:bg-muted">
              {scenario.label}
            </button>))}
          </div>
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          <div className="rounded-lg border border-border bg-muted/40 p-4">
            <p className="text-xs text-muted-foreground">Jarak Ultrasonic</p>
            <p className="text-2xl font-bold text-card-foreground mt-1">{distanceCm.toFixed(1)} cm</p>
            <p className="text-xs text-muted-foreground mt-2">Jarak sensor ke permukaan air</p>
          </div>
          <div className="rounded-lg border border-border bg-muted/40 p-4">
            <p className="text-xs text-muted-foreground">Tinggi Air Sungai</p>
            <p className="text-2xl font-bold text-primary mt-1">{waterLevelCm.toFixed(1)} cm</p>
            <p className="text-xs text-muted-foreground mt-2">100 cm - {distanceCm.toFixed(1)} cm</p>
          </div>
          <div className="rounded-lg border border-border bg-muted/40 p-4">
            <p className="text-xs text-muted-foreground">Status Level Air</p>
            <span className={`inline-block mt-2 px-3 py-1 rounded text-xs font-semibold ${waterStatus.className}`}>{waterStatus.label}</span>
            <p className="text-xs text-muted-foreground mt-3">Siaga ≥ 60 cm, Bahaya ≥ 80 cm</p>
          </div>
        </div>

        <div className="grid sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <label className="text-xs text-muted-foreground">Device ID
            <input value={form.device_id} onChange={handleChange('device_id')} className="w-full mt-1 px-3 py-2 rounded-lg bg-muted border border-border text-card-foreground text-sm focus:ring-2 focus:ring-primary/30 focus:outline-none"/>
          </label>
          <label className="text-xs text-muted-foreground">Jarak Ultrasonic (cm)
            <input type="number" step="0.1" value={form.distance_cm} onChange={handleChange('distance_cm')} className="w-full mt-1 px-3 py-2 rounded-lg bg-muted border border-border text-card-foreground text-sm focus:ring-2 focus:ring-primary/30 focus:outline-none"/>
          </label>
          <label className="text-xs text-muted-foreground">Hujan Hari Ini (mm)
            <input type="number" step="0.1" value={form.rainfall_mm} onChange={handleChange('rainfall_mm')} className="w-full mt-1 px-3 py-2 rounded-lg bg-muted border border-border text-card-foreground text-sm focus:ring-2 focus:ring-primary/30 focus:outline-none"/>
          </label>
          <label className="text-xs text-muted-foreground">Hujan H-1 (mm)
            <input type="number" step="0.1" value={form.rainfall_lag1} onChange={handleChange('rainfall_lag1')} className="w-full mt-1 px-3 py-2 rounded-lg bg-muted border border-border text-card-foreground text-sm focus:ring-2 focus:ring-primary/30 focus:outline-none"/>
          </label>
          <label className="text-xs text-muted-foreground">Hujan H-2 (mm)
            <input type="number" step="0.1" value={form.rainfall_lag2} onChange={handleChange('rainfall_lag2')} className="w-full mt-1 px-3 py-2 rounded-lg bg-muted border border-border text-card-foreground text-sm focus:ring-2 focus:ring-primary/30 focus:outline-none"/>
          </label>
          <label className="text-xs text-muted-foreground">Total Hujan 7 Hari (mm)
            <input type="number" step="0.1" value={form.rainfall_7day} onChange={handleChange('rainfall_7day')} className="w-full mt-1 px-3 py-2 rounded-lg bg-muted border border-border text-card-foreground text-sm focus:ring-2 focus:ring-primary/30 focus:outline-none"/>
          </label>
          <label className="text-xs text-muted-foreground">Pasut Maks (m)
            <input type="number" step="0.01" value={form.tide_max_m} onChange={handleChange('tide_max_m')} className="w-full mt-1 px-3 py-2 rounded-lg bg-muted border border-border text-card-foreground text-sm focus:ring-2 focus:ring-primary/30 focus:outline-none"/>
          </label>
          <label className="text-xs text-muted-foreground">Bulan
            <input type="number" min="1" max="12" value={form.month} onChange={handleChange('month')} className="w-full mt-1 px-3 py-2 rounded-lg bg-muted border border-border text-card-foreground text-sm focus:ring-2 focus:ring-primary/30 focus:outline-none"/>
          </label>
        </div>

        <div className="flex justify-end">
          <button type="submit" disabled={manualMutation.isPending} className="flex items-center gap-2 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity disabled:opacity-60">
            <Play className="w-4 h-4"/> {manualMutation.isPending ? 'Memproses...' : 'Jalankan & Simpan'}
          </button>
        </div>
      </form>

      <div className="flood-card">
        <h3 className="text-sm font-semibold text-card-foreground mb-4">📈 Riwayat Actual vs Prediction</h3>
        {chartData.length === 0 ? <p className="text-sm text-muted-foreground">Belum ada data prediksi. Jalankan prediksi manual atau otomatis.</p> : <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))"/>
            <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}/>
            <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}/>
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', color: 'hsl(var(--card-foreground))' }}/>
            <Legend />
            <Line type="monotone" dataKey="actual" stroke="hsl(var(--status-alert))" strokeWidth={2} dot={false} name="Aktual/Input"/>
            <Line type="monotone" dataKey="predicted" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} name="Prediksi" strokeDasharray="5 5"/>
          </LineChart>
        </ResponsiveContainer>}
      </div>

      <div className="flood-card">
        <h3 className="text-sm font-semibold text-card-foreground mb-4">🗂️ Riwayat Prediksi</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="p-2 font-medium">Waktu</th>
                <th className="p-2 font-medium">Device</th>
                <th className="p-2 font-medium">Level</th>
                <th className="p-2 font-medium">Prob.</th>
                <th className="p-2 font-medium">Status</th>
                <th className="p-2 font-medium">Model</th>
              </tr>
            </thead>
            <tbody>
              {history.map((item) => (<tr key={item.id} className="border-b border-border/50">
                <td className="p-2 text-card-foreground">{toDateLabel(item.prediction_time)}</td>
                <td className="p-2 text-muted-foreground">{item.device_id || '-'}</td>
                <td className="p-2 text-card-foreground">{toNumber(item.predicted_level_cm).toFixed(1)} cm</td>
                <td className="p-2 text-primary font-semibold">{formatPercent(item.flood_probability)}</td>
                <td className="p-2"><span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${badgeClass[item.status] || 'status-badge-safe'}`}>{statusLabels[item.status] || item.risk_level}</span></td>
                <td className="p-2 text-muted-foreground">{item.model_name || '-'}</td>
              </tr>))}
              {history.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">Belum ada riwayat prediksi.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>);
};

export default PredictionPage;
