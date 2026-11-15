"""Step 12 — Fire Clock: measure whether burning is falling or moving to hours the satellites do not see.

python s12_fire_clock.py --region punjab_haryana --months 10,11

Idea: compare one instrument with itself at two times of day, so the sensor difference cancels.
  FC1 morning-to-afternoon ratio  MAR_y = T_y / A_y   (Terra MODIS ~10:30 day detections ÷ Aqua MODIS ~13:30 day detections)
  FC2 night share                 NS_y  = N_y / (D_y + N_y)   (VIIRS S-NPP ~01:30 night ÷ all S-NPP detections)
  95 % Wilson intervals on the underlying proportions T/(T+A) and N/(D+N).
  Reference = pooled 2012–2020 (both MODIS satellites and S-NPP flying, before the reported shift).
  Timing signal: NS_lo > 2 · NS_ref (VIIRS keeps its 01:30 / 13:30 orbit, so this signal is not drift-affected).
  Morning drop (supporting only): MAR_hi < 0.5 · MAR_ref — confounded by Terra drifting earlier and Aqua later after 2021.
  Count signal:  harmonised season cell-days ≤ 0.5 · reference median (2012–2020).
  Flag: HIDDEN_BURNING_LIKELY (count + timing) · LOW_ACTIVITY (count only) · TIMING_SHIFT (timing only) · NORMAL.
Static / volcano detections are excluded. Season months follow LMST local dates.
Provenance: SOURCE_DERIVED (NASA FIRMS standard-processing archive). Flags are diagnostics, never multipliers.
"""
import argparse
import csv
import json
import math
import statistics
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REF = (2012, 2020)


def wilson(x: int, n: int, z: float = 1.96) -> tuple:
    """Wilson score interval for a proportion x/n."""
    if n == 0:
        return (None, None, None)
    p = x / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (p, max(0.0, c - h), min(1.0, c + h))


def ratio_from_share(s):
    """Convert a share s = T/(T+A) into a ratio T/A."""
    if s is None or s >= 1:
        return None
    return s / (1 - s)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--region", default="punjab_haryana")
    ap.add_argument("--months", default="10,11")
    ap.add_argument("--last-full-year", type=int, default=2025)
    a = ap.parse_args()
    months = set("%02d" % int(m) for m in a.months.split(","))
    src = ROOT / "pipeline/data/processed" / a.region / "fire_detection.csv"
    cnt = Counter()
    lmst = defaultdict(list)
    static = 0
    with open(src) as f:
        for row in csv.DictReader(f):
            d = row["local_date"] or row["acq_date"]
            if d[5:7] not in months:
                continue
            if row["static_or_volcano"] == "True":
                static += 1
                continue
            y = int(d[:4])
            cnt[(y, row["platform"], row["daynight"])] += 1
            if row["daynight"] == "D" and row["platform"] in ("terra", "aqua") and row["lmst"]:
                lmst[(y, row["platform"])].append(float(row["lmst"]))
    cal = json.load(open(ROOT / "pipeline/data/processed" / a.region / ("calendar_" + a.region + ".json")))["data"]
    mi = [int(m) - 1 for m in sorted(months)]
    season = {}
    for i, y in enumerate(cal["years"]):
        vals = [cal["cell_days"]["harmonised"][i][j] for j in mi]
        if all(v is not None for v in vals):
            season[y] = sum(vals)
    ref_years = range(REF[0], REF[1] + 1)
    T = sum(cnt[(y, "terra", "D")] for y in ref_years)
    A = sum(cnt[(y, "aqua", "D")] for y in ref_years)
    D = sum(cnt[(y, "snpp", "D")] for y in ref_years)
    N = sum(cnt[(y, "snpp", "N")] for y in ref_years)
    mar_ref = T / A
    ns_ref = N / (D + N)
    season_ref = statistics.median([season[y] for y in ref_years if y in season])
    rows = []
    for y in range(2003, a.last_full_year + 1):
        t, ad = cnt[(y, "terra", "D")], cnt[(y, "aqua", "D")]
        sd, sn = cnt[(y, "snpp", "D")], cnt[(y, "snpp", "N")]
        s, slo, shi = wilson(t, t + ad)
        mar, mar_lo, mar_hi = ratio_from_share(s), ratio_from_share(slo), ratio_from_share(shi)
        ns, ns_lo, ns_hi = wilson(sn, sd + sn)
        timing = False
        morning_drop = mar_hi is not None and mar_hi < 0.5 * mar_ref
        if y >= 2012 and ns_lo is not None and ns_lo > 2 * ns_ref:
            timing = True
        count = y in season and season[y] <= 0.5 * season_ref
        flag = "NORMAL"
        if count and timing:
            flag = "HIDDEN_BURNING_LIKELY"
        elif count:
            flag = "LOW_ACTIVITY"
        elif timing:
            flag = "TIMING_SHIFT"
        def med(k):
            v = lmst.get((y, k))
            if not v:
                return None
            return round(statistics.median(v), 2)
        rows.append({
            "year": y, "terra_day": t, "aqua_day": ad, "snpp_day": sd, "snpp_night": sn,
            "noaa20_day": cnt[(y, "noaa20", "D")], "noaa20_night": cnt[(y, "noaa20", "N")],
            "mar": mar, "mar_lo": mar_lo, "mar_hi": mar_hi,
            "night_share": ns if y >= 2012 else None, "night_share_lo": ns_lo if y >= 2012 else None, "night_share_hi": ns_hi if y >= 2012 else None,
            "terra_lmst": med("terra"), "aqua_lmst": med("aqua"),
            "season_cell_days": season.get(y), "count_signal": count, "morning_drop": morning_drop, "timing_signal": timing, "flag": flag,
        })
    out = {
        "data": {"region": a.region, "months": sorted(int(m) for m in months), "reference_years": list(REF),
                 "mar_ref": mar_ref, "night_share_ref": ns_ref, "season_ref": season_ref, "rows": rows,
                 "static_excluded": static},
        "meta": {"status": "ARCHIVE_STANDARD", "provenance": "SOURCE_DERIVED", "demo": False,
                 "data_source": "NASA FIRMS standard-processing archive (MODIS C6.1 Terra + Aqua, VIIRS S-NPP / NOAA-20 375 m)",
                 "method": "FC1 morning-to-afternoon ratio and FC2 night share with 95 % Wilson intervals; reference pooled 2012-2020; flags are diagnostics",
                 "caveats": ["Terra crossing drifted earlier and Aqua later; median local solar times per year are reported",
                             "a flag means burning may be moving out of view; it does not measure how much burning was missed",
                             "geostationary (Meteosat IODC FRP-Pixel, INSAT-3DR) and burned-area checks are the next validation"],
                 "generated_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds")},
    }
    for p in (ROOT / "pipeline/data/processed" / a.region / ("fire_clock_" + a.region + ".json"),
              ROOT / "frontend/public/data" / ("fire_clock_" + a.region + ".json")):
        p.write_text(json.dumps(out, indent=1))
        print("wrote", p)
    print("MAR_ref", round(mar_ref, 4), "NS_ref", round(ns_ref, 5), "season_ref", round(season_ref))
    for r in rows:
        print(r["year"], r["terra_day"], r["aqua_day"], r["mar"] and round(r["mar"], 4), r["night_share"] and round(r["night_share"], 4), r["aqua_lmst"], r["terra_lmst"], r["season_cell_days"] and round(r["season_cell_days"]), r["flag"])


if __name__ == "__main__":
    main()
