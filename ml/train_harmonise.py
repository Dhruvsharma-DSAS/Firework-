"""Model B — MODIS → VIIRS harmonisation with an honest interval.
Learns VIIRS cell-days from MODIS cell-days in the overlap years (2012+), then back-casts VIIRS-equivalent values for MODIS-only years.
Point estimate: Poisson gradient boosting. Interval: conformalized quantile regression (5% / 95% quantile models + a calibration shift).
Usage: python train_harmonise.py MODIS.csv[,MODIS2.csv] VIIRS.csv[,VIIRS2.csv] [region_id]   (no args = SIMULATED demo files)"""
import sys

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor

from common import DATA_DIR, MODELS_DIR, cell_center, cell_index, now_utc, read_many, write_json

CELL_DEG = 0.1
FEATURES = ["modis_log", "modis_frp_log", "modis_night_share", "month", "lat", "abs_lat", "modis_neigh_log"]
FIT_YEARS = (2012, 2020)
CAL_YEARS = (2021, 2022)
TEST_YEARS = (2023, 2026)
ALPHA = 0.10


def cell_months(df: pd.DataFrame, prefix: str) -> pd.DataFrame:
    """Cell-days per 0.1° cell per month = number of distinct local days with ≥1 detection (F-series cell-day count)."""
    df = df.copy()
    df["cell"] = cell_index(df["lat"], df["lon"], CELL_DEG)
    df["year"] = df["local_date"].dt.year
    df["month"] = df["local_date"].dt.month
    df["night"] = (df["dn"] == "N").astype(float)
    grouped = df.groupby(["cell", "year", "month"])
    out = pd.DataFrame({
        prefix + "_cd": grouped["local_date"].nunique(),
        prefix + "_frp": grouped["frp"].mean(),
        prefix + "_night_share": grouped["night"].mean(),
    }).reset_index()
    return out


def build_table(modis: pd.DataFrame, viirs: pd.DataFrame) -> pd.DataFrame:
    """Universe = every cell that ever had a detection × only the (year, month) pairs the archive files really cover.
    A covered month is one with at least one detection of that sensor in the region (downloaded and observed); inside
    those months an absent cell is a true zero. Months that were never downloaded are left out, never filled with 0."""
    m = cell_months(modis, "modis")
    v = cell_months(viirs, "viirs")
    cells = pd.Index(sorted(set(m["cell"]).union(set(v["cell"]))), name="cell")
    modis_months = sorted(set(zip(m["year"], m["month"])))
    viirs_months = set(zip(v["year"], v["month"]))
    ym = pd.DataFrame(modis_months, columns=["year", "month"])
    grid = pd.DataFrame({"cell": cells}).merge(ym, how="cross")
    table = grid.merge(m, on=["cell", "year", "month"], how="left").merge(v, on=["cell", "year", "month"], how="left")
    table["modis_cd"] = table["modis_cd"].fillna(0)
    covered = pd.Series([(y, mo) in viirs_months for y, mo in zip(table["year"], table["month"])], index=table.index)
    table.loc[covered, "viirs_cd"] = table.loc[covered, "viirs_cd"].fillna(0)
    table.loc[~covered, "viirs_cd"] = np.nan
    lat, lon = cell_center(table["cell"], CELL_DEG)
    table["lat"] = lat
    table["lon"] = lon
    table["abs_lat"] = table["lat"].abs()
    table["modis_log"] = np.log1p(table["modis_cd"])
    table["modis_frp_log"] = np.log1p(table["modis_frp"].fillna(0))
    table["modis_night_share"] = table["modis_night_share"].fillna(-1)
    table["tile"] = cell_index(table["lat"], table["lon"], 1.0)
    neigh = table.groupby(["tile", "year", "month"])["modis_cd"].transform("sum") - table["modis_cd"]
    table["modis_neigh_log"] = np.log1p(neigh)
    return table


