import { useEffect, useMemo, useState } from 'react';
import {
  fetchExternalConfig,
  triggerCombinedFetch,
  triggerTideFetch,
  triggerWeatherFetch,
  updateExternalConfig,
} from '@/features/sensor/api/externalApi';

const initialConfig = {
  weatherApiBaseUrl: 'https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4=35.29.13.2007',
  weatherApiKey: '',
  weatherLocationLat: '-7.0167',
  weatherLocationLon: '113.8667',
  weatherBmkgAdm4: '',
};

const SettingsPage = () => {
    const [config, setConfig] = useState(initialConfig);
    const [loadingConfig, setLoadingConfig] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [fetchResult, setFetchResult] = useState(null);
    const [fetchingType, setFetchingType] = useState('');

    useEffect(() => {
      let mounted = true;

      async function loadConfig() {
        setLoadingConfig(true);
        setError('');

        try {
          const remoteConfig = await fetchExternalConfig();
          if (!mounted) return;
          setConfig({
            ...initialConfig,
            ...(remoteConfig || {}),
          });
        } catch (loadError) {
          if (!mounted) return;
          setError(loadError.message);
        } finally {
          if (mounted) setLoadingConfig(false);
        }
      }

      loadConfig();
      return () => {
        mounted = false;
      };
    }, []);

    const isBusy = useMemo(() => saving || Boolean(fetchingType), [saving, fetchingType]);

    function handleConfigChange(event) {
      const { name, value } = event.target;
      setConfig((prev) => ({
        ...prev,
        [name]: value,
      }));
    }

    async function handleSave(event) {
      event.preventDefault();
      setSaving(true);
      setError('');
      setMessage('');

      try {
        const saved = await updateExternalConfig(config);
        setConfig({
          ...initialConfig,
          ...(saved || {}),
        });
        setMessage('Konfigurasi cuaca dan pasang surut berhasil disimpan.');
      } catch (saveError) {
        setError(saveError.message);
      } finally {
        setSaving(false);
      }
    }

    async function handleFetch(type) {
      setFetchingType(type);
      setError('');
      setMessage('');

      try {
        let result;
        if (type === 'weather') {
          result = await triggerWeatherFetch();
        } else if (type === 'tide') {
          result = await triggerTideFetch();
        } else {
          result = await triggerCombinedFetch();
        }

        setFetchResult(result);
        setMessage('Fetch data eksternal berhasil dijalankan.');
      } catch (fetchError) {
        setError(fetchError.message);
      } finally {
        setFetchingType('');
      }
    }

    return (<div className="space-y-6">
      <h2 className="text-xl font-bold text-card-foreground">⚙️ Pengaturan</h2>

      {(message || error) && (<div className={`rounded-lg border px-4 py-3 text-sm ${error ? 'border-status-danger/40 text-status-danger' : 'border-primary/30 text-primary'}`}>
          {error || message}
        </div>)}

      <div className="grid lg:grid-cols-2 gap-6">
        <form className="flood-card space-y-4" onSubmit={handleSave}>
          <h3 className="text-sm font-semibold text-card-foreground">Umum</h3>
          <div>
            <label className="text-xs text-muted-foreground">Nama Sistem</label>
            <input defaultValue="Sistem Peringatan Banjir Desa" className="w-full mt-1 px-3 py-2 rounded-lg bg-muted border border-border text-card-foreground text-sm focus:ring-2 focus:ring-primary/30 focus:outline-none"/>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Interval Refresh Data (detik)</label>
            <input type="number" defaultValue={5} className="w-full mt-1 px-3 py-2 rounded-lg bg-muted border border-border text-card-foreground text-sm focus:ring-2 focus:ring-primary/30 focus:outline-none"/>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Zona Waktu</label>
            <select defaultValue="WIB" className="w-full mt-1 px-3 py-2 rounded-lg bg-muted border border-border text-card-foreground text-sm focus:ring-2 focus:ring-primary/30 focus:outline-none">
              <option>WIB</option>
              <option>WITA</option>
              <option>WIT</option>
            </select>
          </div>

          <div className="pt-2 border-t border-border space-y-3">
            <h4 className="text-xs font-semibold text-card-foreground">Integrasi Cuaca</h4>
            <div>
              <label className="text-xs text-muted-foreground">URL API Cuaca</label>
              <input
                name="weatherApiBaseUrl"
                value={config.weatherApiBaseUrl}
                onChange={handleConfigChange}
                placeholder="https://api.example.com/weather"
                className="w-full mt-1 px-3 py-2 rounded-lg bg-muted border border-border text-card-foreground text-sm focus:ring-2 focus:ring-primary/30 focus:outline-none"
                disabled={loadingConfig || isBusy}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">API Key Cuaca</label>
              <input
                name="weatherApiKey"
                value={config.weatherApiKey}
                onChange={handleConfigChange}
                placeholder="isi api key cuaca"
                className="w-full mt-1 px-3 py-2 rounded-lg bg-muted border border-border text-card-foreground text-sm focus:ring-2 focus:ring-primary/30 focus:outline-none"
                disabled={loadingConfig || isBusy}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">Latitude</label>
                <input
                  name="weatherLocationLat"
                  value={config.weatherLocationLat}
                  onChange={handleConfigChange}
                placeholder="-7.0410"
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-muted border border-border text-card-foreground text-sm focus:ring-2 focus:ring-primary/30 focus:outline-none"
                  disabled={loadingConfig || isBusy}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Longitude</label>
                <input
                  name="weatherLocationLon"
                  value={config.weatherLocationLon}
                  onChange={handleConfigChange}
                placeholder="113.8665"
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-muted border border-border text-card-foreground text-sm focus:ring-2 focus:ring-primary/30 focus:outline-none"
                  disabled={loadingConfig || isBusy}
                />
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-border space-y-3">
            <h4 className="text-xs font-semibold text-card-foreground">Integrasi Pasang Surut</h4>
            <div>
              <label className="text-xs text-muted-foreground">URL API Pasang Surut</label>
              <input
                name="tideApiBaseUrl"
                value={config.tideApiBaseUrl}
                onChange={handleConfigChange}
                placeholder="https://api.example.com/tides"
                className="w-full mt-1 px-3 py-2 rounded-lg bg-muted border border-border text-card-foreground text-sm focus:ring-2 focus:ring-primary/30 focus:outline-none"
                disabled={loadingConfig || isBusy}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">API Key Pasang Surut</label>
              <input
                name="tideApiKey"
                value={config.tideApiKey}
                onChange={handleConfigChange}
                placeholder="isi api key pasang surut"
                className="w-full mt-1 px-3 py-2 rounded-lg bg-muted border border-border text-card-foreground text-sm focus:ring-2 focus:ring-primary/30 focus:outline-none"
                disabled={loadingConfig || isBusy}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Kode Stasiun Pasut</label>
              <input
                name="tideStationCode"
                value={config.tideStationCode}
                onChange={handleConfigChange}
                placeholder="sumenep"
                className="w-full mt-1 px-3 py-2 rounded-lg bg-muted border border-border text-card-foreground text-sm focus:ring-2 focus:ring-primary/30 focus:outline-none"
                disabled={loadingConfig || isBusy}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <button type="submit" className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-60" disabled={loadingConfig || isBusy}>
              {saving ? 'Menyimpan...' : 'Simpan Pengaturan Integrasi'}
            </button>
            <button type="button" onClick={() => handleFetch('weather')} className="px-4 py-2 text-sm bg-blue-500 text-white rounded-lg hover:opacity-90 disabled:opacity-60" disabled={loadingConfig || isBusy}>
              {fetchingType === 'weather' ? 'Fetch Cuaca...' : 'Fetch Cuaca'}
            </button>
            <button type="button" onClick={() => handleFetch('tide')} className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:opacity-90 disabled:opacity-60" disabled={loadingConfig || isBusy}>
              {fetchingType === 'tide' ? 'Fetch Pasut...' : 'Fetch Pasut'}
            </button>
            <button type="button" onClick={() => handleFetch('all')} className="px-4 py-2 text-sm bg-amber-500 text-white rounded-lg hover:opacity-90 disabled:opacity-60" disabled={loadingConfig || isBusy}>
              {fetchingType === 'all' ? 'Fetch Semua...' : 'Fetch Keduanya'}
            </button>
          </div>
        </form>

        <div className="flood-card space-y-4">
          <h3 className="text-sm font-semibold text-card-foreground">Tentang Sistem</h3>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>Versi: <span className="text-card-foreground">1.0.0</span></p>
            <p>Platform: <span className="text-card-foreground">IoT + Machine Learning</span></p>
            <p>Database: <span className="text-card-foreground">Belum terhubung</span></p>
            <p>Lisensi: <span className="text-card-foreground">Open Source</span></p>
          </div>

          <div className="pt-4 border-t border-border">
            <h4 className="text-xs font-semibold text-card-foreground mb-2">Hasil Fetch Terakhir</h4>
            <pre className="text-xs bg-muted/60 border border-border rounded-lg p-3 overflow-auto max-h-[360px] text-card-foreground">
              {fetchResult ? JSON.stringify(fetchResult, null, 2) : 'Belum ada fetch dijalankan.'}
            </pre>
          </div>
        </div>
      </div>
    </div>);
};
export default SettingsPage;
