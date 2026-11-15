"""Step 3 — Earth Engine: per 0.1° cell × month, everything that is not a hot spot.

python s03_gee_monthly.py --regions punjab_haryana --start 2001-01 --end 2025-12
python s03_gee_monthly.py --static --regions punjab_haryana        # land cover once

Needs: GEE_PROJECT in .env and `earthengine authenticate` once on this machine (or run in Google Colab).

Columns written per cell-month (null when the product does not cover that month):
  valid_terra, cloud_terra   MOD14A1 FireMask: valid = {3,5,7,8,9}, cloud = 4   (days, mean over the cell)
  valid_aqua,  cloud_aqua    MYD14A1, same rule
  valid_viirs, cloud_viirs   VNP14A1 (1 km daily, S-NPP), same rule; from 2012-01-19
  firepix_terra/aqua/viirs   FireMask ≥ 7 pixel-days (mean over the cell) — cross-check with FIRMS
  burned_frac                MCD64A1 BurnDate > 0, share of the cell burned that month
  t2m_max_c, t2m_mean_c      ERA5-Land daily aggregates, monthly mean (°C)
  precip_mm                  ERA5-Land, monthly total
  wind_ms                    ERA5-Land 10 m wind speed, monthly mean of daily means
  rh_pct, vpd_kpa            from daily mean T and dew point (Magnus), monthly mean
  ndvi                       MOD13A3 monthly NDVI
Static (--static): ESA WorldCover v200 shares: tree, shrub, grass, crop, built, bare, water, wetland.
Output: data/raw/gee/<region>/monthly_<YYYY>.csv and data/raw/gee/<region>/static_landcover.csv
"""
import argparse
import calendar
from pathlib import Path

import ee
import pandas as pd

from lib.common import RAW_DIR, cells_in_bbox, env, load_regions

VALID = [3, 5, 7, 8, 9]
CHUNK = 3500


def grid_fc(cells: pd.DataFrame, half: float = 0.05) -> ee.FeatureCollection:
    """0.1° cells as rectangles with a cell_id property."""
    feats = [ee.Feature(ee.Geometry.Rectangle([lo - half, la - half, lo + half, la + half], None, False), {"cell_id": int(c)}) for la, lo, c in cells[["lat", "lon", "cell_id"]].values]
    return ee.FeatureCollection(feats)


def firemask_month(collection: str, start: str, end: str, name: str) -> ee.Image:
    """Per-pixel counts over the month: valid days (FireMask ∈ {3,5,7,8,9}), cloud days (= 4), fire days (≥ 7)."""
    col = ee.ImageCollection(collection).filterDate(start, end).select("FireMask")
    valid = col.map(lambda im: im.remap(VALID, [1] * len(VALID), 0)).sum().rename("valid_" + name)
    cloud = col.map(lambda im: im.eq(4)).sum().rename("cloud_" + name)
    fire = col.map(lambda im: im.gte(7)).sum().rename("firepix_" + name)
    return valid.addBands(cloud).addBands(fire)


def era5_month(start: str, end: str) -> ee.Image:
    """ERA5-Land daily aggregates → monthly t2m max/mean (°C), precip (mm), wind (m/s), RH (%), VPD (kPa)."""
    col = ee.ImageCollection("ECMWF/ERA5_LAND/DAILY_AGGR").filterDate(start, end)

    def daily(im):
        t = im.select("temperature_2m").subtract(273.15)
        td = im.select("dewpoint_temperature_2m").subtract(273.15)
        es = t.multiply(17.27).divide(t.add(237.3)).exp().multiply(0.6108)
        ea = td.multiply(17.27).divide(td.add(237.3)).exp().multiply(0.6108)
        rh = ea.divide(es).multiply(100).rename("rh_pct")
        vpd = es.subtract(ea).rename("vpd_kpa")
        wind = im.select("u_component_of_wind_10m").hypot(im.select("v_component_of_wind_10m")).rename("wind_ms")
        tmax = im.select("temperature_2m_max").subtract(273.15).rename("t2m_max_c")
        tmean = t.rename("t2m_mean_c")
        pr = im.select("total_precipitation_sum").multiply(1000).rename("precip_mm")
        return tmax.addBands([tmean, pr, wind, rh, vpd])

    days = col.map(daily)
    means = days.select(["t2m_max_c", "t2m_mean_c", "wind_ms", "rh_pct", "vpd_kpa"]).mean()
    total = days.select("precip_mm").sum()
    return means.addBands(total)


