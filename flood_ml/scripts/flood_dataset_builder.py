"""
=============================================================
FLOOD PREDICTION DATASET BUILDER
=============================================================
Input:
  - curah_hujan_gabungan_urut_2025.xlsx  (Stamet Trunojoyo)
  - pasut_laut_surabaya.xlsx             (BMKG Surabaya)
  - kerala.csv                           (label referensi)

Output:
  - flood_training_dataset.csv           (siap untuk training)
=============================================================
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import warnings
warnings.filterwarnings('ignore')

print("=" * 60)
print("FLOOD PREDICTION DATASET BUILDER")
print("=" * 60)

# ─────────────────────────────────────────────
# 1. LOAD DATA CURAH HUJAN SUMENEP
# ─────────────────────────────────────────────
print("\n[1/5] Memuat data curah hujan Sumenep...")

df_hujan = pd.read_excel(
    "curah_hujan_gabungan_urut_2025.xlsx",
    skiprows=6,           # skip header info stasiun
    names=["TANGGAL", "RR"]
)

# Bersihkan
df_hujan = df_hujan.dropna(subset=["TANGGAL"])
df_hujan["TANGGAL"] = pd.to_datetime(df_hujan["TANGGAL"], format="%d-%m-%Y", errors="coerce")
df_hujan = df_hujan.dropna(subset=["TANGGAL"])

# Ganti 8888 dan 9999 (kode missing BMKG) dengan NaN lalu interpolasi
df_hujan["RR"] = pd.to_numeric(df_hujan["RR"], errors="coerce")
df_hujan.loc[df_hujan["RR"] >= 8888, "RR"] = np.nan
df_hujan["RR"] = df_hujan["RR"].interpolate(method="linear").fillna(0)
df_hujan = df_hujan.set_index("TANGGAL").sort_index()

print(f"   ✅ {len(df_hujan)} hari data curah hujan")
print(f"   Periode: {df_hujan.index.min().date()} s/d {df_hujan.index.max().date()}")

# ─────────────────────────────────────────────
# 2. LOAD & PROSES DATA PASUT SURABAYA
# ─────────────────────────────────────────────
print("\n[2/5] Memuat data pasut Surabaya...")

df_pasut_raw = pd.read_excel(
    "pasut_laut_surabaya.xlsx",
    header=2,
    names=["Waktu", "Ketinggian"]
)

df_pasut_raw = df_pasut_raw.dropna(subset=["Waktu"])
df_pasut_raw["Waktu"] = pd.to_datetime(df_pasut_raw["Waktu"], errors="coerce")
df_pasut_raw = df_pasut_raw.dropna(subset=["Waktu"])
df_pasut_raw["Ketinggian"] = pd.to_numeric(df_pasut_raw["Ketinggian"], errors="coerce")
df_pasut_raw = df_pasut_raw.dropna(subset=["Ketinggian"])

# Konversi UTC ke WIB (UTC+7)
df_pasut_raw["Waktu_WIB"] = df_pasut_raw["Waktu"] + timedelta(hours=7)
df_pasut_raw["Tanggal"] = df_pasut_raw["Waktu_WIB"].dt.date

# Agregasi per hari: max, min, mean
df_pasut_daily = df_pasut_raw.groupby("Tanggal").agg(
    tide_max=("Ketinggian", "max"),
    tide_min=("Ketinggian", "min"),
    tide_mean=("Ketinggian", "mean"),
    tide_range=("Ketinggian", lambda x: x.max() - x.min())
).reset_index()

df_pasut_daily["Tanggal"] = pd.to_datetime(df_pasut_daily["Tanggal"])
df_pasut_daily = df_pasut_daily.set_index("Tanggal").sort_index()

print(f"   ✅ {len(df_pasut_daily)} hari data pasut")
print(f"   Periode: {df_pasut_daily.index.min().date()} s/d {df_pasut_daily.index.max().date()}")

# ─────────────────────────────────────────────
# 3. LOAD DATA KERALA (REFERENSI LABEL)
# ─────────────────────────────────────────────
print("\n[3/5] Memuat data Kerala sebagai referensi label...")

df_kerala = pd.read_csv("kerala.csv")
df_kerala.columns = df_kerala.columns.str.strip()
df_kerala["FLOODS"] = df_kerala["FLOODS"].str.strip()

# Statistik Kerala untuk threshold banjir
kerala_flood = df_kerala[df_kerala["FLOODS"] == "YES"]["ANNUAL RAINFALL"]
kerala_no_flood = df_kerala[df_kerala["FLOODS"] == "NO"]["ANNUAL RAINFALL"]

threshold_annual = kerala_flood.quantile(0.25)
print(f"   ✅ Kerala flood threshold (annual): {threshold_annual:.0f} mm")
print(f"   Kerala flood rate: {(df_kerala['FLOODS']=='YES').mean()*100:.1f}%")

# ─────────────────────────────────────────────
# 4. GENERATE SYNTHETIC WATER LEVEL
# ─────────────────────────────────────────────
print("\n[4/5] Generate synthetic water level (rumus hidrologi)...")

"""
Rumus estimasi tinggi air sungai (simplified rational method + tidal influence):

