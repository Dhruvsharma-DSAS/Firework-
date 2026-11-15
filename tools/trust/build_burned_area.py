"""Independent check (test T2): yearly burned area per country from MODIS MCD64A1 (500 m burned-area product, a
different algorithm from the active-fire hot spots), summed in Earth Engine per USDOS LSIB country, joined to the
calendar's ISO3 regions with the same name + alias join as build_exposure.py.
Writes data/processed/global/burned_area_countries.json; then rerun tools/trust/build_trust.py.
Run from the repo root: backend/.venv/bin/python tools/trust/build_burned_area.py [first_year last_year]"""
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import ee

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_exposure import ALIAS, norm

GLOBAL = ROOT / "data" / "processed" / "global"
OUT = GLOBAL / "burned_area_countries.json"
PROJECT = os.environ.get("EE_PROJECT", "gmp-demo-project-793150412")
SCALE = "1 km"


def year_table(year: int, countries) -> list:
    burned = ee.ImageCollection("MODIS/061/MCD64A1").filterDate(str(year) + "-01-01", str(year + 1) + "-01-01").select("BurnDate").max().gt(0).clip(ee.Geometry.Rectangle([-179.99, -89.99, 179.99, 89.99], None, False))
    km2 = burned.selfMask().multiply(ee.Image.pixelArea()).divide(1e6).rename("km2")
    fc = km2.reduceRegions(collection=countries, reducer=ee.Reducer.sum(), scale=1000, tileScale=8)
    return fc.select(["country_co", "country_na", "sum"], None, False).getInfo()["features"]


def main() -> None:
    first, last = 2001, 2025
    if len(sys.argv) == 3:
        first, last = int(sys.argv[1]), int(sys.argv[2])
    ee.Initialize(project=PROJECT)
    countries = ee.FeatureCollection("USDOS/LSIB_SIMPLE/2017").filter(ee.Filter.neq("country_co", "AY"))
    calendar = json.loads((GLOBAL / "calendar_global.json").read_text())
    prev = {"countries": {}, "by_code": {}}
    if OUT.exists():
        prev = json.loads(OUT.read_text())
    by_code = prev.get("by_code", {})
    names = prev.get("names", {})
    for year in range(first, last + 1):
        if all(str(year) in v for v in by_code.values()) and by_code:
            continue
        rows = year_table(year, countries)
        for f in rows:
            p = f["properties"]
            names[p["country_co"]] = p["country_na"]
            by_code.setdefault(p["country_co"], {})[str(year)] = round(p.get("sum") or 0.0, 1)
        print(year, len(rows), flush=True)
        OUT.write_text(json.dumps({"by_code": by_code, "names": names, "countries": prev.get("countries", {})}))
    by_name = {norm(n): c for c, n in names.items()}
    out = {}
    for rid, region in calendar["regions"].items():
        if not rid.startswith("c_"):
            continue
        codes = ALIAS.get(rid)
        if codes is None and norm(region.get("region_name")) in by_name:
            codes = [by_name[norm(region["region_name"])]]
        if not codes:
            continue
        series = {}
        for code in codes:
            for year, v in by_code.get(code, {}).items():
                series[year] = round(series.get(year, 0.0) + v, 1)
        if series:
            out[rid[2:].upper()] = series
    OUT.write_text(json.dumps({"meta": {"source": "MODIS/061/MCD64A1 BurnDate > 0, yearly max, summed per USDOS/LSIB_SIMPLE/2017 country in Earth Engine", "unit": "km² burned per year", "grid": SCALE, "generated_at_utc": datetime.now(timezone.utc).isoformat()}, "countries": out, "by_code": by_code, "names": names}))
    print("countries joined:", len(out))


if __name__ == "__main__":
    main()
