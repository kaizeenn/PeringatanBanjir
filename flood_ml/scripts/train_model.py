"""
=============================================================
FLOOD PREDICTION MODEL TRAINER
=============================================================
Input  : flood_training_dataset.csv
Output : models/flood_model.pkl       (model terbaik)
         models/flood_model_info.txt  (laporan akurasi)
=============================================================
"""

import os
import json
import joblib
import warnings
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns

from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    classification_report, confusion_matrix,
    accuracy_score, f1_score, roc_auc_score
)
from sklearn.preprocessing import label_binarize
from xgboost import XGBClassifier

warnings.filterwarnings("ignore")

# ─────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────
DATASET_PATH = "flood_training_dataset.csv"
MODEL_DIR    = "models"
TARGET       = "flood_risk"          # 0=aman, 1=waspada, 2=banjir
FEATURES     = [
    "rainfall_mm", "rainfall_lag1", "rainfall_lag2",
    "rainfall_3day", "rainfall_7day", "rainfall_30day",
    "rain_intensity", "tide_max_m", "tide_mean_m",
    "tide_range_m", "water_level_cm",
    "month", "day_of_year", "is_wet_season"
]

os.makedirs(MODEL_DIR, exist_ok=True)

print("=" * 60)
print("FLOOD PREDICTION MODEL TRAINER")
print("=" * 60)

# ─────────────────────────────────────────────
# 1. LOAD DATASET
# ─────────────────────────────────────────────
print("\n[1/6] Memuat dataset...")
df = pd.read_csv(DATASET_PATH)
print(f"   Baris  : {len(df)}")
print(f"   Kolom  : {list(df.columns)}")
print(f"\n   Distribusi label:")
for label, count in df[TARGET].value_counts().sort_index().items():
    nama = {0: "aman", 1: "waspada", 2: "banjir"}[label]
    print(f"   {label} ({nama:8s}) : {count:4d} ({count/len(df)*100:.1f}%)")

X = df[FEATURES]
y = df[TARGET]

# ─────────────────────────────────────────────
# 2. SPLIT DATA
# ─────────────────────────────────────────────
print("\n[2/6] Split data training & testing...")
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42, stratify=y
)
print(f"   Training : {len(X_train)} baris")
print(f"   Testing  : {len(X_test)} baris")

# ─────────────────────────────────────────────
# 3. TRAINING RANDOM FOREST
# ─────────────────────────────────────────────
print("\n[3/6] Training Random Forest...")
rf_model = RandomForestClassifier(
    n_estimators=200,
    max_depth=10,
    min_samples_split=5,
    min_samples_leaf=2,
    class_weight="balanced",   # handle imbalanced data
    random_state=42,
    n_jobs=-1
)
rf_model.fit(X_train, y_train)
rf_pred  = rf_model.predict(X_test)
rf_acc   = accuracy_score(y_test, rf_pred)
rf_f1    = f1_score(y_test, rf_pred, average="weighted")
rf_cv    = cross_val_score(rf_model, X, y, cv=5, scoring="f1_weighted").mean()
print(f"   Accuracy       : {rf_acc:.4f}")
print(f"   F1 (weighted)  : {rf_f1:.4f}")
print(f"   CV F1 (5-fold) : {rf_cv:.4f}")

# ─────────────────────────────────────────────
# 4. TRAINING XGBOOST
# ─────────────────────────────────────────────
print("\n[4/6] Training XGBoost...")

# Hitung class weights manual untuk XGBoost
class_counts = y_train.value_counts().sort_index()
total = len(y_train)
scale_weights = {cls: total / (len(class_counts) * cnt)
                 for cls, cnt in class_counts.items()}
sample_weights = y_train.map(scale_weights)

xgb_model = XGBClassifier(
    n_estimators=300,
    max_depth=6,
    learning_rate=0.05,
    subsample=0.8,
    colsample_bytree=0.8,
    use_label_encoder=False,
    eval_metric="mlogloss",
    random_state=42,
    n_jobs=-1,
    verbosity=0
)
xgb_model.fit(
    X_train, y_train,
    sample_weight=sample_weights,
    eval_set=[(X_test, y_test)],
    verbose=False
)
xgb_pred = xgb_model.predict(X_test)
xgb_acc  = accuracy_score(y_test, xgb_pred)
xgb_f1   = f1_score(y_test, xgb_pred, average="weighted")
xgb_cv   = cross_val_score(xgb_model, X, y, cv=5, scoring="f1_weighted").mean()
print(f"   Accuracy       : {xgb_acc:.4f}")
print(f"   F1 (weighted)  : {xgb_f1:.4f}")
print(f"   CV F1 (5-fold) : {xgb_cv:.4f}")

