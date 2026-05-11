"""
=============================================================
FLOOD PREDICTION - PREDICT.PY
=============================================================
Cara pakai:
  1. Prediksi manual (input langsung)
  2. Prediksi dari CSV
  3. Simulasi kondisi ekstrem

Jalankan: python predict.py
=============================================================
"""

import os
import json
import joblib
import warnings
import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

# ─────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────
MODEL_PATH = "models/flood_model.pkl"
META_PATH  = "models/flood_model_meta.json"

FEATURES = [
    "rainfall_mm", "rainfall_lag1", "rainfall_lag2",
    "rainfall_3day", "rainfall_7day", "rainfall_30day",
    "rain_intensity", "tide_max_m", "tide_mean_m",
    "tide_range_m", "water_level_cm",
    "month", "day_of_year", "is_wet_season"
]

RISK_LABEL = {
    0: "✅ AMAN",
    1: "⚠️  WASPADA",
    2: "🚨 BANJIR"
}

RISK_ACTION = {
    0: "Kondisi normal. Pantau terus perkembangan cuaca.",
    1: "Tingkatkan kewaspadaan. Siapkan dokumen penting dan pantau ketinggian air.",
    2: "BAHAYA! Segera amankan barang penting dan bersiap evakuasi ke titik aman."
}

RISK_COLOR = {0: "probability < 0.3", 1: "probability 0.3-0.7", 2: "probability > 0.7"}

# ─────────────────────────────────────────────
# LOAD MODEL
# ─────────────────────────────────────────────
def load_model():
    if not os.path.exists(MODEL_PATH):
        print(f"❌ Model tidak ditemukan di {MODEL_PATH}")
        print("   Jalankan train_model.py terlebih dahulu!")
        exit(1)

    model = joblib.load(MODEL_PATH)
    with open(META_PATH) as f:
        meta = json.load(f)

    print(f"✅ Model loaded: {meta['model_type']}")
    print(f"   Accuracy : {meta['accuracy']*100:.1f}%")
    print(f"   Trained  : {meta['trained_on']}")
    return model, meta

# ─────────────────────────────────────────────
# FUNGSI PREDIKSI UTAMA
# ─────────────────────────────────────────────
def predict(model, input_data: dict) -> dict:
    """
    input_data: dict dengan key sesuai FEATURES
    return: dict hasil prediksi
    """
    df_input = pd.DataFrame([input_data])[FEATURES]
    pred_class = model.predict(df_input)[0]
    pred_proba = model.predict_proba(df_input)[0]

    return {
        "risk_level"       : int(pred_class),
        "risk_label"       : RISK_LABEL[pred_class],
        "action"           : RISK_ACTION[pred_class],
        "probability"      : {
            "aman"    : round(float(pred_proba[0]), 3),
            "waspada" : round(float(pred_proba[1]), 3),
            "banjir"  : round(float(pred_proba[2]), 3),
        },
        "flood_probability": round(float(pred_proba[1] + pred_proba[2]), 3),
    }

def print_result(result: dict, label: str = ""):
    print("\n" + "─" * 50)
    if label:
        print(f"  Skenario : {label}")
    print(f"  Status   : {result['risk_label']}")
    print(f"  Aksi     : {result['action']}")
    print(f"\n  Probabilitas:")
    print(f"    Aman     : {result['probability']['aman']*100:.1f}%")
    print(f"    Waspada  : {result['probability']['waspada']*100:.1f}%")
    print(f"    Banjir   : {result['probability']['banjir']*100:.1f}%")
    print(f"\n  Flood Probability : {result['flood_probability']*100:.1f}%")
    print("─" * 50)

# ─────────────────────────────────────────────
# HELPER: hitung rain_intensity
# ─────────────────────────────────────────────
def get_rain_intensity(rainfall_mm):
    if rainfall_mm == 0:    return 0
    elif rainfall_mm < 5:   return 1
    elif rainfall_mm < 20:  return 2
    elif rainfall_mm < 50:  return 3
    else:                   return 4

# ─────────────────────────────────────────────
# HELPER: estimasi water level
# ─────────────────────────────────────────────
def estimate_water_level(rainfall_mm, rainfall_lag1, rainfall_lag2,
                          rainfall_7day, tide_max_m):
    wl = (80
          + 0.8  * rainfall_mm
          + 0.5  * rainfall_lag1
          + 0.3  * rainfall_lag2
          + 0.15 * rainfall_7day
          + 30.0 * max(0, tide_max_m))
    return round(wl, 1)

