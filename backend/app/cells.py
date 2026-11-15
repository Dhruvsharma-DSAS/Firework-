"""Fire cell tables for any area on Earth, computed on request from the NASA FIRMS Area API (no stored CSV needed).

Rules (same as pipeline/s05_build_tables.py, formula ids from docs/spec/formula_registry):
  F01 local solar time = UTC + lon / 15; local solar date shifts at local midnight.
  F03 0.1° cell id = floor(round((lat+90)/0.1, 9)) * 3600 + floor(round((lon+180)/0.1, 9)).
  F04 cell area = R² Δλ (sin φ2 − sin φ1), R = 6371.0088 km.
  F05 one cell-day = a (cell, local date, platform, day/night) with at least one confident detection.
  F07 confidence stays sensor-native: MODIS ≥ 30, VIIRS nominal or high; MODIS type 1/2/3 (volcano, static, offshore) left out.
Standard (SP) data is used where FIRMS has it, near-real-time (NRT) after that. Every raw 5-day chunk is cached untouched,
so repeated or overlapping requests are instant. A chunk that fails is reported in meta and its days are not counted as 0.
"""
import csv
import io
import math
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone

import httpx

from app import store
from app.firms import platform_of

BASE = "https://firms.modaps.eosdis.nasa.gov"
CHUNK_DAYS = 5
CELL_DEG = 0.1
NCOLS = 3600
NROWS = 1800
MAX_CHUNKS = 48
MAX_AREA_DEG2 = 2500.0
RECENT_CACHE_S = 1800
FAMILIES = {
    "MODIS": {"sp": "MODIS_SP", "nrt": "MODIS_NRT"},
    "VIIRS_SNPP": {"sp": "VIIRS_SNPP_SP", "nrt": "VIIRS_SNPP_NRT"},
    "VIIRS_NOAA20": {"sp": "VIIRS_NOAA20_SP", "nrt": "VIIRS_NOAA20_NRT"},
    "VIIRS_NOAA21": {"sp": "VIIRS_NOAA21_SP", "nrt": "VIIRS_NOAA21_NRT"},
}
_AVAIL = {"t": 0.0, "value": None}


class CellsError(Exception):
    """A request the API refuses (too large, bad input). The message says why."""


def availability(map_key: str) -> dict:
    """First and last date of every FIRMS source (FIRMS /api/data_availability), cached for 6 hours."""
    if _AVAIL["value"] is not None and time.time() - _AVAIL["t"] < 6 * 3600:
        return _AVAIL["value"]
    r = httpx.get(BASE + "/api/data_availability/csv/" + map_key + "/all", timeout=60)
    r.raise_for_status()
    out = {}
    for row in csv.reader(io.StringIO(r.text)):
        if len(row) >= 3 and row[0] != "data_id":
            out[row[0]] = (date.fromisoformat(row[1][:10]), date.fromisoformat(row[2][:10]))
    _AVAIL["value"] = out
    _AVAIL["t"] = time.time()
    return out


def plan(start: date, end: date, avail: dict) -> list:
    """5-day chunks per sensor family: SP where it covers the chunk, NRT after the SP end. Families not flying are skipped."""
    jobs = []
    for family, names in FAMILIES.items():
        sp = avail.get(names["sp"])
        nrt = avail.get(names["nrt"])
        d = start
        while d <= end:
            days = min(CHUNK_DAYS, (end - d).days + 1)
            last = d + timedelta(days=days - 1)
            source = None
            if sp and sp[0] <= last and d <= sp[1]:
                source = names["sp"]
            elif nrt and nrt[0] <= last and d <= nrt[1]:
                source = names["nrt"]
            if source:
                jobs.append({"family": family, "source": source, "start": d, "days": days})
            d = d + timedelta(days=CHUNK_DAYS)
    return jobs


