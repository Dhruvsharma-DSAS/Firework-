"""Step 9 — whole-Earth monthly fire calendar per country, computed inside Google Earth Engine.

python s09_global_calendar_ee.py submit --products modis viirs --years 2000 2026
python s09_global_calendar_ee.py status
python s09_global_calendar_ee.py collect          # reads finished tables into data/processed/global/

Why Earth Engine: the FIRMS yearly country archive is ~6.6 GB to download. The NASA daily fire-mask
products (MOD14A1, MYD14A1, VNP14A1) are already in Earth Engine, so the counting runs on Google's
servers and only the per-country monthly totals come back (a few kB per month).

Per day and per 0.1° cell (EPSG:4326, transform [0.1, 0, -180, 0, -0.1, 90], the F03 grid):
  fire  = 1 if any 1 km pixel in the cell has FireMask ∈ {8, 9} (nominal or high confidence fire)   F05
  valid = share of 1 km pixels with a valid observation, FireMask ∈ {3, 5, 7, 8, 9}                  F09
MODIS = Terra (MOD14A1) and Aqua (MYD14A1) together: a cell-day counts if either satellite saw fire,
and valid is the larger of the two shares. VIIRS = Suomi NPP (VNP14A1, 1 km daily, from 2012-01-19).
Monthly sums per country (USDOS LSIB 2017, Antarctica excluded, 60°S–84°N):
  fire_cell_days   sum over days of fire cells             (unit: fire cell-days)
  valid_cell_days  sum over days of valid shares           (unit: cell-day equivalents of clear view)
  days             number of days the product delivered that month (a month with fewer days is partial)
Provenance: OFFICIAL products, counted by project code → SOURCE-DERIVED.
"""
import argparse
import calendar
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import ee
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "processed" / "global"
STATE = OUT / "ee_tasks.json"
T = [0.1, 0, -180, 0, -0.1, 90]
VALID = [3, 5, 7, 8, 9]
TILE = 4
PRODUCTS = {
    "modis": {"collections": ["MODIS/061/MOD14A1", "MODIS/061/MYD14A1"], "start": "2000-02-24", "kind": "mask"},
    "viirs": {"collections": ["NASA/VIIRS/002/VNP14A1"], "start": "2012-01-19", "kind": "mask"},
    "modis_nrt": {"collections": ["FIRMS"], "after": "modis", "kind": "firms"},
    "viirs_nrt": {"collections": ["NASA/LANCE/NOAA20_VIIRS/C2"], "after": "viirs", "kind": "lance"},
}


def archive_end(product: str) -> str:
    """Day after the last image of an archive product: where its near-real-time companion starts."""
    last = None
    for c in PRODUCTS[product]["collections"]:
        t = ee.ImageCollection(c).aggregate_max("system:time_start").getInfo()
        if last is None or t < last:
            last = t
    return datetime.fromtimestamp(last / 1000 + 86400, timezone.utc).strftime("%Y-%m-%d")


def product_start(product: str) -> str:
    if "start" in PRODUCTS[product]:
        return PRODUCTS[product]["start"]
    if "start_cache" not in PRODUCTS[product]:
        PRODUCTS[product]["start_cache"] = archive_end(PRODUCTS[product]["after"])
    return PRODUCTS[product]["start_cache"]


def env(name: str) -> str:
    import os
    if os.environ.get(name):
        return os.environ[name]
    path = ROOT / "backend" / ".env"
    if not path.exists():
        return ""
    for line in open(path, encoding="utf-8"):
        if line.startswith(name + "="):
            return line.split("=", 1)[1].strip()
    return ""


def init() -> str:
    project = env("GEE_PROJECT") or env("EE_PROJECT")
    ee.Initialize(project=project)
    return project


def countries() -> ee.FeatureCollection:
    fc = ee.FeatureCollection("USDOS/LSIB_SIMPLE/2017").filter(ee.Filter.neq("country_na", "Antarctica"))
    return fc.select(["country_na", "country_co"])


def prep_nrt(im: ee.Image, kind: str) -> ee.Image:
    """Near-real-time days: FIRMS MODIS raster (confidence ≥ 30, the FIRMS rule) or NOAA-20 LANCE (confidence class ≥ 1). No valid-view mask exists, so valid is left empty."""
    grid = ee.Projection("EPSG:4326", T)
    if kind == "firms":
        fire = im.select("confidence").gte(30)
    else:
        fire = im.select("confidence").gte(1)
    return fire.unmask(0).rename("fire").reduceResolution(ee.Reducer.max(), maxPixels=4096).reproject(grid)


def prep(im: ee.Image) -> ee.Image:
    grid = ee.Projection("EPSG:4326", T)
    fm = im.select("FireMask")
    fire = fm.gte(8).rename("fire").reduceResolution(ee.Reducer.max(), maxPixels=1024).reproject(grid)
    valid = fm.remap(VALID, [1] * len(VALID), 0).rename("valid").reduceResolution(ee.Reducer.mean(), maxPixels=1024).reproject(grid)
    return fire.addBands(valid)


