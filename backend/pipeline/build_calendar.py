"""Build a real month x year fire calendar for one region from the NASA FIRMS standard-processing archive.

Run from backend/:  .venv/bin/python -m pipeline.build_calendar --region punjab_haryana --months 10,11

Steps (formula IDs from docs/spec/formula_registry):
  1. Download FIRMS Area API CSVs in 5-day chunks (the API accepts DAY_RANGE 1-5), cached under data/raw/firms/.
  2. Keep sensor-native confidence rule F07: MODIS confidence >= 30, VIIRS nominal/high. Drop FIRMS type 1 (volcano) and 3 (offshore).
  3. Local solar time F01 and local solar date; grid cell F03 (0.1 deg, rounded floor); keep only cells of the region (region_cell.csv).
  4. Fire cell-days F05/F06: one per (cell, local day, platform, day/night); monthly counts per platform and per sensor family.
  5. Baseline exchange rate k per month (F11 median of yearly ratios S-NPP / MODIS in the overlap years) with a year-block
     bootstrap 95% interval (F24). No exposure correction yet (F09 needs Earth Engine), so it is labelled baseline B1.
Months that were not processed stay null, never 0.
"""
import argparse
import csv
import io
import json
import math
import os
import random
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / "backend" / ".env")
RAW_DIR = ROOT / "data" / "raw" / "firms"
OUT_DIR = ROOT / "data" / "processed"
CSV_DIR = ROOT / "data" / "supabase" / "csv"
BASE = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"
STATUS_URL = "https://firms.modaps.eosdis.nasa.gov/mapserver/mapkey_status/?MAP_KEY="
CHUNK_DAYS = 5
GRID = 0.1

SOURCES = {
    "MODIS_SP": {"family": "MODIS", "first_year": 2003, "first_date": date(2000, 11, 1)},
    "VIIRS_SNPP_SP": {"family": "VIIRS", "first_year": 2012, "first_date": date(2012, 1, 20)},
    "VIIRS_NOAA20_SP": {"family": "VIIRS", "first_year": 2018, "first_date": date(2018, 4, 1)},
}

_lock = threading.Lock()
_last_call = [0.0]


def log(text: str) -> None:
    """Print with a timestamp so the background log shows progress."""
    print(datetime.now().strftime("%H:%M:%S") + " " + text, flush=True)


def transactions_used(map_key: str) -> int:
    """Current FIRMS transactions in the 10-minute window (limit 5000)."""
    try:
        return int(httpx.get(STATUS_URL + map_key, timeout=30).json().get("current_transactions", 0))
    except Exception:
        return 0


def pace(min_gap: float) -> None:
    """Global rate limit across threads: at most one request every min_gap seconds."""
    with _lock:
        wait = _last_call[0] + min_gap - time.time()
        if wait > 0:
            time.sleep(wait)
        _last_call[0] = time.time()


def fetch_chunk(map_key: str, source: str, bbox: str, start: date, min_gap: float) -> str:
    """F: one cached 5-day FIRMS request; returns CSV text (header only when no detections)."""
    folder = RAW_DIR / source / bbox.replace(",", "_")
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / (start.isoformat() + "_" + str(CHUNK_DAYS) + ".csv")
    if path.exists():
        return path.read_text(encoding="utf-8")
    url = BASE + "/" + map_key + "/" + source + "/" + bbox + "/" + str(CHUNK_DAYS) + "/" + start.isoformat()
    last_error = None
    for attempt in range(4):
        pace(min_gap)
        try:
            response = httpx.get(url, timeout=120)
            text = response.text
            if response.status_code == 200 and not text.startswith("Invalid") and not text.startswith("<"):
                path.write_text(text, encoding="utf-8")
                return text
            last_error = str(response.status_code) + " " + text[:120]
        except httpx.HTTPError as error:
            last_error = str(error)
        time.sleep(5 * (attempt + 1))
    raise RuntimeError("FIRMS failed " + source + " " + start.isoformat() + ": " + str(last_error))