def has(collection: str, start, end) -> bool:
    """True when the product has at least one image in the window (else its bands stay absent → null, never 0)."""
    return ee.ImageCollection(collection).filterDate(start, end).size().getInfo() > 0


def month_image(year: int, month: int) -> ee.Image:
    """All monthly bands stacked; products that do not cover the month are left out, so their columns are null."""
    last = calendar.monthrange(year, month)[1]
    start = "%04d-%02d-01" % (year, month)
    end = ee.Date(start).advance(1, "month")
    bands = []
    for coll, name in [("MODIS/061/MOD14A1", "terra"), ("MODIS/061/MYD14A1", "aqua"), ("NASA/VIIRS/002/VNP14A1", "viirs")]:
        if has(coll, start, end):
            bands.append(firemask_month(coll, start, end, name))
    if has("MODIS/061/MCD64A1", start, end):
        bands.append(ee.ImageCollection("MODIS/061/MCD64A1").filterDate(start, end).select("BurnDate").max().gt(0).unmask(0).rename("burned_frac"))
    if has("MODIS/061/MOD13A3", start, end):
        bands.append(ee.ImageCollection("MODIS/061/MOD13A3").filterDate(start, end).select("NDVI").mean().multiply(0.0001).rename("ndvi"))
    if has("ECMWF/ERA5_LAND/DAILY_AGGR", start, end):
        bands.append(era5_month(start, end))
    if not bands:
        return None
    return ee.Image.cat(bands).set("days_in_month", last)


def reduce_month(img: ee.Image, fc: ee.FeatureCollection) -> pd.DataFrame:
    """Mean of every band over each cell at 1 km scale."""
    out = img.reduceRegions(collection=fc, reducer=ee.Reducer.mean(), scale=1000, tileScale=4).getInfo()
    return pd.DataFrame([f["properties"] for f in out["features"]])


def static_landcover(fc: ee.FeatureCollection) -> pd.DataFrame:
    """ESA WorldCover v200 (2021) class shares per cell."""
    wc = ee.ImageCollection("ESA/WorldCover/v200").first().select("Map")
    classes = {"tree": 10, "shrub": 20, "grass": 30, "crop": 40, "built": 50, "bare": 60, "water": 80, "wetland": 90}
    img = ee.Image.cat([wc.eq(v).rename("share_" + k) for k, v in classes.items()])
    out = img.reduceRegions(collection=fc, reducer=ee.Reducer.mean(), scale=100, tileScale=4).getInfo()
    return pd.DataFrame([f["properties"] for f in out["features"]])


def main() -> None:
    """Loop regions × months; resumable (skips years whose file exists unless --force)."""
    ap = argparse.ArgumentParser()
    ap.add_argument("--regions", nargs="*")
    ap.add_argument("--start", default="2000-11")
    ap.add_argument("--end", default=None)
    ap.add_argument("--static", action="store_true")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    ee.Initialize(project=env("GEE_PROJECT", required=True))
    end = args.end or pd.Timestamp.today().strftime("%Y-%m")
    for region in load_regions(args.regions):
        cells = cells_in_bbox(region["bbox"])
        chunks = [cells.iloc[i:i + CHUNK] for i in range(0, len(cells), CHUNK)]
        folder = RAW_DIR / "gee" / region["id"]
        folder.mkdir(parents=True, exist_ok=True)
        print(region["id"], len(cells), "cells in", len(chunks), "chunks")
        if args.static:
            parts = [static_landcover(grid_fc(c)) for c in chunks]
            pd.concat(parts).to_csv(folder / "static_landcover.csv", index=False)
            continue
        months = pd.period_range(args.start, end, freq="M")
        for year in sorted(set(m.year for m in months)):
            path = folder / ("monthly_%d.csv" % year)
            if path.exists() and not args.force:
                continue
            rows = []
            for m in [m for m in months if m.year == year]:
                img = month_image(m.year, m.month)
                if img is None:
                    continue
                for c in chunks:
                    df = reduce_month(img, grid_fc(c))
                    df["month"] = str(m)
                    rows.append(df)
                print("  ", region["id"], m)
            pd.concat(rows).to_csv(path, index=False)


if __name__ == "__main__":
    main()