# ─────────────────────────────────────────────
# MODE 1: PREDIKSI MANUAL (INPUT LANGSUNG)
# ─────────────────────────────────────────────
def predict_manual(model):
    print("\n" + "=" * 50)
    print("MODE: INPUT MANUAL")
    print("=" * 50)
    print("Masukkan data kondisi saat ini:\n")

    try:
        rainfall_mm   = float(input("Curah hujan hari ini (mm)     : "))
        rainfall_lag1 = float(input("Curah hujan kemarin (mm)      : "))
        rainfall_lag2 = float(input("Curah hujan 2 hari lalu (mm)  : "))
        rainfall_7day = float(input("Total hujan 7 hari (mm)       : "))
        tide_max_m    = float(input("Pasut tertinggi hari ini (m)  : "))
        month         = int(input("Bulan saat ini (1-12)         : "))
    except ValueError:
        print("❌ Input tidak valid!")
        return

    # Hitung fitur turunan otomatis
    rainfall_3day  = rainfall_mm + rainfall_lag1 + rainfall_lag2
    rainfall_30day = rainfall_7day * 4.3  # estimasi
    rain_intensity = get_rain_intensity(rainfall_mm)
    tide_mean_m    = tide_max_m * 0.6
    tide_range_m   = tide_max_m + 0.1
    water_level_cm = estimate_water_level(
        rainfall_mm, rainfall_lag1, rainfall_lag2, rainfall_7day, tide_max_m
    )
    day_of_year    = (month - 1) * 30 + 15  # estimasi tengah bulan
    is_wet_season  = 1 if month in [10,11,12,1,2,3,4] else 0

    input_data = {
        "rainfall_mm"    : rainfall_mm,
        "rainfall_lag1"  : rainfall_lag1,
        "rainfall_lag2"  : rainfall_lag2,
        "rainfall_3day"  : rainfall_3day,
        "rainfall_7day"  : rainfall_7day,
        "rainfall_30day" : rainfall_30day,
        "rain_intensity" : rain_intensity,
        "tide_max_m"     : tide_max_m,
        "tide_mean_m"    : tide_mean_m,
        "tide_range_m"   : tide_range_m,
        "water_level_cm" : water_level_cm,
        "month"          : month,
        "day_of_year"    : day_of_year,
        "is_wet_season"  : is_wet_season,
    }

    print(f"\n   [Estimasi tinggi air sungai: {water_level_cm} cm]")

    result = predict(model, input_data)
    print_result(result, "Input Manual")

# ─────────────────────────────────────────────
# MODE 2: PREDIKSI DARI CSV
# ─────────────────────────────────────────────
def predict_from_csv(model, csv_path="flood_training_dataset.csv"):
    print("\n" + "=" * 50)
    print(f"MODE: PREDIKSI DARI CSV ({csv_path})")
    print("=" * 50)

    if not os.path.exists(csv_path):
        print(f"❌ File tidak ditemukan: {csv_path}")
        return

    df = pd.read_csv(csv_path)
    X  = df[FEATURES]
    pred_class = model.predict(X)
    pred_proba = model.predict_proba(X)

    df["predicted_risk"]     = pred_class
    df["predicted_label"]    = [RISK_LABEL[p] for p in pred_class]
    df["prob_aman"]          = pred_proba[:, 0].round(3)
    df["prob_waspada"]       = pred_proba[:, 1].round(3)
    df["prob_banjir"]        = pred_proba[:, 2].round(3)
    df["flood_probability"]  = (pred_proba[:, 1] + pred_proba[:, 2]).round(3)

    # Tampilkan hari-hari berisiko
    risky = df[df["predicted_risk"] >= 1][
        ["tanggal", "rainfall_mm", "water_level_cm",
         "tide_max_m", "predicted_label", "flood_probability"]
    ]

    print(f"\n   Total data  : {len(df)} baris")
    print(f"   Aman        : {(pred_class==0).sum()} hari")
    print(f"   Waspada     : {(pred_class==1).sum()} hari")
    print(f"   Banjir      : {(pred_class==2).sum()} hari")

    if len(risky) > 0:
        print(f"\n   Hari-hari berisiko:")
        print(risky.to_string(index=False))

    # Simpan hasil
    out_path = "flood_predictions_result.csv"
    df.to_csv(out_path, index=False)
    print(f"\n   ✅ Hasil disimpan: {out_path}")

