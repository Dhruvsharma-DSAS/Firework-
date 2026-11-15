"""Model C — next-month fire-activity outlook per 0.1° cell (early-warning context, NOT an alert).

python train_forecast.py --processed ../pipeline/data/processed --regions punjab_haryana cordoba_ar

Target   : VIIRS S-NPP fire cell-days in the cell next month (2012 →), the record's most detailed sensor.
Features : same-month history (mean, max, years active), last month and last 3 months of activity (all sensors),
           this month's weather and vegetation from Earth Engine when present (t2m, precip, VPD, RH, wind, NDVI),
           calendar month, latitude, cell area.
Baseline : climatology = mean VIIRS cell-days of the same calendar month in earlier years (what a manager would guess).
Model    : HistGradientBoostingRegressor, Poisson loss (counts).
Validation: rolling origin — for each of the last 3 years Y: train on years < Y, test on Y. No random splits.
Metrics  : Poisson deviance, MAE, skill = 1 − deviance_model / deviance_climatology, and for "above normal" months
           (target > climatology) the Brier score of P(above normal) from a classifier twin.
Output   : models/forecast.joblib, models/forecast.card.json (provenance RUN_TESTED_LOCALLY only on real data).
"""
import argparse
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.metrics import brier_score_loss, mean_absolute_error, mean_poisson_deviance

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import MODELS_DIR, now_utc, write_json

WEATHER = ["t2m_max_c", "t2m_mean_c", "precip_mm", "vpd_kpa", "rh_pct", "wind_ms", "ndvi"]


def load(processed: Path, regions: list) -> pd.DataFrame:
    """cell_month.csv of each region → one table indexed by cell × month with activity per family + weather."""
    parts = []
    for rid in regions:
        p = processed / rid / "cell_month.csv"
        if p.exists():
            d = pd.read_csv(p, low_memory=False)
            d["region_id"] = rid
            parts.append(d)
    if not parts:
        raise SystemExit("no cell_month.csv found — run the pipeline steps 5–6 first")
    cm = pd.concat(parts, ignore_index=True)
    cm["family"] = cm["platform"].map({"terra": "modis", "aqua": "modis", "snpp": "viirs", "noaa20": "n20", "noaa21": "n21"})
    act = cm.pivot_table(index=["region_id", "cell_id", "month"], columns="family", values="fire_cell_days", aggfunc="sum")
    act.columns = ["cd_" + c for c in act.columns]
    wx_cols = [c for c in WEATHER + ["area_km2"] if c in cm.columns]
    wx = cm.groupby(["region_id", "cell_id", "month"])[wx_cols].mean()
    return act.join(wx, how="left").reset_index()


def features(t: pd.DataFrame) -> pd.DataFrame:
    """Complete cell × month panel (zeros only inside downloaded months), lags, climatology, next-month target."""
    t = t.copy()
    t["period"] = pd.PeriodIndex(t["month"], freq="M")
    cells = t[["region_id", "cell_id"]].drop_duplicates()
    months = pd.period_range(t["period"].min(), t["period"].max(), freq="M")
    panel = cells.merge(pd.DataFrame({"period": months}), how="cross")
    t = panel.merge(t.drop(columns=["month"]), on=["region_id", "cell_id", "period"], how="left")
    for c in [c for c in t.columns if c.startswith("cd_")]:
        t[c] = t[c].fillna(0)
    t["cd_all"] = t[[c for c in t.columns if c.startswith("cd_")]].sum(axis=1)
    t = t.sort_values(["region_id", "cell_id", "period"])
    g = t.groupby(["region_id", "cell_id"])
    t["lag1"] = g["cd_all"].shift(1)
    t["lag3"] = g["cd_all"].transform(lambda s: s.shift(1).rolling(3, min_periods=1).sum())
    t["year"] = t["period"].dt.year
    t["mon"] = t["period"].dt.month
    t["target_next"] = g["cd_viirs"].shift(-1) if "cd_viirs" in t.columns else np.nan
    t["next_year"] = g["year"].shift(-1)
    t["next_mon"] = g["mon"].shift(-1)
    def climatology(col: str, prefix: str) -> pd.DataFrame:
        """Expanding mean / max / active-years of `col` for the same calendar month in EARLIER years only (no leakage)."""
        hist = t[["region_id", "cell_id", "year", "mon", col]].rename(columns={"year": "hy", "mon": "next_mon", col: "hist"})
        out = []
        for (rid, cell, nm), grp in hist.groupby(["region_id", "cell_id", "next_mon"]):
            grp = grp.sort_values("hy")
            out.append(pd.DataFrame({"region_id": rid, "cell_id": cell, "next_mon": nm, "next_year": grp["hy"].to_numpy(),
                                     prefix + "_mean": grp["hist"].expanding().mean().shift(1).to_numpy(),
                                     prefix + "_max": grp["hist"].expanding().max().shift(1).to_numpy(),
                                     prefix + "_years_active": (grp["hist"] > 0).astype(int).expanding().sum().shift(1).to_numpy()}))
        return pd.concat(out)

    t = t.merge(climatology("cd_all", "clim"), on=["region_id", "cell_id", "next_mon", "next_year"], how="left")
    if "cd_viirs" in t.columns:
        vt = t["cd_viirs"].where(t["year"] >= 2012)
        t["cd_viirs_hist"] = vt
        t = t.merge(climatology("cd_viirs_hist", "climv"), on=["region_id", "cell_id", "next_mon", "next_year"], how="left")
    lat = t["cell_id"] // 3600 * 0.1 - 90 + 0.05
    t["abs_lat"] = lat.abs()
    return t


