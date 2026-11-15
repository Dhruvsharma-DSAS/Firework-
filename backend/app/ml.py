"""Loads the trained models from ml/models and serves predictions. If scikit-learn or a model file is missing, every call reports UNAVAILABLE instead of guessing."""
import json
import math
from pathlib import Path

from app import config

MODELS_DIR = config.ROOT / "ml" / "models"
MICRO_CELL_DEG = 0.01
STATE = {"source": None, "persistence": None, "error": None}
MIN_F1 = 0.5


def micro_cell(lat: float, lon: float) -> int:
    """F03 on a 0.01° grid: floor(round((lat+90)/0.01, 6)) * 36000 + floor(round((lon+180)/0.01, 6))."""
    ncols = int(round(360.0 / MICRO_CELL_DEG))
    nrows = int(round(180.0 / MICRO_CELL_DEG))
    row = min(max(int(math.floor(round((lat + 90.0) / MICRO_CELL_DEG, 6))), 0), nrows - 1)
    col = min(max(int(math.floor(round((lon + 180.0) / MICRO_CELL_DEG, 6))), 0), ncols - 1)
    return row * ncols + col


def read_card(name: str) -> dict:
    """Model card JSON written by the training script, or None."""
    path = MODELS_DIR / (name + ".card.json")
    if not path.exists():
        return None
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def load_source_model() -> bool:
    """Load source_classifier.joblib and persistence_table.csv once."""
    if STATE["source"] is not None:
        return True
    try:
        import joblib
        import pandas as pd
        STATE["source"] = joblib.load(MODELS_DIR / "source_classifier.joblib")
        table = pd.read_csv(MODELS_DIR / "persistence_table.csv")
        STATE["persistence"] = {int(r.micro): (float(r.days_total), float(r.years_active), float(r.night_share)) for r in table.itertuples()}
        return True
    except Exception as error:
        STATE["error"] = str(error)
        return False


def features_for(point: dict) -> list:
    """Same features as ml/train_source.py: persistence from the archive table + this detection's own values."""
    is_night = 0
    if str(point.get("dn", "D")) == "N":
        is_night = 1
    found = STATE["persistence"].get(micro_cell(point["lat"], point["lon"]))
    if found:
        days_other, years_other, night_share = found
    else:
        days_other, years_other, night_share = 0.0, 0.0, float(is_night)
    utc = str(point.get("utc", "12:00")).replace(":", "")
    hour = int(utc[:-2] or 0) + int(utc[-2:]) / 60.0
    lmst = (hour + point["lon"] / 15.0) % 24.0
    month = int(str(point.get("date", "2026-01-01"))[5:7])
    frp = max(float(point.get("frp") or 0.0), 0.0)
    return [days_other, years_other, night_share, math.log1p(frp), is_night, lmst, month, abs(point["lat"])]


def classify(points: list) -> dict:
    """P(static / non-vegetation source) for each point. Provenance comes from the model card.
    Served only when the held-out F1 is at least MIN_F1; a weaker model answers UNAVAILABLE with its score."""
    card = read_card("source_classifier")
    if card is None or not load_source_model():
        return {"data": [], "meta": {"status": "UNAVAILABLE", "reason": STATE["error"] or "model not trained yet (run ml/train_source.py)"}}
    f1 = card["model_test"]["f1"]
    if f1 < MIN_F1:
        return {"data": [], "meta": {"status": "UNAVAILABLE", "reason": "model trained but too weak to show (held-out F1 %.2f < %.1f)" % (f1, MIN_F1), "f1_test": f1, "provenance": card["provenance"]}}
    bundle = STATE["source"]
    rows = [features_for(p) for p in points]
    probs = bundle["model"].predict_proba(rows)[:, 1]
    out = []
    for point, prob in zip(points, probs):
        label = "vegetation"
        if prob >= bundle["threshold"]:
            label = "static_or_non_vegetation"
        out.append({"id": point.get("id"), "p_static": round(float(prob), 3), "label": label})
    return {"data": out, "meta": {"status": "MODEL_ESTIMATE", "provenance": card["provenance"], "model": card["model"] + " v" + card["version"], "f1_test": card["model_test"]["f1"]}}


def harmonised(region: str) -> dict:
    """Back-cast calendar written by ml/train_harmonise.py (data/processed/harmonised_{region}.json)."""
    path = config.PROCESSED_DIR / ("harmonised_" + region + ".json")
    if not path.exists():
        return None
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def cards() -> dict:
    """All model cards, so the Validation page can show the real test metrics."""
    found = []
    for name in ["source_classifier", "harmonise", "forecast"]:
        card = read_card(name)
        if card is not None:
            found.append(card)
    return {"data": found, "meta": {"data_source": "FIREWORK model cards (ml/models)", "status": "OK", "count": len(found)}}
