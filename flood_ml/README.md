# 🌊 Flood ML — Sistem Prediksi Banjir

Modul Machine Learning untuk prediksi banjir H-1 berbasis data curah hujan, pasang surut, dan tinggi air sungai.

---

## 📁 Struktur Folder

```
flood_ml/
│
├── data/
│   └── flood_training_dataset.csv   ← Dataset training (365 hari)
│
├── models/
│   ├── flood_model.pkl              ← Model XGBoost terlatih (siap pakai)
│   ├── flood_model_meta.json        ← Info model (accuracy, features, dll)
│   ├── flood_model_report.txt       ← Laporan akurasi lengkap
│   └── flood_model_chart.png        ← Confusion matrix + feature importance
│
├── scripts/
│   ├── flood_dataset_builder.py     ← [1] Buat dataset dari data mentah
│   ├── train_model.py               ← [2] Training model ML
│   ├── predict.py                   ← [3] Test prediksi manual/CSV
│   ├── predict_api.py               ← [4] API bridge Python ↔ Express
│   ├── floodPrediction.js           ← [5] Service Node.js
│   └── predictions_route.js         ← [6] Route Express.js
│
└── requirements.txt                 ← Python dependencies
```

---

## 🧩 Penjelasan Tiap File

### `flood_dataset_builder.py`
**Fungsi:** Membuat dataset training dari data mentah.

Input yang dibutuhkan (taruh di folder sama):
- `curah_hujan_gabungan_urut_2025.xlsx` — data BMKG Sumenep
- `pasut_laut_surabaya.xlsx` — data BMKG pasut
- `kerala.csv` — referensi label banjir

Output:
- `data/flood_training_dataset.csv`

Jalankan:
```bash
python scripts/flood_dataset_builder.py
```

---

### `train_model.py`
**Fungsi:** Melatih model Machine Learning (Random Forest + XGBoost), memilih yang terbaik, dan menyimpannya.

Input: `data/flood_training_dataset.csv`

Output:
- `models/flood_model.pkl` — model terlatih
- `models/flood_model_meta.json` — metadata
- `models/flood_model_report.txt` — laporan akurasi
- `models/flood_model_chart.png` — visualisasi

Jalankan:
```bash
python scripts/train_model.py
```

Hasil training terakhir:
- Model: **XGBoost**
- Accuracy: **98.6%**
- F1 Score: **0.9863**

---

### `predict.py`
**Fungsi:** Test prediksi secara manual, dari CSV, atau simulasi skenario. Dipakai untuk development dan debugging.

Jalankan:
```bash
python scripts/predict.py
# Pilih mode:
# 1 = input manual
# 2 = prediksi dari CSV
# 3 = simulasi 4 skenario
# 4 = semua sekaligus
```

---

### `predict_api.py`
**Fungsi:** Bridge antara Express.js dan model Python. Menerima input JSON dari stdin, output JSON ke stdout. Dipanggil otomatis oleh `floodPrediction.js`.

Input JSON (via stdin):
```json
{
  "rainfall_mm"   : 45.0,
  "rainfall_lag1" : 20.0,
  "rainfall_lag2" : 10.0,
  "rainfall_7day" : 100.0,
  "tide_max_m"    : 1.1,
  "month"         : 12,
  "water_level_cm": 175.0
}
```

Output JSON (ke stdout):
```json
{
  "success"          : true,
  "risk_level"       : 2,
  "risk_label"       : "banjir",
  "flood_probability": 0.95,
  "probability"      : { "aman": 0.02, "waspada": 0.03, "banjir": 0.95 },
  "action"           : "BAHAYA! Segera amankan barang penting...",
  "water_level_cm"   : 218.5
}
```

---

### `floodPrediction.js`
**Fungsi:** Service Node.js yang memanggil `predict_api.py` dan mengembalikan hasil prediksi sebagai Promise.

Taruh di: `backend/services/floodPrediction.js`