def fetch_chunk(map_key: str, job: dict, bbox: list) -> dict:
    """One cached FIRMS Area request. Chunks that ended more than 3 days ago are final and never re-downloaded."""
    area = ",".join("%.4f" % v for v in bbox)
    key = "%s|%s|%s|%d" % (job["source"], area, job["start"].isoformat(), job["days"])
    final = job["start"] + timedelta(days=job["days"] + 3) < date.today()
    cached = store.chunk_get(key, RECENT_CACHE_S)
    if cached is not None:
        return {"job": job, "text": cached, "cached": True, "error": None}
    url = "%s/api/area/csv/%s/%s/%s/%d/%s" % (BASE, map_key, job["source"], area, job["days"], job["start"].isoformat())
    last = None
    for attempt in range(3):
        try:
            r = httpx.get(url, timeout=120)
            text = r.text
            if r.status_code == 200 and not text.startswith("Invalid") and not text.lstrip().startswith("<"):
                store.chunk_put(key, text, final)
                return {"job": job, "text": text, "cached": False, "error": None}
            last = "HTTP %s %s" % (r.status_code, text[:80])
        except httpx.HTTPError as error:
            last = str(error)
        time.sleep(2 ** attempt)
    return {"job": job, "text": "", "cached": False, "error": str(last).replace(map_key, "***")}


def cell_id(lat: float, lon: float) -> int:
    """F03 on the 0.1° grid, rounding before floor so 0.1 float errors never move a point to the next cell."""
    lon = ((lon + 180.0) % 360.0) - 180.0
    row = min(max(int(math.floor(round((lat + 90.0) / CELL_DEG, 9))), 0), NROWS - 1)
    col = min(max(int(math.floor(round((lon + 180.0) / CELL_DEG, 9))), 0), NCOLS - 1)
    return row * NCOLS + col


def cell_center(cid: int) -> tuple:
    """Inverse of F03: cell centre (lat, lon)."""
    return round((cid // NCOLS + 0.5) * CELL_DEG - 90.0, 4), round((cid % NCOLS + 0.5) * CELL_DEG - 180.0, 4)


def cell_area_km2(lat_center: float) -> float:
    """F04 on a sphere, R = 6371.0088 km."""
    r = 6371.0088
    a = math.radians(lat_center - CELL_DEG / 2)
    b = math.radians(lat_center + CELL_DEG / 2)
    return round(r * r * math.radians(CELL_DEG) * (math.sin(b) - math.sin(a)), 3)


def confident(source: str, row: dict) -> bool:
    """F07: MODIS confidence ≥ 30 and type 0 (or no type); VIIRS nominal or high."""
    conf = str(row.get("confidence", "")).strip().lower()
    if source.startswith("MODIS"):
        try:
            if int(float(conf)) < 30:
                return False
        except ValueError:
            return False
        kind = str(row.get("type", "")).strip()
        return kind in ("", "0")
    return conf in ("n", "h", "nominal", "high")


def local_date(acq_date: str, acq_time: str, lon: float) -> date:
    """F01 local solar date: the UTC date moved by floor((UTC hour + lon/15) / 24) days."""
    t = str(acq_time).zfill(4)
    hour = int(t[:2]) + int(t[2:]) / 60.0
    return date.fromisoformat(acq_date) + timedelta(days=math.floor((hour + lon / 15.0) / 24.0))


def detections(map_key: str, bbox: list, start: date, end: date, cells: set) -> dict:
    """Download (or reuse) every chunk, keep confident detections inside the bbox (and region cells when given)."""
    w, s, e, n = bbox
    if not (-180 <= w < e <= 180 and -90 <= s < n <= 90):
        raise CellsError("bbox must be west,south,east,north with west < east and south < north")
    if (e - w) * (n - s) > MAX_AREA_DEG2:
        raise CellsError("area too large: at most %d square degrees per request (about 50° × 50°)" % MAX_AREA_DEG2)
    jobs = plan(start, end, availability(map_key))
    if len(jobs) > MAX_CHUNKS:
        raise CellsError("date range too long for one request (%d FIRMS chunks, limit %d): ask for fewer days; earlier answers are cached" % (len(jobs), MAX_CHUNKS))
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda j: fetch_chunk(map_key, j, bbox), jobs))
    points = []
    raw = 0
    failed = []
    used = {}
    seen = set()
    for res in results:
        job = res["job"]
        if res["error"]:
            failed.append({"source": job["source"], "start": job["start"].isoformat(), "days": job["days"], "error": res["error"]})
            continue
        used.setdefault(job["family"], set()).add(job["source"])
        lo = job["start"].isoformat()
        hi = (job["start"] + timedelta(days=job["days"] - 1)).isoformat()
        for row in csv.DictReader(io.StringIO(res["text"])):
            if not (lo <= row.get("acq_date", "") <= hi):
                continue
            ident = (row.get("latitude"), row.get("longitude"), row.get("acq_date"), row.get("acq_time"), row.get("satellite"), job["family"])
            if ident in seen:
                continue
            seen.add(ident)
            raw = raw + 1
            try:
                lat = float(row["latitude"])
                lon = float(row["longitude"])
                ld = local_date(row["acq_date"], row["acq_time"], lon)
            except (KeyError, ValueError):
                continue
            if not confident(job["source"], row) or ld < start or ld > end:
                continue
            cid = cell_id(lat, lon)
            if cells and cid not in cells:
                continue
            try:
                frp = float(row.get("frp", ""))
            except ValueError:
                frp = None
            points.append({"cell_id": cid, "local_date": ld, "platform": platform_of(job["source"], row.get("satellite", "")), "family": job["family"], "daynight": row.get("daynight", ""), "frp": frp})
    return {"points": points, "raw": raw, "failed": failed, "jobs": len(jobs), "cached": sum(1 for r in results if r["cached"]), "sources": {k: sorted(v) for k, v in used.items()}}


