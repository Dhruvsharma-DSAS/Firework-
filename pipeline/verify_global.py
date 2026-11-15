"""Reality check for the whole-Earth calendar: recount sample countries from NASA FIRMS's own archive files
and compare with the Earth Engine values (two independent NASA products: FIRMS fire points vs daily fire masks).

python verify_global.py --countries Nepal Portugal --years 2015 2021

Downloads FIRMS yearly per-country CSVs (standard processing, a few MB each) into data/raw/firms_country/,
grids points to the same 0.1° cells (F03), counts cell-days per month (UTC day; MODIS confidence ≥ 30,
VIIRS confidence n/h; FIRMS type 0 only), and writes data/manifests/verify_global.json with per-month
values, ratio EE / FIRMS and Pearson r. Expect r near 1 and a ratio near 1 but not exactly 1: the products differ.
"""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import httpx
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "firms_country"
BASE = "https://firms.modaps.eosdis.nasa.gov/data/country"
FILES = {"modis": "modis", "viirs": "viirs-snpp"}


def fetch(product: str, year: int, country: str) -> Path:
    name = "%s_%d_%s.csv" % (product, year, country.replace(" ", "_"))
    out = RAW / product / str(year) / name
    if not out.exists():
        out.parent.mkdir(parents=True, exist_ok=True)
        r = httpx.get("%s/%s/%d/%s" % (BASE, product, year, name), timeout=300, follow_redirects=True)
        r.raise_for_status()
        out.write_bytes(r.content)
    return out


def cell_days(path: Path, sensor: str) -> pd.Series:
    d = pd.read_csv(path)
    if "type" in d.columns:
        d = d[d["type"] == 0]
    if sensor == "modis":
        d = d[pd.to_numeric(d["confidence"], errors="coerce") >= 30]
    else:
        d = d[d["confidence"].astype(str).str.lower().isin(["n", "h", "nominal", "high"])]
    i = np.floor((d["latitude"] + 90) / 0.1).astype(int)
    j = np.floor((d["longitude"] + 180) / 0.1).astype(int)
    d = d.assign(cell=i * 3600 + j, day=d["acq_date"])
    u = d.drop_duplicates(["cell", "day"])
    return u.groupby(pd.to_datetime(u["day"]).dt.month).size()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--countries", nargs="+", default=["Nepal", "Portugal"])
    ap.add_argument("--years", nargs="+", type=int, default=[2015, 2021])
    a = ap.parse_args()
    ee_tab = pd.read_csv(ROOT / "data" / "processed" / "global" / "country_monthly_ee.csv")
    report = {"generated_at_utc": datetime.now(timezone.utc).isoformat(), "checks": []}
    for country in a.countries:
        for year in a.years:
            for sensor, product in FILES.items():
                if sensor == "viirs" and year < 2012:
                    continue
                path = fetch(product, year, country)
                firms = cell_days(path, sensor)
                ee = ee_tab[(ee_tab["country"] == country) & (ee_tab["product"] == sensor) & (ee_tab["year"] == year)].set_index("month")["fire_cell_days"]
                months = sorted(set(firms.index) | set(ee.index))
                f = np.array([float(firms.get(m, 0)) for m in months])
                e = np.array([float(ee.get(m, 0)) for m in months])
                r = float(np.corrcoef(f, e)[0, 1]) if len(months) > 2 and f.std() > 0 and e.std() > 0 else None
                check = {"country": country, "year": year, "sensor": sensor, "firms_file": str(path.relative_to(ROOT)), "firms_sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "firms_cell_days": round(f.sum()), "ee_cell_days": round(e.sum()), "ratio_ee_over_firms": round(e.sum() / f.sum(), 3) if f.sum() else None, "pearson_r_monthly": None if r is None else round(r, 3), "monthly": {int(m): [int(fv), round(ev, 1)] for m, fv, ev in zip(months, f, e)}}
                report["checks"].append(check)
                print(country, year, sensor, "FIRMS", check["firms_cell_days"], "EE", check["ee_cell_days"], "ratio", check["ratio_ee_over_firms"], "r", check["pearson_r_monthly"])
    out = ROOT / "data" / "manifests" / "verify_global.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
