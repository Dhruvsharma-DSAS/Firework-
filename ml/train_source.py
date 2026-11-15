"""Model A — hotspot source classifier: vegetation fire (type 0) vs static/non-vegetation source (type 1, 2, 3).
Labels come from the FIRMS archive 'type' column. Validation is split by 1-degree tiles so nearby pixels never leak between train and test.
Usage: python train_source.py data/your_modis_archive.csv [more.csv ...]   (no args = SIMULATED demo files)"""
import sys

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import average_precision_score, confusion_matrix, f1_score, precision_score, recall_score
from sklearn.model_selection import GroupShuffleSplit

from common import DATA_DIR, MODELS_DIR, cell_index, now_utc, read_many, write_json

MICRO_CELL_DEG = 0.01
TILE_DEG = 1.0
RULE_DAYS = 10
FEATURES = ["days_other_years", "years_other", "night_share", "frp_log", "is_night", "lmst", "month", "abs_lat"]


def build_persistence(df: pd.DataFrame) -> pd.DataFrame:
    """Persistence per ~1 km micro-cell: distinct active days per year, number of active years, share of night detections."""
    df = df.copy()
    df["micro"] = cell_index(df["lat"], df["lon"], MICRO_CELL_DEG)
    df["year"] = df["local_date"].dt.year
    per_year = df.groupby(["micro", "year"])["local_date"].nunique().rename("days").reset_index()
    totals = per_year.groupby("micro")["days"].sum().rename("days_total")
    years = per_year.groupby("micro")["year"].nunique().rename("years_active")
    night = df.assign(n=(df["dn"] == "N").astype(float)).groupby("micro")["n"].mean().rename("night_share")
    table = pd.concat([totals, years, night], axis=1).reset_index()
    return table, per_year


def add_features(df: pd.DataFrame, table: pd.DataFrame, per_year: pd.DataFrame) -> pd.DataFrame:
    """Join persistence to each detection. days_other_years = days_total - days in this row's own year (limits leakage)."""
    df = df.copy()
    df["micro"] = cell_index(df["lat"], df["lon"], MICRO_CELL_DEG)
    df["year"] = df["local_date"].dt.year
    df = df.merge(table, on="micro", how="left")
    df = df.merge(per_year.rename(columns={"days": "days_same_year"}), on=["micro", "year"], how="left")
    df["days_other_years"] = df["days_total"] - df["days_same_year"]
    df["years_other"] = df["years_active"] - 1
    df["frp_log"] = np.log1p(df["frp"].clip(lower=0))
    df["is_night"] = (df["dn"] == "N").astype(int)
    df["month"] = df["local_date"].dt.month
    df["abs_lat"] = df["lat"].abs()
    df["tile"] = cell_index(df["lat"], df["lon"], TILE_DEG)
    return df


def metrics(y_true: np.ndarray, y_pred: np.ndarray, score: np.ndarray) -> dict:
    """Precision = TP/(TP+FP), recall = TP/(TP+FN), F1 = 2PR/(P+R), PR-AUC = average precision."""
    result = {
        "precision": float(precision_score(y_true, y_pred, zero_division=0)),
        "recall": float(recall_score(y_true, y_pred, zero_division=0)),
        "f1": float(f1_score(y_true, y_pred, zero_division=0)),
        "confusion_matrix_[[tn,fp],[fn,tp]]": confusion_matrix(y_true, y_pred).tolist(),
    }
    if score is not None:
        result["pr_auc"] = float(average_precision_score(y_true, score))
    return result


def main(paths: list) -> None:
    """Train, compare with the persistence rule baseline, save model + persistence table + model card."""
    provenance = "RUN_TESTED_LOCALLY"
    if not paths:
        paths = [DATA_DIR / "synthetic_modis_archive.csv"]
        provenance = "SIMULATED_DEMO"
    df = read_many(paths)
    df = df[df["type"].notna()].copy()
    df["label"] = (df["type"].astype(int) != 0).astype(int)
    table, per_year = build_persistence(df)
    df = add_features(df, table, per_year)

    splitter = GroupShuffleSplit(n_splits=1, test_size=0.25, random_state=26)
    train_idx, test_idx = next(splitter.split(df, df["label"], groups=df["tile"]))
    train = df.iloc[train_idx]
    test = df.iloc[test_idx]

    model = HistGradientBoostingClassifier(max_iter=200, learning_rate=0.08, class_weight="balanced", random_state=26)
    model.fit(train[FEATURES], train["label"])
    score = model.predict_proba(test[FEATURES])[:, 1]
    threshold = 0.5
    y_model = (score >= threshold).astype(int)
    y_rule = (test["days_other_years"] >= RULE_DAYS).astype(int).to_numpy()

    card = {
        "model": "source_classifier", "version": "0.1", "trained_at_utc": now_utc(), "provenance": provenance,
        "task": "vegetation fire (0) vs static / non-vegetation source (1)", "label_source": "FIRMS archive 'type' column (0 veg, 1 volcano, 2 static land, 3 offshore)",
        "algorithm": "sklearn HistGradientBoostingClassifier, class_weight=balanced", "features": FEATURES,
        "split": "GroupShuffleSplit by 1-degree tile, 25% test", "n_train": int(len(train)), "n_test": int(len(test)),
        "positive_share_test": float(test["label"].mean()), "threshold": threshold,
        "model_test": metrics(test["label"].to_numpy(), y_model, score),
        "baseline_rule_test": {"rule": "days_other_years >= %d" % RULE_DAYS, **metrics(test["label"].to_numpy(), y_rule, None)},
        "inputs": [str(p) for p in paths],
        "inference": "for a new (NRT) point: days_other_years = days_total and years_other = years_active from persistence_table.csv; unseen micro-cell -> 0, 0 and night_share = is_night",
        "limits": ["Persistence features need the archive history around a point.", "Trained on MODIS; check VIIRS before reuse.", "A hotspot is a pixel, not a fire."],
    }
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": model, "features": FEATURES, "threshold": threshold}, MODELS_DIR / "source_classifier.joblib")
    table.to_csv(MODELS_DIR / "persistence_table.csv", index=False)
    write_json(MODELS_DIR / "source_classifier.card.json", card)
    print("model F1", round(card["model_test"]["f1"], 3), "| rule F1", round(card["baseline_rule_test"]["f1"], 3), "|", provenance)


if __name__ == "__main__":
    main(sys.argv[1:])
