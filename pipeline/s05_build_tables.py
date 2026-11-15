"""Step 5 — turn raw downloads into analysis tables (pure pandas, no network).

python s05_build_tables.py --regions punjab_haryana

Writes to data/processed/<region>/ and data/supabase_csv/:
  fire_detection.csv   every detection, tidy schema, SP preferred over NRT, with cell_id, local_date, lmst
  cell_day.csv         cell × local day × platform × day/night  (F05)
  cell_month.csv       cell × month × platform: hot spots, fire cell-days, FRP, + GEE exposure/weather when present
  region_month.csv     region × month × sensor family: hot spots, cell-days, valid cell-days, rate (F09), weather
  coverage.csv         which months each source really covered (from the download manifest)
A month that was never downloaded or not covered is NULL with status, never 0.
"""
import argparse
from pathlib import Path

import numpy as np
import pandas as pd

from lib.common import PROC_DIR, RAW_DIR, SUPA_DIR, cell_area_km2, cell_center, load_regions, normalise_firms, region_cells

FAMILY = {"terra": "MODIS", "aqua": "MODIS", "snpp": "VIIRS_SNPP", "noaa20": "VIIRS_NOAA20", "noaa21": "VIIRS_NOAA21"}
EXPOSURE_COL = {"terra": "valid_terra", "aqua": "valid_aqua", "snpp": "valid_viirs"}


def read_raw(region_id: str) -> pd.DataFrame:
    """All raw chunk files of a region → one tidy table."""
    base = RAW_DIR / "firms" / region_id
    parts = []
    for path in sorted(base.glob("*/*/*.csv")):
        source = path.parts[-3]
        try:
            raw = pd.read_csv(path)
        except pd.errors.EmptyDataError:
            continue
        if len(raw):
            parts.append(normalise_firms(raw, source))
    if not parts:
        return pd.DataFrame()
    df = pd.concat(parts, ignore_index=True)
    df = df.drop_duplicates(subset=["lat", "lon", "acq_date", "acq_time", "platform"])
    sp_keys = set(zip(df.loc[df["processing"] == "SP", "platform"], df.loc[df["processing"] == "SP", "acq_date"]))
    nrt = df["processing"] == "NRT"
    covered = pd.Series([(p, d) in sp_keys for p, d in zip(df["platform"], df["acq_date"])], index=df.index)
    return df[~(nrt & covered)].reset_index(drop=True)


def coverage(region_id: str) -> pd.DataFrame:
    """Months fully covered by downloaded chunks, per source family (from the manifest)."""
    man_path = RAW_DIR / "firms" / "manifest.csv"
    if not man_path.exists():
        return pd.DataFrame(columns=["family", "month", "covered_days", "days_in_month"])
    man = pd.read_csv(man_path)
    man = man[man["region"] == region_id]
    rows = []
    for _, r in man.iterrows():
        fam = "MODIS" if r["source"].startswith("MODIS") else r["source"].replace("_SP", "").replace("_NRT", "")
        for d in pd.date_range(r["start"], periods=int(r["days"])):
            rows.append((fam, d.date()))
    if not rows:
        return pd.DataFrame(columns=["family", "month", "covered_days", "days_in_month"])
    days = pd.DataFrame(rows, columns=["family", "day"]).drop_duplicates()
    days["month"] = pd.to_datetime(days["day"]).dt.to_period("M").astype(str)
    cov = days.groupby(["family", "month"]).size().rename("covered_days").reset_index()
    cov["days_in_month"] = pd.PeriodIndex(cov["month"], freq="M").days_in_month
    return cov


def confident(df: pd.DataFrame) -> pd.Series:
    """F07 default rule (sensor-native): MODIS confidence ≥ 30, VIIRS n or h."""
    modis = df["sensor"] == "MODIS"
    num = pd.to_numeric(df["confidence_raw"], errors="coerce")
    return (modis & (num >= 30)) | (~modis & df["confidence_raw"].str.lower().isin(["n", "h", "nominal", "high"]))


def build_region(region: dict) -> dict:
    """All tables for one region."""
    rid = region["id"]
    det = read_raw(rid)
    if det.empty:
        print(rid, "no raw FIRMS files yet — run s02 first")
        return {}
    cells = region_cells(rid)
    boundary = "bbox (no polygon cells in region_cell.csv)"
    if cells:
        before = len(det)
        det = det[det["cell_id"].isin(cells)].reset_index(drop=True)
        boundary = "Natural Earth admin-1 polygon cells (region_cell.csv)"
        print(rid, "kept", len(det), "of", before, "bbox detections inside the region polygon cells")
    det["region_id"] = rid
    det["conf_ok"] = confident(det)
    det["month"] = pd.to_datetime(det["local_date"]).dt.to_period("M").astype(str)
    det["family"] = det["platform"].map(FAMILY)
    veg = det["firms_type"].isna() | (det["firms_type"] == 0)
    det["static_or_volcano"] = ~veg
    use = det[det["conf_ok"] & ~det["static_or_volcano"]]

    cell_day = use.groupby(["cell_id", "local_date", "platform", "daynight"]).agg(n_detections=("lat", "size"), max_frp=("frp", "max"), sum_frp=("frp", "sum")).reset_index()
    cell_day["region_id"] = rid

    cm = use.groupby(["cell_id", "month", "platform"]).agg(hotspots=("lat", "size"), fire_cell_days=("local_date", "nunique"), night_hotspots=("daynight", lambda s: int((s == "N").sum())), frp_sum=("frp", "sum"), frp_max=("frp", "max")).reset_index()
    cm["region_id"] = rid
    lat, lon = cell_center(cm["cell_id"].to_numpy())
    cm["area_km2"] = cell_area_km2(lat).round(3)

    gee = load_gee(rid)
    if not gee.empty:
        cm = cm.merge(gee, on=["cell_id", "month"], how="left")
        cm["valid_days"] = [row.get(EXPOSURE_COL.get(p, ""), np.nan) for p, row in zip(cm["platform"], cm.to_dict("records"))]
        cm["fire_rate"] = np.where(cm["valid_days"] > 0, cm["fire_cell_days"] / cm["valid_days"], np.nan)

    cov = coverage(rid)
    rm = region_month(use, gee, cov, region)
    rm["boundary"] = boundary
    out = PROC_DIR / rid
    out.mkdir(parents=True, exist_ok=True)
    det.drop(columns=["conf_ok"]).to_csv(out / "fire_detection.csv", index=False)
    cell_day.to_csv(out / "cell_day.csv", index=False)
    cm.to_csv(out / "cell_month.csv", index=False)
    rm.to_csv(out / "region_month.csv", index=False)
    cov.to_csv(out / "coverage.csv", index=False)
    print(rid, "detections", len(det), "cell-days", len(cell_day), "cell-months", len(cm), "region-months", len(rm))
    return {"det": det, "cell_day": cell_day, "cell_month": cm, "region_month": rm}