def chunk_starts(year: int, month: int, first_date: date) -> list:
    """5-day chunk start dates that cover one calendar month (local days near month edges included)."""
    first = date(year, month, 1) - timedelta(days=1)
    if month == 12:
        last = date(year, 12, 31) + timedelta(days=1)
    else:
        last = date(year, month + 1, 1)
    starts = []
    d = first
    while d <= last:
        if d + timedelta(days=CHUNK_DAYS - 1) >= first_date:
            starts.append(d)
        d = d + timedelta(days=CHUNK_DAYS)
    return starts


def cell_id(lat: float, lon: float) -> str:
    """F03: 0.1 deg cell index, rounding before floor (avoids edge misassignment)."""
    row = math.floor(round((lat + 90.0) / GRID, 9))
    lon_w = ((lon + 180.0) % 360.0) - 180.0
    col = math.floor(round((lon_w + 180.0) / GRID, 9))
    return str(min(row, 1799)) + "_" + str(min(col, 3599))


def local_date(acq_date: str, acq_time: str, lon: float) -> date:
    """F01: local solar date from UTC date + (UTC hour + lon/15)."""
    hhmm = str(acq_time).zfill(4)
    hours = int(hhmm[:2]) + int(hhmm[2:]) / 60.0 + lon / 15.0
    return date.fromisoformat(acq_date) + timedelta(days=math.floor(hours / 24.0))


def passes_rule(source: str, row: dict) -> bool:
    """F07 sensor-native confidence rule + FIRMS type filter."""
    if str(row.get("type", "0")).strip() in ["1", "3"]:
        return False
    conf = str(row.get("confidence", "")).strip().lower()
    if source.startswith("MODIS"):
        try:
            return float(conf) >= 30
        except ValueError:
            return False
    return conf in ["n", "h", "nominal", "high"]


def platform_of(source: str, row: dict) -> str:
    if source == "VIIRS_SNPP_SP":
        return "snpp"
    if source == "VIIRS_NOAA20_SP":
        return "noaa20"
    sat = str(row.get("satellite", "")).strip().lower()
    if sat in ["a", "aqua"]:
        return "aqua"
    return "terra"