def in_years(df: pd.DataFrame, span: tuple) -> pd.DataFrame:
    """Rows whose year is inside [span0, span1]."""
    return df[(df["year"] >= span[0]) & (df["year"] <= span[1])]


def fit_quantile(train: pd.DataFrame, q: float) -> HistGradientBoostingRegressor:
    """Gradient-boosted quantile regression on log1p(VIIRS cell-days): minimises pinball loss at quantile q."""
    model = HistGradientBoostingRegressor(loss="quantile", quantile=q, max_iter=250, learning_rate=0.06, random_state=26)
    model.fit(train[FEATURES], np.log1p(train["viirs_cd"]))
    return model


def fit_mean(train: pd.DataFrame) -> HistGradientBoostingRegressor:
    """Expected VIIRS cell-days E[y|x] with Poisson loss. Expected values add up correctly to region totals (medians do not)."""
    model = HistGradientBoostingRegressor(loss="poisson", max_iter=250, learning_rate=0.06, random_state=26)
    model.fit(train[FEATURES], train["viirs_cd"])
    return model


def predict_interval(models: dict, shift: float, df: pd.DataFrame) -> tuple:
    """Point = Poisson mean model. Band (CQR) = [q05 - shift, q95 + shift] in log space, back to counts with expm1, floored at 0."""
    lo = models["q05"].predict(df[FEATURES]) - shift
    mid = models["mean"].predict(df[FEATURES])
    hi = models["q95"].predict(df[FEATURES]) + shift
    return np.clip(np.expm1(lo), 0, None), np.clip(mid, 0, None), np.clip(np.expm1(hi), 0, None)


def region_month_totals(df: pd.DataFrame, column: str) -> pd.Series:
    """Sum a cell-level column to region × year × month."""
    return df.groupby(["year", "month"])[column].sum()


