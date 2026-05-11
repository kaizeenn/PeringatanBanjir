import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, BrainCircuit, CheckCircle2, Play, Waves } from 'lucide-react';
import Swal from 'sweetalert2';
import { fetchPredictionMeta, testPredictionModel } from '@/features/predictions/predictionApi';

const SENSOR_HEIGHT_CM = 100;

const defaultForm = {
  device_id: 'TEST-MODEL',
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

function getWaterStatus(waterLevelCm) {
  if (waterLevelCm >= 80) return { label: 'Bahaya', className: 'status-badge-danger' };
  if (waterLevelCm >= 60) return { label: 'Siaga', className: 'status-badge-alert' };
  return { label: 'Aman', className: 'status-badge-safe' };
}

function riskBadgeClass(label) {
  if (label === 'banjir') return 'status-badge-danger';
  if (label === 'waspada') return 'status-badge-alert';
  return 'status-badge-safe';
}

const ModelTestPage = () => {
  const [form, setForm] = useState(defaultForm);
  const [result, setResult] = useState(null);
  const metaQuery = useQuery({ queryKey: ['prediction-meta'], queryFn: fetchPredictionMeta });

  const distanceCm = toNumber(form.distance_cm, 0);
  const waterLevelCm = Math.max(0, Number((SENSOR_HEIGHT_CM - distanceCm).toFixed(2)));
  const waterStatus = getWaterStatus(waterLevelCm);

  const mutation = useMutation({
    mutationFn: testPredictionModel,
    onSuccess: (data) => {
      setResult(data);
      Swal.fire({
        title: 'Test model berhasil',
        text: `Hasil: ${String(data.risk_label || '-').toUpperCase()} (${formatPercent(data.flood_probability)})`,
        icon: data.risk_label === 'banjir' ? 'warning' : 'success',
        background: 'hsl(222, 25%, 12%)',
        color: 'hsl(210, 20%, 92%)',
        confirmButtonColor: 'hsl(142, 72%, 29%)',
      });
    },
    onError: (error) => {
      Swal.fire({
        title: 'Test model gagal',
        text: error.message,
        icon: 'error',
        background: 'hsl(222, 25%, 12%)',
        color: 'hsl(210, 20%, 92%)',
      });
    },
  });

  const handleChange = (key) => (event) => {
    setForm((current) => ({ ...current, [key]: event.target.value }));
  };

  const applyScenario = (input) => {
    setForm((current) => ({ ...current, ...input }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    mutation.mutate({
      device_id: form.device_id || 'TEST-MODEL',
      rainfall_mm: toNumber(form.rainfall_mm),
      rainfall_lag1: toNumber(form.rainfall_lag1),
      rainfall_lag2: toNumber(form.rainfall_lag2),
      rainfall_7day: toNumber(form.rainfall_7day),
      tide_max_m: toNumber(form.tide_max_m, 0.5),
      month: toNumber(form.month, new Date().getMonth() + 1),
      water_level_cm: waterLevelCm,
    });
  };

  return (<div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-card-foreground">🧪 Test Model ML</h2>
          <p className="text-sm text-muted-foreground">Halaman simulasi untuk mengetes model dari input sensor ultrasonic tanpa menyimpan ke database.</p>
        </div>
        <div className="text-xs text-muted-foreground bg-card border border-border rounded-lg px-3 py-2">
          Simulasi saja · Tidak masuk database · Patokan sensor: <span className="font-semibold text-card-foreground">{SENSOR_HEIGHT_CM} cm</span>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="flood-card">
          <BrainCircuit className="w-8 h-8 text-primary mb-2"/>
          <p className="text-xs text-muted-foreground">Model Aktif</p>
          <p className="text-xl font-bold text-card-foreground">{metaQuery.data?.model?.model_type || 'Flood ML'}</p>
          <p className="text-xs text-muted-foreground mt-2">Akurasi training: {metaQuery.data?.model?.accuracy ? formatPercent(metaQuery.data.model.accuracy) : '-'}</p>
        </div>
        <div className="flood-card">
          <Waves className="w-8 h-8 text-primary mb-2"/>
          <p className="text-xs text-muted-foreground">Konversi Ultrasonic</p>
          <p className="text-2xl font-bold text-card-foreground">{waterLevelCm.toFixed(1)} cm</p>
          <p className="text-xs text-muted-foreground mt-2">100 cm - {distanceCm.toFixed(1)} cm jarak sensor</p>
        </div>
        <div className="flood-card">
          <AlertTriangle className="w-8 h-8 text-status-alert mb-2"/>
          <p className="text-xs text-muted-foreground">Status Level Air</p>
          <span className={`inline-block mt-2 px-3 py-1 rounded text-xs font-semibold ${waterStatus.className}`}>{waterStatus.label}</span>
          <p className="text-xs text-muted-foreground mt-2">Siaga ≥ 60 cm, Bahaya ≥ 80 cm</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flood-card space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-sm font-semibold text-card-foreground">Input Test</h3>
          <div className="flex flex-wrap gap-2">
            {scenarioButtons.map((scenario) => (<button key={scenario.label} type="button" onClick={() => applyScenario(scenario.input)} className="px-3 py-1.5 text-xs rounded-lg border border-border text-card-foreground hover:bg-muted">
              {scenario.label}
            </button>))}
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
          <button type="submit" disabled={mutation.isPending} className="flex items-center gap-2 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity disabled:opacity-60">
            <Play className="w-4 h-4"/> {mutation.isPending ? 'Mengetes...' : 'Test Model'}
          </button>
        </div>
      </form>

      {result && (<div className="grid lg:grid-cols-3 gap-4">
        <div className="flood-card">
          <CheckCircle2 className="w-8 h-8 text-primary mb-2"/>
          <p className="text-xs text-muted-foreground">Hasil Model</p>
          <span className={`inline-block mt-2 px-3 py-1 rounded text-xs font-semibold ${riskBadgeClass(result.risk_label)}`}>{String(result.risk_label || '-').toUpperCase()}</span>
          <p className="text-sm text-card-foreground mt-3">{result.action}</p>
        </div>
        <div className="flood-card">
          <p className="text-xs text-muted-foreground">Probabilitas Banjir</p>
          <p className="text-3xl font-bold text-primary mt-2">{formatPercent(result.flood_probability)}</p>
          <div className="space-y-2 mt-4 text-xs text-muted-foreground">
            <p>Aman: {formatPercent(result.probability?.aman)}</p>
            <p>Waspada: {formatPercent(result.probability?.waspada)}</p>
            <p>Banjir: {formatPercent(result.probability?.banjir)}</p>
          </div>
        </div>
        <div className="flood-card">
          <p className="text-xs text-muted-foreground">Input ke Model</p>
          <pre className="mt-2 text-xs bg-muted rounded-lg p-3 overflow-auto max-h-48 text-card-foreground">{JSON.stringify(result.input_received, null, 2)}</pre>
        </div>
      </div>)}
    </div>);
};

export default ModelTestPage;