def read_region(region_id: str):
    """Region bbox from region.csv and its cell set from region_cell.csv (cells with any share inside)."""
    bbox = None
    name = region_id
    with open(CSV_DIR / "region.csv", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            if row["region_id"] == region_id:
                bbox = ",".join(str(round(float(row[k]), 4)) for k in ["bbox_west", "bbox_south", "bbox_east", "bbox_north"])
                name = row["name"]
    if bbox is None:
        raise SystemExit("unknown region " + region_id + " (see data/supabase/csv/region.csv)")
    cells = {}
    with open(CSV_DIR / "region_cell.csv", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            if row["region_id"] == region_id:
                cells[row["cell_id"]] = float(row["coverage_fraction"])
    return bbox, name, cells


def median(values: list):
    s = sorted(values)
    if not s:
        return None
    m = len(s) // 2
    if len(s) % 2:
        return s[m]
    return (s[m - 1] + s[m]) / 2.0


def baseline_k(viirs_by_year: dict, modis_by_year: dict, reps: int = 2000, alpha: float = 0.05):
    """F11 median of yearly ratios V/M over overlap years with M > 0, and F24 year-block bootstrap interval (explicit alpha)."""
    years = sorted(y for y in viirs_by_year if y in modis_by_year and modis_by_year[y] and viirs_by_year[y] is not None)
    ratios = [viirs_by_year[y] / modis_by_year[y] for y in years]
    if len(ratios) < 3:
        return None
    rng = random.Random(0)
    boots = []
    for _ in range(reps):
        sample = [ratios[rng.randrange(len(ratios))] for _ in ratios]
        boots.append(median(sample))
    boots.sort()
    lo = boots[int(math.floor(alpha / 2 * reps))]
    hi = boots[int(math.ceil((1 - alpha / 2) * reps)) - 1]
    return {"k": round(median(ratios), 3), "lo": round(lo, 3), "hi": round(hi, 3), "level": 1 - alpha, "n_years": len(ratios), "years": [years[0], years[-1]]}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--region", default="punjab_haryana")
    parser.add_argument("--months", default="10,11", help="comma list, e.g. 10,11 or 1-12")
    parser.add_argument("--year-to", type=int, default=2025)
    parser.add_argument("--workers", type=int, default=3)
    parser.add_argument("--max-tx", type=int, default=3800, help="pause when the 10-minute FIRMS transaction count is above this")
    args = parser.parse_args()

    map_key = os.environ.get("FIRMS_MAP_KEY", "")
    if not map_key:
        raise SystemExit("FIRMS_MAP_KEY missing in backend/.env")
    if "-" in args.months:
        a, b = args.months.split("-")
        months = list(range(int(a), int(b) + 1))
    else:
        months = [int(m) for m in args.months.split(",")]

    bbox, region_name, cells = read_region(args.region)
    log("region " + args.region + " bbox " + bbox + " cells " + str(len(cells)) + " months " + str(months))

    jobs = []
    for source, spec in SOURCES.items():
        for year in range(spec["first_year"], args.year_to + 1):
            for month in months:
                for start in chunk_starts(year, month, spec["first_date"]):
                    jobs.append((source, start))
    jobs = sorted(set(jobs))
    log("chunks to read: " + str(len(jobs)))

    texts = {}
    done = [0]

    def run(job):
        source, start = job
        if done[0] % 40 == 0:
            used = transactions_used(map_key)
            while used > args.max_tx:
                log("FIRMS transactions " + str(used) + " > " + str(args.max_tx) + ", waiting 60 s")
                time.sleep(60)
                used = transactions_used(map_key)
        text = fetch_chunk(map_key, source, bbox, start, 1.6)
        with _lock:
            texts[job] = text
            done[0] = done[0] + 1
            if done[0] % 25 == 0 or done[0] == len(jobs):
                log("read " + str(done[0]) + "/" + str(len(jobs)))

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        list(pool.map(run, jobs))

    celldays = set()
    kept = 0
    dropped = 0
    raw_rows = 0
    for (source, start), text in texts.items():
        for row in csv.DictReader(io.StringIO(text)):
            raw_rows = raw_rows + 1
            try:
                lat = float(row["latitude"])
                lon = float(row["longitude"])
            except (KeyError, ValueError):
                continue
            if not passes_rule(source, row):
                dropped = dropped + 1
                continue
            cid = cell_id(lat, lon)
            if cid not in cells:
                continue
            ld = local_date(row["acq_date"], row["acq_time"], lon)
            if ld.month not in months:
                continue
            kept = kept + 1
            celldays.add((cid, ld.isoformat(), platform_of(source, row), str(row.get("daynight", "")).strip()))

    years = list(range(SOURCES["MODIS_SP"]["first_year"], args.year_to + 1))
    platforms = ["terra", "aqua", "snpp", "noaa20"]
    per_platform = {p: [[None] * 12 for _ in years] for p in platforms}
    modis = [[None] * 12 for _ in years]
    viirs = [[None] * 12 for _ in years]
    night_modis = [[None] * 12 for _ in years]
    night_viirs = [[None] * 12 for _ in years]
    family_days = {}
    for (cid, ld, platform, dn) in celldays:
        y = int(ld[:4])
        m = int(ld[5:7])
        family = "MODIS"
        if platform in ["snpp", "noaa20"]:
            family = "VIIRS"
        family_days.setdefault((family, platform, y, m), set()).add((cid, ld, dn))

    for yi, y in enumerate(years):
        for m in months:
            mi = m - 1
            for p in platforms:
                first = SOURCES["MODIS_SP"]["first_year"]
                if p == "snpp":
                    first = 2012
                if p == "noaa20":
                    first = 2018
                if y >= first:
                    fam = "VIIRS"
                    if p in ["terra", "aqua"]:
                        fam = "MODIS"
                    per_platform[p][yi][mi] = len(family_days.get((fam, p, y, m), set()))
            modis_cd = set()
            for p in ["terra", "aqua"]:
                modis_cd |= {(c, d) for (c, d, dn) in family_days.get(("MODIS", p, y, m), set())}
            modis[yi][mi] = len(modis_cd)
            night_modis[yi][mi] = len({(c, d) for p in ["terra", "aqua"] for (c, d, dn) in family_days.get(("MODIS", p, y, m), set()) if dn == "N"})
            if y >= 2012:
                snpp = family_days.get(("VIIRS", "snpp", y, m), set())
                viirs[yi][mi] = len({(c, d) for (c, d, dn) in snpp})
                night_viirs[yi][mi] = len({(c, d) for (c, d, dn) in snpp if dn == "N"})

    k_by_month = {}
    for m in months:
        mi = m - 1
        v_by_year = {y: viirs[yi][mi] for yi, y in enumerate(years) if y >= 2012 and viirs[yi][mi] is not None}
        m_by_year = {y: modis[yi][mi] for yi, y in enumerate(years) if y >= 2012 and modis[yi][mi] is not None}
        k_by_month[str(m)] = baseline_k(v_by_year, m_by_year)

    out = {
        "data": {
            "region": args.region,
            "region_name": region_name,
            "years": years,
            "months_processed": months,
            "modis": modis,
            "viirs": viirs,
            "night_modis": night_modis,
            "night_viirs": night_viirs,
            "platforms": per_platform,
            "exposure_modis": [[None] * 12 for _ in years],
            "exposure_viirs": [[None] * 12 for _ in years],
            "k_baseline": k_by_month,
            "cells_in_region": len(cells),
        },
        "meta": {
            "data_source": "NASA FIRMS Area API standard processing (MODIS_SP, VIIRS_SNPP_SP, VIIRS_NOAA20_SP)",
            "provider": "NASA FIRMS",
            "status": "ARCHIVE_STANDARD",
            "provenance": "SOURCE_DERIVED",
            "demo": False,
            "fallback_used": False,
            "unit": "fire cell-days (0.1 deg cell x local solar day)",
            "bbox": bbox,
            "rule": "MODIS confidence >= 30, VIIRS nominal/high; FIRMS type 1 and 3 removed (F07)",
            "viirs_series": "Suomi NPP only (NOAA-20 kept separately in platforms to avoid the 2018 seam)",
            "modis_series": "Terra + Aqua union per cell-day",
            "k_method": "baseline B1: F11 median of yearly S-NPP/MODIS cell-day ratios in 2012-" + str(args.year_to) + ", F24 year bootstrap, alpha 0.05. No exposure correction yet (F09 needs Earth Engine).",
            "k_provenance": "RUN_TESTED_LOCALLY",
            "exposure": "PENDING (Earth Engine FireMask, F09)",
            "rows_downloaded": raw_rows,
            "rows_dropped_by_rule": dropped,
            "detections_in_region_kept": kept,
            "chunks": len(jobs),
            "generated_at_utc": datetime.now(timezone.utc).isoformat(),
            "warnings": ["Fire cell-days are detections, not fires or burned area.", "Months not processed are null."],
            "citation_urls": ["https://firms.modaps.eosdis.nasa.gov/api/area/"],
        },
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / ("calendar_" + args.region + ".json")
    path.write_text(json.dumps(out), encoding="utf-8")
    log("wrote " + str(path) + " · cell-days " + str(len(celldays)) + " · k " + json.dumps(k_by_month))


if __name__ == "__main__":
    main()
