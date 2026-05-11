"""
=============================================================
FLOOD PREDICTION API - predict_api.py
=============================================================
Script ini dipanggil oleh backend Express.js via child_process.
Menerima input JSON dari stdin, output JSON ke stdout.

Cara panggil dari Node.js:
  const { execFile } = require('child_process')
  execFile('python', ['predict_api.py'], {
    input: JSON.stringify(inputData)
  }, callback)

Input JSON:
  {
    "rainfall_mm"   : 45.0,
    "rainfall_lag1" : 20.0,
    "rainfall_lag2" : 10.0,
    "rainfall_7day" : 100.0,
    "tide_max_m"    : 1.1,
    "month"         : 12,

    // Opsional — kalau ada data sensor asli:
    "water_level_cm": 175.0
  }

Output JSON:
  {
    "success"          : true,
    "risk_level"       : 2,
    "risk_label"       : "banjir",
    "flood_probability": 0.95,
    "probability": {
      "aman"    : 0.02,
      "waspada" : 0.03,
      "banjir"  : 0.95
    },
    "action"           : "BAHAYA! Segera amankan...",
    "water_level_cm"   : 218.5
  }
=============================================================
"""

import sys
import os
import json
import warnings
import joblib
import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

# Path model relatif dari lokasi script ini
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH  = os.path.join(SCRIPT_DIR, "..", "models", "flood_model.pkl")
META_PATH   = os.path.join(SCRIPT_DIR, "..", "models", "flood_model_meta.json")

FEATURES = [
    "rainfall_mm", "rainfall_lag1", "rainfall_lag2",
    "rainfall_3day", "rainfall_7day", "rainfall_30day",
    "rain_intensity", "tide_max_m", "tide_mean_m",
    "tide_range_m", "water_level_cm",
    "month", "day_of_year", "is_wet_season"
]

RISK_ACTION = {
    0: "Kondisi normal. Pantau terus perkembangan cuaca.",
    1: "Tingkatkan kewaspadaan. Siapkan dokumen penting dan pantau ketinggian air.",
    2: "BAHAYA! Segera amankan barang penting dan bersiap evakuasi ke titik aman."
}

RISK_LABEL = {0: "aman", 1: "waspada", 2: "banjir"}

def get_rain_intensity(mm):
    if mm == 0:      return 0
    elif mm < 5:     return 1
    elif mm < 20:    return 2
    elif mm < 50:    return 3
    else:            return 4

def estimate_water_level(r, r1, r2, r7, tm):
    return round(80 + 0.8*r + 0.5*r1 + 0.3*r2 + 0.15*r7 + 30*max(0, tm), 1)

def main():
    # Baca input dari stdin
    try:
        raw = sys.stdin.read().strip()
        data = json.loads(raw)
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Input JSON tidak valid: {str(e)}"}))
        sys.exit(1)

    # Load model
    try:
        model = joblib.load(MODEL_PATH)
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Model tidak ditemukan: {str(e)}"}))
        sys.exit(1)

    # Ambil input
    try:
        r   = float(data.get("rainfall_mm", 0))
        r1  = float(data.get("rainfall_lag1", 0))
        r2  = float(data.get("rainfall_lag2", 0))
        r7  = float(data.get("rainfall_7day", 0))
        tm  = float(data.get("tide_max_m", 0.5))
        mon = int(data.get("month", 1))
        wl  = float(data.get("water_level_cm", -1))
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Field tidak valid: {str(e)}"}))
        sys.exit(1)

    # Hitung fitur turunan
    r3             = r + r1 + r2
    r30            = r7 * 4.3
    rain_intensity = get_rain_intensity(r)
    tide_mean      = tm * 0.6
    tide_range     = tm + 0.1
    water_level    = wl if wl > 0 else estimate_water_level(r, r1, r2, r7, tm)
    doy            = (mon - 1) * 30 + 15
    wet_season     = 1 if mon in [10,11,12,1,2,3,4] else 0

    input_data = {
        "rainfall_mm"    : r,
        "rainfall_lag1"  : r1,
        "rainfall_lag2"  : r2,
        "rainfall_3day"  : r3,
        "rainfall_7day"  : r7,
        "rainfall_30day" : r30,
        "rain_intensity" : rain_intensity,
        "tide_max_m"     : tm,
        "tide_mean_m"    : tide_mean,
        "tide_range_m"   : tide_range,
        "water_level_cm" : water_level,
        "month"          : mon,
        "day_of_year"    : doy,
        "is_wet_season"  : wet_season,
    }

    df_input   = pd.DataFrame([input_data])[FEATURES]
    pred_class = int(model.predict(df_input)[0])
    pred_proba = model.predict_proba(df_input)[0]

    result = {
        "success"          : True,
        "risk_level"       : pred_class,
        "risk_label"       : RISK_LABEL[pred_class],
        "flood_probability": round(float(pred_proba[1] + pred_proba[2]), 4),
        "probability": {
            "aman"    : round(float(pred_proba[0]), 4),
            "waspada" : round(float(pred_proba[1]), 4),
            "banjir"  : round(float(pred_proba[2]), 4),
        },
        "action"          : RISK_ACTION[pred_class],
        "water_level_cm"  : water_level,
        "input_received"  : input_data,
    }

    print(json.dumps(result))

if __name__ == "__main__":
    main()