# ─────────────────────────────────────────────
# MODE 3: SIMULASI SKENARIO
# ─────────────────────────────────────────────
def predict_scenarios(model):
    print("\n" + "=" * 50)
    print("MODE: SIMULASI SKENARIO")
    print("=" * 50)

    scenarios = [
        {
            "label"        : "Hari Normal (Kering)",
            "rainfall_mm"  : 0,
            "rainfall_lag1": 0,
            "rainfall_lag2": 0,
            "rainfall_7day": 5,
            "tide_max_m"   : 0.4,
            "month"        : 8,
        },
        {
            "label"        : "Hujan Sedang + Pasut Normal",
            "rainfall_mm"  : 25,
            "rainfall_lag1": 15,
            "rainfall_lag2": 10,
            "rainfall_7day": 60,
            "tide_max_m"   : 0.7,
            "month"        : 12,
        },
        {
            "label"        : "Hujan Lebat + Pasut Tinggi",
            "rainfall_mm"  : 60,
            "rainfall_lag1": 45,
            "rainfall_lag2": 30,
            "rainfall_7day": 150,
            "tide_max_m"   : 1.2,
            "month"        : 1,
        },
        {
            "label"        : "Hujan Ekstrem + Pasut Maksimum ⚠️",
            "rainfall_mm"  : 90,
            "rainfall_lag1": 70,
            "rainfall_lag2": 55,
            "rainfall_7day": 250,
            "tide_max_m"   : 1.4,
            "month"        : 2,
        },
    ]

    for s in scenarios:
        label         = s.pop("label")
        r             = s["rainfall_mm"]
        rl1           = s["rainfall_lag1"]
        rl2           = s["rainfall_lag2"]
        r7            = s["rainfall_7day"]
        tm            = s["tide_max_m"]
        month         = s["month"]

        rainfall_3day  = r + rl1 + rl2
        rainfall_30day = r7 * 4.3
        rain_intensity = get_rain_intensity(r)
        tide_mean_m    = tm * 0.6
        tide_range_m   = tm + 0.1
        water_level_cm = estimate_water_level(r, rl1, rl2, r7, tm)
        day_of_year    = (month - 1) * 30 + 15
        is_wet_season  = 1 if month in [10,11,12,1,2,3,4] else 0

        input_data = {
            "rainfall_mm"    : r,
            "rainfall_lag1"  : rl1,
            "rainfall_lag2"  : rl2,
            "rainfall_3day"  : rainfall_3day,
            "rainfall_7day"  : r7,
            "rainfall_30day" : rainfall_30day,
            "rain_intensity" : rain_intensity,
            "tide_max_m"     : tm,
            "tide_mean_m"    : tide_mean_m,
            "tide_range_m"   : tide_range_m,
            "water_level_cm" : water_level_cm,
            "month"          : month,
            "day_of_year"    : day_of_year,
            "is_wet_season"  : is_wet_season,
        }

        result = predict(model, input_data)
        print_result(result, f"{label} | air: {water_level_cm}cm | hujan: {r}mm | pasut: {tm}m")

# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────
if __name__ == "__main__":
    print("=" * 50)
    print("  FLOOD PREDICTION SYSTEM")
    print("  Sistem Peringatan Dini Banjir")
    print("=" * 50)

    model, meta = load_model()

    print("\nPilih mode:")
    print("  1. Input manual (masukkan data sekarang)")
    print("  2. Prediksi dari CSV dataset")
    print("  3. Simulasi semua skenario")
    print("  4. Jalankan semua sekaligus")

    try:
        mode = input("\nPilih (1/2/3/4) [default=3]: ").strip() or "3"
    except:
        mode = "3"

    if mode == "1":
        predict_manual(model)
    elif mode == "2":
        predict_from_csv(model)
    elif mode == "3":
        predict_scenarios(model)
    elif mode == "4":
        predict_scenarios(model)
        predict_from_csv(model)
        predict_manual(model)
    else:
        print("❌ Pilihan tidak valid, menjalankan simulasi skenario...")
        predict_scenarios(model)
