"""Step 6 — harmonise MODIS onto the VIIRS (S-NPP) scale and write the calendars the website serves.

python s06_harmonise.py --regions punjab_haryana

Method (baseline ladder, atlas Part III):
  B2 if exposure exists: k_m = Σ VIIRS rate / Σ MODIS rate over overlap years for calendar month m (rate = cell-days / valid cell-days, F09)
  B1-total otherwise:    k_m = Σ VIIRS cell-days / Σ MODIS cell-days (ratio of totals, F14 intercept-only)
  Band: 95 % percentile interval from a block bootstrap over overlap years (F24, B = 2000, seed 26).
  Harmonised value: VIIRS observed for years ≥ 2012; k_m × MODIS before (F12), with lo/hi from the k band.
  Separate k for hot-spot counts (the challenge asks for "number of hot spots") and for fire cell-days.
Output: data/processed/<region>/calibration.csv, calendar_<region>.json (backend format), anomaly.csv
Provenance: SOURCE_DERIVED for counts; harmonised values RUN_TESTED_LOCALLY only after the held-out test (s06 --validate).
"""
import argparse
import json

import numpy as np
import pandas as pd

from lib.common import PROC_DIR, load_regions, now_utc

RNG = np.random.default_rng(26)
OVERLAP_START = 2012


def k_for(month_df: pd.DataFrame, value: str, b: int = 2000) -> tuple:
    """Ratio of totals over overlap years, usable zeros kept (a month with MODIS 0 and VIIRS > 0 counts) + year-block bootstrap (95 %)."""
    d = month_df.dropna(subset=[value + "_m", value + "_v"])
    if len(d) < 3 or d[value + "_m"].sum() <= 0:
        return (np.nan, np.nan, np.nan, len(d))
    k = d[value + "_v"].sum() / d[value + "_m"].sum()
    idx = np.arange(len(d))
    boots = []
    vm = d[value + "_m"].to_numpy()
    vv = d[value + "_v"].to_numpy()
    for _ in range(b):
        s = RNG.choice(idx, size=len(idx), replace=True)
        if vm[s].sum() > 0:
            boots.append(vv[s].sum() / vm[s].sum())
    return (float(k), float(np.quantile(boots, 0.025)), float(np.quantile(boots, 0.975)), len(d))