def load_gee(rid: str) -> pd.DataFrame:
    """GEE monthly cell table (from s03), if downloaded."""
    files = sorted((RAW_DIR / "gee" / rid).glob("monthly_*.csv"))
    if not files:
        return pd.DataFrame()
    g = pd.concat([pd.read_csv(f) for f in files], ignore_index=True)
    return g.drop(columns=[c for c in g.columns if c.startswith("system:")], errors="ignore")


def region_month(use: pd.DataFrame, gee: pd.DataFrame, cov: pd.DataFrame, region: dict) -> pd.DataFrame:
    """Region × month × family. Uncovered months → NULL + status 'not_downloaded'."""
    rid = region["id"]
    agg = use.groupby(["month", "family"]).agg(hotspots=("lat", "size"), night_hotspots=("daynight", lambda s: int((s == "N").sum())), frp_median=("frp", "median")).reset_index()
    cd = use.groupby(["family", "month", "cell_id"])["local_date"].nunique().groupby(["family", "month"]).sum().rename("fire_cell_days").reset_index()
    agg = agg.merge(cd, on=["family", "month"], how="left")
    if cov.empty:
        months = sorted(agg["month"].unique())
        fams = sorted(agg["family"].unique())
        grid = pd.MultiIndex.from_product([months, fams], names=["month", "family"]).to_frame(index=False)
        grid["covered_days"] = np.nan
        grid["days_in_month"] = pd.PeriodIndex(grid["month"], freq="M").days_in_month
    else:
        grid = cov.copy()
    rm = grid.merge(agg, on=["month", "family"], how="left")
    full = rm["covered_days"] >= rm["days_in_month"]
    if cov.empty:
        full = pd.Series(True, index=rm.index)
    no_row = rm["fire_cell_days"].isna()
    rm["status"] = np.where(full, "ok", np.where(rm["covered_days"] > 0, "partial", "not_downloaded"))
    if cov.empty:
        rm["status"] = "coverage_unknown"
    if not gee.empty:
        expo = {"MODIS": ["valid_terra", "valid_aqua"], "VIIRS_SNPP": ["valid_viirs"]}
        g = gee.copy()
        weather_cols = [c for c in ["t2m_max_c", "t2m_mean_c", "precip_mm", "wind_ms", "rh_pct", "vpd_kpa", "ndvi", "burned_frac"] if c in g.columns]
        wx = g.groupby("month")[weather_cols].mean().reset_index()
        rows = []
        for fam, cols in expo.items():
            present = [c for c in cols if c in g.columns]
            if present:
                v = g.groupby("month")[present].sum(min_count=1).max(axis=1, skipna=True).rename("valid_cell_days").reset_index()
                v["family"] = fam
                v["exposure_kind"] = "daily_composite_proxy"
                if len(present) > 1:
                    v["exposure_kind"] = "daily_composite_proxy_max_platform (not the union of usable looks; use the pass-level ledger for rates)"
                rows.append(v)
        if rows:
            rm = rm.merge(pd.concat(rows), on=["month", "family"], how="left")
            looked = full & no_row & (rm["valid_cell_days"] > 0)
            for col in ["hotspots", "night_hotspots", "fire_cell_days"]:
                rm.loc[looked, col] = 0
            rm.loc[looked, "status"] = "no_detection"
            rm["rate_per_valid_day"] = np.where(rm["valid_cell_days"] > 0, rm["fire_cell_days"] / rm["valid_cell_days"], np.nan)
        rm = rm.merge(wx, on="month", how="left")
    rm["region_id"] = rid
    return rm.sort_values(["family", "month"]).reset_index(drop=True)


def export_supabase(results: list) -> None:
    """Concatenate all regions into the CSVs that s07 loads into Supabase."""
    SUPA_DIR.mkdir(parents=True, exist_ok=True)
    names = {"det": "fire_detection", "cell_day": "cell_day", "cell_month": "cell_month", "region_month": "region_month"}
    for key, name in names.items():
        frames = [r[key] for r in results if r]
        if frames:
            pd.concat(frames, ignore_index=True).to_csv(SUPA_DIR / (name + ".csv"), index=False)


def main() -> None:
    """Build every region that has raw files."""
    ap = argparse.ArgumentParser()
    ap.add_argument("--regions", nargs="*")
    args = ap.parse_args()
    results = [build_region(r) for r in load_regions(args.regions)]
    export_supabase(results)


if __name__ == "__main__":
    main()