```javascript
const { runPrediction } = require('./services/floodPrediction')

const result = await runPrediction({
  rainfall_mm: 45,
  rainfall_lag1: 20,
  rainfall_7day: 100,
  tide_max_m: 1.1,
  month: 12
})
console.log(result.risk_label) // "banjir"
```

---

### `predictions_route.js`
**Fungsi:** Route Express.js dengan 4 endpoint prediksi.

Taruh di: `backend/routes/predictions.js`

Daftarkan di `app.js`:
```javascript
const predictionsRouter = require('./routes/predictions')
app.use('/api/predictions', predictionsRouter)
```

---

## 🔌 Cara Integrasi ke Web App

### Langkah 1 — Taruh folder ml di backend

```
backend/
  ml/                          ← folder ini
    data/
    models/
    scripts/
    requirements.txt
  routes/
  services/
  app.js
```

### Langkah 2 — Install Python dependencies

```bash
cd backend/ml
pip install -r requirements.txt
```

### Langkah 3 — Copy service dan route

```bash
cp scripts/floodPrediction.js  ../services/floodPrediction.js
cp scripts/predictions_route.js ../routes/predictions.js
```

### Langkah 4 — Daftarkan route di app.js

```javascript
const predictionsRouter = require('./routes/predictions')
app.use('/api/predictions', predictionsRouter)
```

### Langkah 5 — Setup cron job (prediksi otomatis tiap 1 jam)

Install node-cron:
```bash
npm install node-cron axios
```

Tambahkan di `app.js`:
```javascript
const cron = require('node-cron')
const axios = require('axios')

// Jalankan prediksi otomatis setiap 1 jam
cron.schedule('0 * * * *', async () => {
  try {
    await axios.post('http://localhost:3000/api/predictions/run-auto')
    console.log('[CRON] Prediksi banjir berhasil dijalankan')
  } catch (err) {
    console.error('[CRON] Gagal:', err.message)
  }
})
```

---

## 🌐 API Endpoints

| Method | Endpoint | Fungsi |
|--------|----------|--------|
| POST | `/api/predictions/run` | Prediksi manual dari body JSON |
| POST | `/api/predictions/run-auto` | Prediksi otomatis dari data DB |
| GET | `/api/predictions/latest` | Hasil prediksi terbaru |
| GET | `/api/predictions/history?limit=30` | Riwayat prediksi |

---

## 📊 Contoh Response API

```json
POST /api/predictions/run
Body: { "rainfall_mm": 60, "rainfall_lag1": 45, "tide_max_m": 1.2, "month": 1 }

Response:
{
  "success": true,
  "risk_level": 2,
  "risk_label": "banjir",
  "flood_probability": 0.995,
  "probability": {
    "aman": 0.002,
    "waspada": 0.003,
    "banjir": 0.995
  },
  "action": "BAHAYA! Segera amankan barang penting dan bersiap evakuasi.",
  "water_level_cm": 218.0,
  "alert_created": true
}
```

---

## ⚠️ Catatan Penting

1. **Data `water_level_cm` masih synthetic** — akurasi akan meningkat drastis setelah diganti data sensor asli dari tabel `sensor_data`.

2. **Retrain model** setelah data baru terkumpul:
   ```bash
   python scripts/flood_dataset_builder.py  # rebuild dataset
   python scripts/train_model.py            # retrain model
   # Model baru otomatis tersimpan di models/flood_model.pkl
   ```

3. **Tidak perlu restart server** setelah retrain — `predict_api.py` load model setiap dipanggil.

---

## 🔄 Alur Sistem Lengkap

```
Sensor IoT → sensor_data (MySQL)
BMKG       → weather_data (MySQL)
Pasut BMKG → tidal_data (MySQL)
                  ↓
      [Cron job tiap 1 jam]
      POST /api/predictions/run-auto
                  ↓
      floodPrediction.js (Node.js)
                  ↓
      predict_api.py (Python)
                  ↓
      flood_model.pkl (XGBoost)
                  ↓
      flood_predictions (MySQL)
                  ↓
      alerts (MySQL) ← jika risiko tinggi
                  ↓
      Frontend web (dashboard + notifikasi)
```