def cell_days(points: list) -> list:
    """F05 table: one row per cell × local date × platform × day/night with counts and FRP."""
    acc = {}
    for p in points:
        key = (p["cell_id"], p["local_date"], p["platform"], p["daynight"])
        row = acc.get(key)
        if row is None:
            row = {"n": 0, "max": None, "sum": None, "family": p["family"]}
            acc[key] = row
        row["n"] = row["n"] + 1
        if p["frp"] is not None:
            row["sum"] = (row["sum"] or 0.0) + p["frp"]
            row["max"] = max(row["max"] or 0.0, p["frp"])
    out = []
    for (cid, ld, platform, dn), row in sorted(acc.items(), key=lambda kv: (kv[0][1], kv[0][0], kv[0][2], kv[0][3])):
        lat, lon = cell_center(cid)
        out.append({"cell_id": cid, "lat": lat, "lon": lon, "local_date": ld.isoformat(), "platform": platform, "family": row["family"], "daynight": dn, "n_detections": row["n"], "max_frp": round_or_none(row["max"]), "sum_frp": round_or_none(row["sum"])})
    return out


def cell_months(points: list) -> list:
    """Cell × month × platform: hot spots, fire cell-days (distinct local dates), night hot spots, FRP sum/max, cell area."""
    acc = {}
    for p in points:
        key = (p["cell_id"], p["local_date"].strftime("%Y-%m"), p["platform"])
        row = acc.get(key)
        if row is None:
            row = {"hot": 0, "night": 0, "days": set(), "sum": None, "max": None, "family": p["family"]}
            acc[key] = row
        row["hot"] = row["hot"] + 1
        row["days"].add(p["local_date"])
        if p["daynight"] == "N":
            row["night"] = row["night"] + 1
        if p["frp"] is not None:
            row["sum"] = (row["sum"] or 0.0) + p["frp"]
            row["max"] = max(row["max"] or 0.0, p["frp"])
    out = []
    for (cid, month, platform), row in sorted(acc.items(), key=lambda kv: (kv[0][1], kv[0][0], kv[0][2])):
        lat, lon = cell_center(cid)
        out.append({"cell_id": cid, "lat": lat, "lon": lon, "month": month, "platform": platform, "family": row["family"], "hotspots": row["hot"], "fire_cell_days": len(row["days"]), "night_hotspots": row["night"], "frp_sum": round_or_none(row["sum"]), "frp_max": round_or_none(row["max"]), "area_km2": cell_area_km2(lat)})
    return out


def round_or_none(v):
    """Round FRP to 0.1 MW, keep missing as None."""
    if v is None:
        return None
    return round(v, 1)


def coverage(start: date, end: date, failed: list) -> dict:
    """Days asked, and days missing because a chunk failed (those days are unknown, not zero)."""
    missing = set()
    for f in failed:
        d0 = date.fromisoformat(f["start"])
        for i in range(f["days"]):
            missing.add((f["source"], (d0 + timedelta(days=i)).isoformat()))
    return {"days_requested": (end - start).days + 1, "failed_chunks": len(failed), "missing_source_days": len(missing)}


def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