def month_image(product: str, start: str, end: str):
    cols = [ee.ImageCollection(c).filterDate(start, end) for c in PRODUCTS[product]["collections"]]
    first = cols[0]
    n = (datetime.fromisoformat(end) - datetime.fromisoformat(start)).days
    days = ee.List.sequence(0, n - 1)

    def one_day(i):
        d0 = ee.Date(start).advance(i, "day")
        d1 = d0.advance(1, "day")
        merged = cols[0].filterDate(d0, d1)
        for c in cols[1:]:
            merged = merged.merge(c.filterDate(d0, d1))
        kind = PRODUCTS[product]["kind"]
        if kind == "mask":
            return ee.Algorithms.If(merged.size().gt(0), merged.map(prep).max().set("has", 1), None)
        return ee.Algorithms.If(merged.size().gt(0), merged.map(lambda im: prep_nrt(im, kind)).max().set("has", 1), None)

    daily = ee.ImageCollection(days.map(one_day, True))
    return daily.sum(), first.size()


def year_table(product: str, year: int) -> ee.FeatureCollection:
    fc = countries()
    parts = []
    first_day = product_start(product)
    for m in range(1, 13):
        start = "%d-%02d-01" % (year, m)
        end = "%d-%02d-01" % (year + (m == 12), 1 if m == 12 else m + 1)
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        if end <= first_day or start >= today:
            continue
        if end > today:
            end = today
        if start < first_day:
            start = first_day
        img, ndays = month_image(product, start, end)
        table = img.reduceRegions(collection=fc, reducer=ee.Reducer.sum(), crs="EPSG:4326", crsTransform=T, tileScale=TILE)
        parts.append(table.map(lambda f, m=m, nd=ndays: f.set({"year": year, "month": m, "product": product, "days": nd}).setGeometry(ee.Geometry.Point([0, 0]))))
    return ee.FeatureCollection(parts).flatten()


def load_state() -> dict:
    if STATE.exists():
        return json.loads(STATE.read_text())
    return {}


def save_state(state: dict) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(state, indent=1))


def submit(products, years) -> None:
    project = init()
    folder = "projects/%s/assets/firework_global" % project
    try:
        ee.data.createAsset({"type": "FOLDER"}, folder)
    except Exception:
        pass
    state = load_state()
    now_year = datetime.now(timezone.utc).year
    for p in products:
        y0 = int(product_start(p)[:4])
        for y in range(max(years[0], y0), min(years[1], now_year) + 1):
            key = "%s_%d" % (p, y)
            if key in state and state[key].get("state") in ("COMPLETED", "RUNNING", "READY") and y < now_year:
                continue
            asset = "%s/%s_%d" % (folder, p, y)
            try:
                ee.data.deleteAsset(asset)
            except Exception:
                pass
            task = ee.batch.Export.table.toAsset(collection=year_table(p, y), description="fw_" + key, assetId=asset)
            task.start()
            state[key] = {"id": task.id, "asset": asset, "state": "READY", "submitted": datetime.now(timezone.utc).isoformat()}
            print("submitted", key, task.id)
            save_state(state)


def status() -> dict:
    init()
    state = load_state()
    ops = {t["id"]: t for t in ee.data.getTaskList()}
    for key, s in state.items():
        t = ops.get(s["id"])
        if t:
            s["state"] = t["state"]
            if t.get("error_message"):
                s["error"] = t["error_message"]
    save_state(state)
    counts = {}
    for s in state.values():
        counts[s["state"]] = counts.get(s["state"], 0) + 1
    print(counts)
    for key, s in sorted(state.items()):
        if s["state"] == "FAILED":
            print("FAILED", key, s.get("error", "")[:200])
    return state


def collect() -> None:
    state = status()
    rows = []
    for key, s in sorted(state.items()):
        if s["state"] != "COMPLETED":
            continue
        fc = ee.FeatureCollection(s["asset"])
        feats = fc.getInfo()["features"]
        for f in feats:
            p = f["properties"]
            rows.append({"product": p["product"], "valid_known": p.get("valid") is not None, "year": int(p["year"]), "month": int(p["month"]), "iso2": p.get("country_co") or "", "country": p.get("country_na") or "", "fire_cell_days": round(p.get("fire") or 0, 3), "valid_cell_days": round(p.get("valid") or 0, 2), "days": int(p.get("days") or 0), "asset": s["asset"]})
        print("collected", key, len(feats))
    df = pd.DataFrame(rows).sort_values(["product", "country", "year", "month"])
    OUT.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUT / "country_monthly_ee.csv", index=False)
    print("wrote", OUT / "country_monthly_ee.csv", len(df))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["submit", "status", "collect"])
    ap.add_argument("--products", nargs="+", default=["modis", "viirs"])
    ap.add_argument("--years", nargs=2, type=int, default=[2000, 2026])
    ap.add_argument("--tile", type=int, default=0)
    a = ap.parse_args()
    if a.cmd == "submit" and a.tile:
        TILE = a.tile
    if a.cmd == "submit":
        submit(a.products, a.years)
    elif a.cmd == "status":
        status()
    else:
        collect()
