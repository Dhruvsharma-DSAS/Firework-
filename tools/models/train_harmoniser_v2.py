"""Harmoniser v2: does a model with the new physical features beat the exchange rate k?

Same honesty rule as notebook 03: leave-one-year-out over 2012-2025, the baseline is k (ratio of totals learned
without the held-out year), and the model is READY only if it beats k in every held-out year. A second test holds
out whole continents (as T1 does). The model learns a correction to k (log of VIIRS / (k * MODIS)), so with no
signal it falls back to k itself.

Features (all observable from MODIS alone, so they also exist before 2012):
  month (sin, cos), mean latitude, MODIS night share, Terra share, fire power per hotspot,
  hotspots per cell-day, log MODIS cell-days, log k.
Input: Colab export/calendar_region_monthly.csv. Output: data/processed/global/model_card_harmoniser_v2.json.
Run: backend/.venv/bin/python tools/models/train_harmoniser_v2.py <path to calendar_region_monthly.csv>"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "processed" / "global" / "model_card_harmoniser_v2.json"
FEATURES = ["m_sin", "m_cos", "lat_mean", "night_share", "terra_share", "frp_per_hotspot", "hotspots_per_cd", "log_m", "log_k"]
MIN_MODIS = 10


def table(path: str) -> pd.DataFrame:
    rm = pd.read_csv(path)
    rm = rm[rm.region_id.str.startswith(("world", "c_", "b_")) & (rm.year >= 2012) & (rm.year <= 2025)]
    m = rm[rm.family == "modis"].set_index(["region_id", "year", "month"])
    v = rm[rm.family == "viirs"].set_index(["region_id", "year", "month"])["fire_cell_days"].rename("viirs")
    t = m.join(v, how="inner").reset_index()
    t = t[(t.fire_cell_days >= MIN_MODIS) & t.viirs.notna()].copy()
    t["modis"] = t.fire_cell_days.astype(float)
    t["m_sin"] = np.sin(2 * np.pi * t.month / 12)
    t["m_cos"] = np.cos(2 * np.pi * t.month / 12)
    t["night_share"] = t.cell_days_night / (t.cell_days_day + t.cell_days_night).replace(0, np.nan)
    t["terra_share"] = t.cell_days_terra / (t.cell_days_terra + t.cell_days_aqua).replace(0, np.nan)
    t["frp_per_hotspot"] = np.log1p(t.frp_sum / t.hotspots.replace(0, np.nan))
    t["hotspots_per_cd"] = t.hotspots / t.modis
    t["log_m"] = np.log1p(t.modis)
    return t


def continent_of(regions) -> dict:
    data = json.load(open(ROOT / "frontend" / "public" / "data" / "countries.json"))["data"]["features"]
    by = {"c_" + f["properties"]["iso3"].lower(): f["properties"]["continent"] for f in data if f["properties"].get("iso3")}
    by.update({"b_california": "North America", "b_cordoba_ar": "South America", "b_delhi": "Asia", "b_haryana": "Asia", "b_mato_grosso": "South America", "b_new_south_wales": "Oceania", "b_punjab": "Asia", "b_punjab_haryana": "Asia"})
    return {r: by.get(r) for r in regions}


def k_from(train: pd.DataFrame) -> pd.Series:
    s = train.groupby(["region_id", "month"])[["modis", "viirs"]].sum()
    return (s.viirs / s.modis).rename("k")


def fold(train: pd.DataFrame, test: pd.DataFrame) -> dict:
    k = k_from(train)
    world_k = k_from(train[train.region_id == "world"]).droplevel(0)
    tr = train.join(k, on=["region_id", "month"])
    te = test.join(k, on=["region_id", "month"])
    te["k"] = te.k.fillna(te.month.map(world_k))
    tr["log_k"], te["log_k"] = np.log(tr.k), np.log(te.k)
    tr["target"] = np.log((tr.viirs + 0.5) / (tr.k * tr.modis + 0.5))
    model = HistGradientBoostingRegressor(max_iter=300, learning_rate=0.04, max_leaf_nodes=15, min_samples_leaf=40, l2_regularization=1.0, random_state=0)
    model.fit(tr[FEATURES], tr.target)
    base = te.k * te.modis
    pred = (te.k * te.modis + 0.5) * np.exp(model.predict(te[FEATURES])) - 0.5
    return {"mae_k": float(np.mean(np.abs(base - te.viirs))), "mae_model": float(np.mean(np.abs(pred - te.viirs))),
            "medae_log_k": float(np.median(np.abs(np.log((te.viirs + 0.5) / (base + 0.5))))), "medae_log_model": float(np.median(np.abs(np.log((te.viirs + 0.5) / (pred.clip(lower=0) + 0.5))))), "n": int(len(te))}


def main():
    t = table(sys.argv[1])
    print(len(t), "region-months,", t.region_id.nunique(), "regions")
    years = []
    for y in range(2012, 2026):
        r = fold(t[t.year != y], t[t.year == y])
        r["year"] = y
        r["model_wins"] = r["mae_model"] < r["mae_k"]
        years.append(r)
        print(y, round(r["mae_k"], 1), round(r["mae_model"], 1), r["model_wins"])
    cont = continent_of(t.region_id.unique())
    t["continent"] = t.region_id.map(cont)
    conts = []
    for c in sorted(x for x in t.continent.dropna().unique()):
        test = t[t.continent == c]
        train = t[(t.continent != c) | (t.region_id == "world")]
        train = train[train.continent != c]
        r = fold(pd.concat([train, t[t.region_id == "world"]]), test)
        r["continent"] = c
        r["model_wins"] = r["mae_model"] < r["mae_k"]
        conts.append(r)
        print(c, round(r["mae_k"], 1), round(r["mae_model"], 1), r["model_wins"])
    ready = all(r["model_wins"] for r in years)
    card = {
        "name": "Harmoniser v2 (correction to k)",
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "data": "Colab export/calendar_region_monthly.csv, 2012-2025 overlap, world + countries + boxes, MODIS >= %d cell-days" % MIN_MODIS,
        "rows": int(len(t)),
        "features": FEATURES,
        "baseline": "exchange rate k = ratio of totals per region and month, learned without the held-out year",
        "rule": "READY only if the model beats k (mean absolute error) in every held-out year",
        "leave_one_year_out": years,
        "years_won": int(sum(r["model_wins"] for r in years)),
        "leave_one_continent_out": conts,
        "continents_won": int(sum(r["model_wins"] for r in conts)),
        "ready": ready,
        "verdict": "READY" if ready else "NOT READY - the calendar keeps using k",
    }
    OUT.write_text(json.dumps(card, indent=1))
    print(card["verdict"], "| years won", card["years_won"], "/ 14 | continents won", card["continents_won"], "/", len(conts))


if __name__ == "__main__":
    main()