def main(modis_paths: list, viirs_paths: list, region: str = "world") -> None:
    """Fit on 2012–2020, calibrate on 2021–2022, test on 2023–2026; compare with the constant-k baseline; write model, card and back-cast calendar."""
    provenance = "RUN_TESTED_LOCALLY"
    if not modis_paths:
        modis_paths = [DATA_DIR / "synthetic_modis_archive.csv"]
        viirs_paths = [DATA_DIR / "synthetic_viirs_archive.csv"]
        provenance = "SIMULATED_DEMO"
    modis = read_many(modis_paths)
    viirs = read_many(viirs_paths)
    modis = modis[modis["type"].fillna(0).astype(int) == 0]
    viirs = viirs[viirs["type"].fillna(0).astype(int) == 0]
    table = build_table(modis, viirs)
    active = table[table["viirs_cd"].notna()]

    fit = in_years(active, FIT_YEARS)
    cal = in_years(active, CAL_YEARS)
    test = in_years(active, TEST_YEARS)

    k_global = float(fit["viirs_cd"].sum() / max(fit["modis_cd"].sum(), 1))
    models = {"q05": fit_quantile(fit, 0.05), "mean": fit_mean(fit), "q95": fit_quantile(fit, 0.95)}

    cal_lo = models["q05"].predict(cal[FEATURES])
    cal_hi = models["q95"].predict(cal[FEATURES])
    y_cal = np.log1p(cal["viirs_cd"].to_numpy())
    scores = np.maximum(cal_lo - y_cal, y_cal - cal_hi)
    level = min(1.0, np.ceil((len(scores) + 1) * (1 - ALPHA)) / len(scores))
    shift = float(np.quantile(scores, level))

    lo, mid, hi = predict_interval(models, shift, test)
    y = test["viirs_cd"].to_numpy()
    base = k_global * test["modis_cd"].to_numpy()
    test = test.assign(pred=mid, lo=lo, hi=hi, base=base)
    tot_true = region_month_totals(test, "viirs_cd")
    tot_pred = region_month_totals(test, "pred")
    tot_base = region_month_totals(test, "base")

    card = {
        "model": "harmonise_modis_to_viirs", "version": "0.1", "trained_at_utc": now_utc(), "provenance": provenance,
        "target": "VIIRS (S-NPP) cell-days per 0.1° cell per month, learned as log1p", "algorithm": "sklearn HistGradientBoostingRegressor, Poisson loss for the point estimate + quantile loss 0.05/0.95 with split-conformal shift (CQR) for the band",
        "features": FEATURES, "fit_years": FIT_YEARS, "calibration_years": CAL_YEARS, "test_years": TEST_YEARS,
        "n_fit": int(len(fit)), "n_cal": int(len(cal)), "n_test": int(len(test)), "conformal_shift_log": shift, "target_coverage": 1 - ALPHA,
        "baseline_constant_k": k_global,
        "cell_month_test": {
            "mae_model": float(np.mean(np.abs(mid - y))), "mae_constant_k": float(np.mean(np.abs(base - y))),
            "bias_model": float(np.mean(mid - y)), "interval_coverage": float(np.mean((y >= lo) & (y <= hi))),
            "rmse_model": float(np.sqrt(np.mean((mid - y) ** 2))), "rmse_constant_k": float(np.sqrt(np.mean((base - y) ** 2))),
            "mean_interval_width": float(np.mean(hi - lo)),
        },
        "region_month_test": {
            "mape_model": float(np.mean(np.abs(tot_pred - tot_true) / tot_true.clip(lower=1))),
            "mape_constant_k": float(np.mean(np.abs(tot_base - tot_true) / tot_true.clip(lower=1))),
        },
        "limits": ["Assumes the MODIS→VIIRS relation in 2012–2026 also held before 2012.", "Regional intervals here are summed cell bounds (conservative, too wide).", "A cell-day is not burned area."],
    }
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump({"models": models, "shift": shift, "features": FEATURES, "k_global": k_global}, MODELS_DIR / "harmonise.joblib")
    write_json(MODELS_DIR / "harmonise.card.json", card)
    card["region"] = region
    write_backcast(table, models, shift, provenance, region)
    c = card["cell_month_test"]
    print("MAE model", round(c["mae_model"], 3), "| MAE const-k", round(c["mae_constant_k"], 3), "| coverage", round(c["interval_coverage"], 3), "|", provenance)


def write_backcast(table: pd.DataFrame, models: dict, shift: float, provenance: str, region: str) -> None:
    """Writes data/processed/harmonised_<region>.json: years × 12 months of raw MODIS, VIIRS, and model VIIRS-equivalent with band."""
    lo, mid, hi = predict_interval(models, shift, table)
    table = table.assign(pred=mid, lo=lo, hi=hi)
    years = sorted(table["year"].unique().tolist())
    def matrix(column: str) -> list:
        totals = table.groupby(["year", "month"])[column].sum(min_count=1)
        return [[totals.get((y, m), None) for m in range(1, 13)] for y in years]
    payload = {
        "data": {"region": region, "years": years, "modis": matrix("modis_cd"), "viirs": matrix("viirs_cd"),
                 "harmonised": matrix("pred"), "harmonised_lo": matrix("lo"), "harmonised_hi": matrix("hi")},
        "meta": {"provenance": provenance, "unit": "cell-days per month", "model": "harmonise v0.1", "demo": provenance == "SIMULATED_DEMO",
                 "note": "harmonised = VIIRS-equivalent estimate with conservative band; null = no coverage", "generated_at_utc": now_utc()},
    }
    from common import PROCESSED_DIR
    write_json(PROCESSED_DIR / ("harmonised_%s.json" % region), payload)


if __name__ == "__main__":
    args = sys.argv[1:]
    if len(args) == 3:
        main(args[0].split(","), args[1].split(","), args[2])
    elif len(args) == 2:
        main(args[0].split(","), args[1].split(","))
    else:
        main([], [])