def main() -> None:
    """Rolling-origin evaluation, then fit on everything and save model + card."""
    ap = argparse.ArgumentParser()
    ap.add_argument("--processed", required=True)
    ap.add_argument("--regions", nargs="+", required=True)
    ap.add_argument("--provenance", default="RUN_TESTED_LOCALLY")
    args = ap.parse_args()
    t = features(load(Path(args.processed), args.regions))
    feats = ["lag1", "lag3", "clim_mean", "clim_max", "clim_years_active", "climv_mean", "next_mon", "abs_lat"] + [c for c in WEATHER + ["area_km2"] if c in t.columns]
    d = t.dropna(subset=["target_next", "climv_mean"]).copy()
    years = sorted(d["next_year"].unique())
    tests = [int(y) for y in years[-3:]] if len(years) >= 4 else []
    folds = []
    for y in tests:
        tr = d[d["next_year"] < y]
        te = d[d["next_year"] == y]
        if len(tr) < 50 or len(te) == 0:
            continue
        reg = HistGradientBoostingRegressor(loss="poisson", max_iter=300, learning_rate=0.05, random_state=26).fit(tr[feats], tr["target_next"])
        pred = np.clip(reg.predict(te[feats]), 1e-6, None)
        clim = np.clip(te["climv_mean"].to_numpy(), 1e-6, None)
        above_tr = (tr["target_next"] > tr["climv_mean"]).astype(int)
        above_te = (te["target_next"] > te["climv_mean"]).astype(int)
        brier = np.nan
        if above_tr.nunique() == 2:
            clf = HistGradientBoostingClassifier(max_iter=200, learning_rate=0.05, random_state=26).fit(tr[feats], above_tr)
            brier = float(brier_score_loss(above_te, clf.predict_proba(te[feats])[:, 1]))
        dev_m = float(mean_poisson_deviance(te["target_next"], pred))
        dev_c = float(mean_poisson_deviance(te["target_next"], clim))
        folds.append({"test_year": y, "n_test": int(len(te)), "deviance_model": dev_m, "deviance_climatology": dev_c, "skill_vs_climatology": 1 - dev_m / dev_c if dev_c > 0 else None,
                      "mae_model": float(mean_absolute_error(te["target_next"], pred)), "mae_climatology": float(mean_absolute_error(te["target_next"], clim)), "brier_above_normal": brier, "base_rate_above_normal": float(above_te.mean())})
    reg = HistGradientBoostingRegressor(loss="poisson", max_iter=300, learning_rate=0.05, random_state=26).fit(d[feats], d["target_next"])
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": reg, "features": feats}, MODELS_DIR / "forecast.joblib")
    card = {"model": "forecast_next_month", "version": "0.1", "trained_at_utc": now_utc(), "provenance": args.provenance, "regions": args.regions,
            "target": "VIIRS S-NPP fire cell-days per 0.1° cell, next month", "features": feats, "algorithm": "HistGradientBoostingRegressor (Poisson)",
            "validation": "rolling origin by year (train < Y, test = Y)", "folds": folds, "n_rows": int(len(d)),
            "use_rule": "show the outlook only if skill_vs_climatology > 0 in every fold; label it an outlook, not an alert",
            "limits": ["Weather of the current month is used, not a weather forecast — the outlook is valid at the end of the month.", "A hot spot is a pixel, not a fire."]}
    write_json(MODELS_DIR / "forecast.card.json", card)
    for f in folds:
        print("test %d  deviance model %.3f vs climatology %.3f  skill %.2f" % (f["test_year"], f["deviance_model"], f["deviance_climatology"], f["skill_vs_climatology"] or float("nan")))
    print("saved", MODELS_DIR / "forecast.joblib")


if __name__ == "__main__":
    main()