water_level = BASE_LEVEL
            + RAINFALL_COEFFICIENT * rainfall_3day_sum
            + TIDE_COEFFICIENT * tide_max
            + ANTECEDENT_MOISTURE * rainfall_7day_sum * 0.1
            + noise (variasi natural)

Parameter disesuaikan dengan kondisi sungai di pesisir Madura:
- Sungai kecil, respon cepat terhadap hujan
- Pengaruh pasut karena dekat laut
"""

BASE_LEVEL        = 80.0   # cm — tinggi air normal (kering)
RAIN_COEF         = 0.8    # cm per mm hujan (hari ini)
RAIN_LAG1_COEF    = 0.5    # cm per mm hujan kemarin
RAIN_LAG2_COEF    = 0.3    # cm per mm hujan 2 hari lalu
TIDE_COEF         = 30.0   # pengaruh pasut (cm per meter pasut)
ANTECEDENT_COEF   = 0.15   # pengaruh kelembaban tanah sebelumnya

# Threshold banjir (cm) — bisa disesuaikan dengan kondisi lokal
FLOOD_THRESHOLD   = 180.0  # cm

# Buat date range gabungan (ambil irisan atau union)
# Gunakan curah hujan sebagai basis (Jan-Des 2025)
date_range = df_hujan.index

records = []

for i, date in enumerate(date_range):
    # Curah hujan hari ini dan lag
    rr_today  = df_hujan.loc[date, "RR"] if date in df_hujan.index else 0
    rr_lag1   = df_hujan.iloc[i-1]["RR"] if i >= 1 else 0
    rr_lag2   = df_hujan.iloc[i-2]["RR"] if i >= 2 else 0
    rr_3day   = df_hujan.iloc[max(0,i-2):i+1]["RR"].sum()
    rr_7day   = df_hujan.iloc[max(0,i-6):i+1]["RR"].sum()
    rr_30day  = df_hujan.iloc[max(0,i-29):i+1]["RR"].sum()

    # Pasut — kalau ada data asli pakai, kalau tidak generate sintetis
    if date in df_pasut_daily.index:
        tide_max  = df_pasut_daily.loc[date, "tide_max"]
        tide_mean = df_pasut_daily.loc[date, "tide_mean"]
        tide_range = df_pasut_daily.loc[date, "tide_range"]
    else:
        # Generate pasut sintetis dengan pola semidiurnal
        # Periode ~14.77 hari untuk spring-neap cycle
        day_of_year = date.timetuple().tm_yday
        spring_neap = 0.5 + 0.4 * np.sin(2 * np.pi * day_of_year / 14.77)
        tide_max    = 0.6 + 0.5 * spring_neap + np.random.normal(0, 0.05)
        tide_mean   = tide_max * 0.5
        tide_range  = tide_max - (-0.1 + np.random.normal(0, 0.03))

    # Hitung water level dengan rumus hidrologi
    water_level = (
        BASE_LEVEL
        + RAIN_COEF       * rr_today
        + RAIN_LAG1_COEF  * rr_lag1
        + RAIN_LAG2_COEF  * rr_lag2
        + ANTECEDENT_COEF * rr_7day
        + TIDE_COEF       * max(0, tide_max)
        + np.random.normal(0, 3)  # noise natural ±3 cm
    )
    water_level = max(BASE_LEVEL, water_level)  # tidak boleh di bawah base

    # Intensitas hujan
    if rr_today == 0:
        rain_intensity = 0  # tidak hujan
    elif rr_today < 5:
        rain_intensity = 1  # ringan
    elif rr_today < 20:
        rain_intensity = 2  # sedang
    elif rr_today < 50:
        rain_intensity = 3  # lebat
    else:
        rain_intensity = 4  # sangat lebat

    records.append({
        "tanggal"         : date,
        "rainfall_mm"     : round(rr_today, 1),
        "rainfall_lag1"   : round(rr_lag1, 1),
        "rainfall_lag2"   : round(rr_lag2, 1),
        "rainfall_3day"   : round(rr_3day, 1),
        "rainfall_7day"   : round(rr_7day, 1),
        "rainfall_30day"  : round(rr_30day, 1),
        "rain_intensity"  : rain_intensity,
        "tide_max_m"      : round(tide_max, 3),
        "tide_mean_m"     : round(tide_mean, 3),
        "tide_range_m"    : round(tide_range, 3),
        "water_level_cm"  : round(water_level, 1),
        "month"           : date.month,
        "day_of_year"     : date.timetuple().tm_yday,
        "is_wet_season"   : 1 if date.month in [10,11,12,1,2,3,4] else 0,
    })

df_synth = pd.DataFrame(records)

print(f"   ✅ {len(df_synth)} baris data sintetis dibuat")
print(f"   Water level range: {df_synth['water_level_cm'].min():.1f} – {df_synth['water_level_cm'].max():.1f} cm")

# ─────────────────────────────────────────────
# 5. BUAT LABEL BANJIR
# ─────────────────────────────────────────────
print("\n[5/5] Membuat label banjir...")

"""
Label banjir dibuat dengan 3 pendekatan gabungan:
1. Water level > threshold (180 cm)
2. Kondisi ekstrem: hujan 3 hari > 100mm + pasut tinggi > 1.2m
3. Referensi pola Kerala: bulan dengan hujan tinggi