def harmonise_region(region: dict) -> None:
    """Fit k per calendar month for hot spots and cell-days, build calendars and anomalies."""
    rid = region["id"]
    path = PROC_DIR / rid / "region_month.csv"
    if not path.exists():
        print(rid, "run s05 first")
        return
    rm = pd.read_csv(path)
    partial = ~rm["status"].isin(["ok", "coverage_unknown"])
    for col in ["hotspots", "fire_cell_days", "rate_per_valid_day"]:
        if col in rm.columns:
            rm.loc[partial, col] = np.nan
    m = rm[rm["family"] == "MODIS"].set_index("month")
    v = rm[rm["family"] == "VIIRS_SNPP"].set_index("month")
    months = sorted(set(m.index) | set(v.index))
    df = pd.DataFrame(index=months)
    use_rate = "rate_per_valid_day" in rm.columns and rm["rate_per_valid_day"].notna().any()
    metrics = {"hotspots": "hotspots", "cell_days": "fire_cell_days"}
    if use_rate:
        metrics["rate"] = "rate_per_valid_day"
    for short, col in metrics.items():
        df[short + "_m"] = m[col].reindex(months) if col in m.columns else np.nan
        df[short + "_v"] = v[col].reindex(months) if col in v.columns else np.nan
    df["year"] = [int(x[:4]) for x in df.index]
    df["mon"] = [int(x[5:7]) for x in df.index]
    overlap = df[df["year"] >= OVERLAP_START]
    cal_rows = []
    for short in metrics:
        for mon in range(1, 13):
            k, lo, hi, n = k_for(overlap[overlap["mon"] == mon], short)
            cal_rows.append({"region_id": rid, "metric": short, "calendar_month": mon, "k": k, "k_lo95": lo, "k_hi95": hi, "n_overlap_years": n,
                             "method": "ratio of totals per calendar month, MODIS (Terra+Aqua) vs VIIRS S-NPP, year-block bootstrap 95 %", "fitted_at_utc": now_utc()})
    calib = pd.DataFrame(cal_rows)
    out = PROC_DIR / rid
    calib.to_csv(out / "calibration.csv", index=False)

    years = sorted(set(df["year"]))
    payload = {"region": rid, "name": region["name"], "years": years, "months": list(range(1, 13))}
    for short in metrics:
        kmap = calib[calib["metric"] == short].set_index("calendar_month")
        raw, harm, lo_m, hi_m, status = [], [], [], [], []
        for y in years:
            r_raw, r_h, r_lo, r_hi, r_st = [], [], [], [], []
            for mon in range(1, 13):
                key = "%04d-%02d" % (y, mon)
                mv = df[short + "_m"].get(key, np.nan)
                vv = df[short + "_v"].get(key, np.nan)
                if y >= OVERLAP_START:
                    r_raw.append(vv)
                    r_h.append(vv)
                    r_lo.append(vv)
                    r_hi.append(vv)
                    r_st.append("observed_viirs" if pd.notna(vv) else "null")
                else:
                    kk = kmap["k"].get(mon, np.nan)
                    r_raw.append(mv)
                    r_h.append(mv * kk if pd.notna(mv) and pd.notna(kk) else np.nan)
                    r_lo.append(mv * kmap["k_lo95"].get(mon, np.nan) if pd.notna(mv) else np.nan)
                    r_hi.append(mv * kmap["k_hi95"].get(mon, np.nan) if pd.notna(mv) else np.nan)
                    r_st.append("harmonised_modis" if pd.notna(r_h[-1]) else "null")
            raw.append(r_raw)
            harm.append(r_h)
            lo_m.append(r_lo)
            hi_m.append(r_hi)
            status.append(r_st)
        payload[short] = {"raw": raw, "harmonised": harm, "lo95": lo_m, "hi95": hi_m, "status": status}
    payload_json = json.loads(json.dumps(payload, default=float).replace("NaN", "null"))
    result = {"data": payload_json, "meta": {"status": "ARCHIVE_STANDARD", "provenance": "SOURCE_DERIVED", "unit": {"hotspots": "hot spots (pixels)", "cell_days": "fire cell-days", "rate": "fire cell-days per valid observation day"},
                                            "harmonised_provenance": "PROPOSED_UNVALIDATED until s06 --validate passes", "method": "see calibration.csv", "generated_at_utc": now_utc(), "demo": False,
                                            "boundary": str(rm["boundary"].iloc[0]) if "boundary" in rm.columns else "bbox"}}
    with open(out / ("calendar_%s.json" % rid), "w") as handle:
        json.dump(result, handle)
    anomaly(payload, rid).to_csv(out / "anomaly.csv", index=False)
    print(rid, "calendar written:", out / ("calendar_%s.json" % rid))


def anomaly(payload: dict, rid: str) -> pd.DataFrame:
    """Each month vs the same calendar month in other years, on the harmonised hot-spot scale (VIIRS observed ≥ 2012, k × MODIS before):
    median, mean, % vs median, robust z = (log(x+0.5) − median log) / max(1.4826·MAD, 0.15)  (F27 style), n reference years (≥ 8 = ok)."""
    years = payload["years"]
    h = payload["hotspots"]["harmonised"]
    t = pd.DataFrame([("%04d-%02d" % (y, m + 1), y, m + 1, h[i][m]) for i, y in enumerate(years) for m in range(12)], columns=["month", "year", "mon", "value"])
    rows = []
    for _, r in t.iterrows():
        ref = t[(t["mon"] == r["mon"]) & (t["year"] != r["year"])]["value"].dropna()
        if pd.isna(r["value"]) or len(ref) == 0:
            rows.append({"region_id": rid, "month": r["month"], "value": r["value"], "median_ref": np.nan, "mean_ref": np.nan, "pct_vs_median": np.nan, "robust_z": np.nan, "n_ref": len(ref), "status": "insufficient"})
            continue
        med = ref.median()
        lref = np.log(ref + 0.5)
        lmad = max(1.4826 * (lref - lref.median()).abs().median(), 0.15)
        rows.append({"region_id": rid, "month": r["month"], "value": r["value"], "median_ref": med, "mean_ref": ref.mean(), "pct_vs_median": (r["value"] / med - 1) * 100 if med > 0 else np.nan,
                     "robust_z": (np.log(r["value"] + 0.5) - lref.median()) / lmad, "n_ref": len(ref), "status": "ok" if len(ref) >= 8 else "indicative"})
    return pd.DataFrame(rows)


def main() -> None:
    """Harmonise every region that has region_month.csv."""
    ap = argparse.ArgumentParser()
    ap.add_argument("--regions", nargs="*")
    args = ap.parse_args()
    for region in load_regions(args.regions):
        harmonise_region(region)


if __name__ == "__main__":
    main()