# ─────────────────────────────────────────────
# 5. PILIH MODEL TERBAIK
# ─────────────────────────────────────────────
print("\n[5/6] Memilih model terbaik...")

results = {
    "Random Forest": {"model": rf_model, "pred": rf_pred, "acc": rf_acc, "f1": rf_f1, "cv": rf_cv},
    "XGBoost"      : {"model": xgb_model, "pred": xgb_pred, "acc": xgb_acc, "f1": xgb_f1, "cv": xgb_cv},
}

best_name  = max(results, key=lambda k: results[k]["cv"])
best       = results[best_name]
best_model = best["model"]
best_pred  = best["pred"]

print(f"\n   🏆 Model terbaik: {best_name}")
print(f"      Accuracy : {best['acc']:.4f}")
print(f"      F1 Score : {best['f1']:.4f}")
print(f"      CV Score : {best['cv']:.4f}")

# ─────────────────────────────────────────────
# 6. SIMPAN MODEL & LAPORAN
# ─────────────────────────────────────────────
print("\n[6/6] Menyimpan model dan laporan...")

# Simpan model
model_path = os.path.join(MODEL_DIR, "flood_model.pkl")
joblib.dump(best_model, model_path)
print(f"   ✅ Model disimpan: {model_path}")

# Simpan metadata
meta = {
    "model_type"   : best_name,
    "features"     : FEATURES,
    "target"       : TARGET,
    "classes"      : {0: "aman", 1: "waspada", 2: "banjir"},
    "accuracy"     : round(best["acc"], 4),
    "f1_weighted"  : round(best["f1"], 4),
    "cv_f1"        : round(best["cv"], 4),
    "trained_on"   : str(pd.Timestamp.now().date()),
    "n_samples"    : len(df),
}
meta_path = os.path.join(MODEL_DIR, "flood_model_meta.json")
with open(meta_path, "w") as f:
    json.dump(meta, f, indent=2)
print(f"   ✅ Metadata disimpan: {meta_path}")

# Laporan klasifikasi
report = classification_report(
    y_test, best_pred,
    target_names=["aman", "waspada", "banjir"]
)
report_path = os.path.join(MODEL_DIR, "flood_model_report.txt")
with open(report_path, "w") as f:
    f.write(f"Model: {best_name}\n")
    f.write(f"Accuracy : {best['acc']:.4f}\n")
    f.write(f"F1 Score : {best['f1']:.4f}\n")
    f.write(f"CV Score : {best['cv']:.4f}\n\n")
    f.write("Classification Report:\n")
    f.write(report)
print(f"   ✅ Laporan disimpan: {report_path}")

# ─────────────────────────────────────────────
# VISUALISASI
# ─────────────────────────────────────────────
fig, axes = plt.subplots(1, 2, figsize=(14, 5))
fig.suptitle(f"Flood Prediction Model — {best_name}", fontsize=14, fontweight="bold")

# Confusion Matrix
cm = confusion_matrix(y_test, best_pred)
sns.heatmap(
    cm, annot=True, fmt="d", cmap="Blues",
    xticklabels=["aman", "waspada", "banjir"],
    yticklabels=["aman", "waspada", "banjir"],
    ax=axes[0]
)
axes[0].set_title("Confusion Matrix")
axes[0].set_xlabel("Prediksi")
axes[0].set_ylabel("Aktual")

# Feature Importance
if best_name == "Random Forest":
    importances = best_model.feature_importances_
else:
    importances = best_model.feature_importances_

feat_imp = pd.Series(importances, index=FEATURES).sort_values(ascending=True)
feat_imp.plot(kind="barh", ax=axes[1], color="steelblue")
axes[1].set_title("Feature Importance")
axes[1].set_xlabel("Importance Score")

plt.tight_layout()
chart_path = os.path.join(MODEL_DIR, "flood_model_chart.png")
plt.savefig(chart_path, dpi=150, bbox_inches="tight")
plt.close()
print(f"   ✅ Chart disimpan: {chart_path}")

# ─────────────────────────────────────────────
# RINGKASAN AKHIR
# ─────────────────────────────────────────────
print("\n" + "=" * 60)
print("✅ TRAINING SELESAI!")
print("=" * 60)
print(f"\n   Model    : {best_name}")
print(f"   Accuracy : {best['acc']:.4f} ({best['acc']*100:.1f}%)")
print(f"   F1 Score : {best['f1']:.4f}")
print(f"   CV Score : {best['cv']:.4f}")
print(f"\nClassification Report:")
print(report)
print("\nFile output:")
print(f"   {model_path}")
print(f"   {meta_path}")
print(f"   {report_path}")
print(f"   {chart_path}")
print("\nNext step: jalankan predict.py untuk test prediksi!")