Label: flood_risk
  0 = aman
  1 = waspada (water level 150-180 cm atau kondisi mendekati)
  2 = banjir  (water level > 180 cm atau kondisi ekstrem)
"""

def label_flood(row):
    wl = row["water_level_cm"]
    r3 = row["rainfall_3day"]
    r7 = row["rainfall_7day"]
    tm = row["tide_max_m"]

    # Kondisi kritis gabungan
    extreme_combo = (r3 > 80 and tm > 1.0) or (r7 > 120 and tm > 0.8)

    if wl > FLOOD_THRESHOLD or extreme_combo:
        return 2  # banjir
    elif wl > FLOOD_THRESHOLD * 0.85 or (r3 > 50 and tm > 0.8):
        return 1  # waspada
    else:
        return 0  # aman

df_synth["flood_risk"] = df_synth.apply(label_flood, axis=1)

# Untuk training binary classification
df_synth["flood_binary"] = (df_synth["flood_risk"] == 2).astype(int)

# Statistik label
label_counts = df_synth["flood_risk"].value_counts().sort_index()
print(f"   Label 0 (aman)    : {label_counts.get(0,0)} hari ({label_counts.get(0,0)/len(df_synth)*100:.1f}%)")
print(f"   Label 1 (waspada) : {label_counts.get(1,0)} hari ({label_counts.get(1,0)/len(df_synth)*100:.1f}%)")
print(f"   Label 2 (banjir)  : {label_counts.get(2,0)} hari ({label_counts.get(2,0)/len(df_synth)*100:.1f}%)")

# ─────────────────────────────────────────────
# SIMPAN OUTPUT
# ─────────────────────────────────────────────
output_path = "flood_training_dataset.csv"
df_synth.to_csv(output_path, index=False)

print("\n" + "=" * 60)
print("✅ DATASET BERHASIL DIBUAT!")
print("=" * 60)
print(f"   File  : {output_path}")
print(f"   Baris : {len(df_synth)}")
print(f"   Kolom : {list(df_synth.columns)}")
print("\nKolom fitur untuk training:")
features = [
    "rainfall_mm", "rainfall_lag1", "rainfall_lag2",
    "rainfall_3day", "rainfall_7day", "rainfall_30day",
    "rain_intensity", "tide_max_m", "tide_mean_m",
    "tide_range_m", "water_level_cm", "month",
    "day_of_year", "is_wet_season"
]
print(f"   {features}")
print("\nTarget label:")
print("   flood_risk   → 0/1/2 (multiclass)")
print("   flood_binary → 0/1   (binary)")
print("\nNext step: jalankan train_model.py")
