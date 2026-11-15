"""NASA FIRMS Area API client.

URL: https://firms.modaps.eosdis.nasa.gov/api/area/csv/{MAP_KEY}/{SOURCE}/{AREA}/{DAY_RANGE}[/{YYYY-MM-DD}]
AREA is 'world' or 'west,south,east,north'. Tested on the live API 1 Nov 2026: DAY_RANGE must be 1-5
("Invalid day range. Expects [1..5]"), with or without a date. A bbox request costs about 10 transactions (limit 5000 / 10 min).
"""
import csv
import io
import random
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from app.countries import assign_countries

import httpx

BASE = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"
AVAILABILITY_URL = "https://firms.modaps.eosdis.nasa.gov/api/data_availability/csv"
VALID_SOURCES = ["MODIS_NRT", "MODIS_SP", "VIIRS_SNPP_NRT", "VIIRS_SNPP_SP", "VIIRS_NOAA20_NRT", "VIIRS_NOAA20_SP", "VIIRS_NOAA21_NRT", "VIIRS_NOAA21_SP"]
SOURCE_PLATFORM = {"VIIRS_SNPP_NRT": "snpp", "VIIRS_SNPP_SP": "snpp", "VIIRS_NOAA20_NRT": "noaa20", "VIIRS_NOAA20_SP": "noaa20", "VIIRS_NOAA21_NRT": "noaa21", "VIIRS_NOAA21_SP": "noaa21"}
AVAILABILITY_SECONDS = 3600

_cache: dict = {}
_availability: dict = {"t": 0.0, "value": {}}


def local_solar_hour(utc_hhmm: str, lon: float) -> float:
    """F01: t_LMST = (t_UTC + lon / 15) mod 24."""
    text = str(utc_hhmm).zfill(4)
    utc = int(text[:2]) + int(text[2:]) / 60.0
    return (utc + lon / 15.0) % 24.0


def platform_of(source: str, satellite: str) -> str:
    """Map FIRMS source + satellite column to our platform id."""
    if source in SOURCE_PLATFORM:
        return SOURCE_PLATFORM[source]
    value = str(satellite).strip().lower()
    if value in ["t", "terra"]:
        return "terra"
    if value in ["a", "aqua"]:
        return "aqua"
    return "terra"


def row_to_point(row: dict, source: str, sensor: str, point_id: int):
    """One FIRMS CSV row as a point in the frontend schema, or None if it has no usable position."""
    try:
        lat = float(row["latitude"])
        lon = float(row["longitude"])
    except (KeyError, ValueError, TypeError):
        return None
    try:
        frp_value = float(row.get("frp", ""))
    except (ValueError, TypeError):
        frp_value = 0.0
    utc = str(row.get("acq_time", "0000")).zfill(4)
    return {
        "id": point_id,
        "lat": lat,
        "lon": lon,
        "date": row.get("acq_date", ""),
        "utc": utc,
        "lmst": round(local_solar_hour(utc, lon), 2),
        "dn": row.get("daynight", ""),
        "platform": platform_of(source, row.get("satellite", "")),
        "sensor": sensor,
        "frp": frp_value,
        "conf": str(row.get("confidence", "")),
        "cls": "UNKNOWN",
        "country": None,
        "firms_source": source,
        "version": row.get("version", ""),
    }


def sensor_of(source: str) -> str:
    if source.startswith("MODIS"):
        return "MODIS"
    return "VIIRS"


def parse_rows(text: str, source: str, start_id: int) -> list:
    """Turn FIRMS CSV text into the point schema the frontend uses. Keeps sensor-native confidence."""
    points = []
    sensor = sensor_of(source)
    for i, row in enumerate(csv.DictReader(io.StringIO(text))):
        point = row_to_point(row, source, sensor, start_id + i)
        if point is not None:
            points.append(point)
    return points


def get_availability(map_key: str) -> dict:
    """FIRMS data_availability: {source: {"min": date, "max": date}}, cached for an hour. Empty dict if FIRMS does not answer."""
    now = time.time()
    if _availability["value"] and now - _availability["t"] < AVAILABILITY_SECONDS:
        return _availability["value"]
    try:
        response = httpx.get(AVAILABILITY_URL + "/" + map_key + "/ALL", timeout=30)
        response.raise_for_status()
        value = {}
        for row in csv.DictReader(io.StringIO(response.text)):
            source = str(row.get("data_id", "")).strip()
            if source:
                value[source] = {"min": row.get("min_date", ""), "max": row.get("max_date", "")}
        if value:
            _availability["t"] = now
            _availability["value"] = value
        return value
    except (httpx.HTTPError, ValueError):
        return _availability["value"]


def fetch_source(map_key: str, source: str, area: str, days: int, date: str = "") -> str:
    """One FIRMS request with 3 retries and exponential backoff. date (YYYY-MM-DD) asks for days starting on that date."""
    url = BASE + "/" + map_key + "/" + source + "/" + area + "/" + str(days)
    if date:
        url = url + "/" + date
    last_error = None
    for attempt in range(3):
        try:
            response = httpx.get(url, timeout=60)
            response.raise_for_status()
            text = response.text
            if text.startswith("Invalid") or text.startswith("<"):
                raise ValueError(text[:120])
            return text
        except (httpx.HTTPError, ValueError) as error:
            last_error = error
            time.sleep(2 ** attempt)
    raise RuntimeError("FIRMS failed for " + source + ": " + str(last_error))


def get_detections(map_key: str, sources: list, area: str, days: int, max_points: int, cache_seconds: int, date: str = "") -> dict:
    """Fetch several sources, cache for cache_seconds, sample down to max_points. Returns {data, meta}."""
    key = (tuple(sources), area, days, date)
    now = time.time()
    if key in _cache and now - _cache[key]["t"] < cache_seconds:
        cached = _cache[key]["value"]
        meta = dict(cached["meta"])
        meta["cache_age_seconds"] = int(now - _cache[key]["t"])
        return {"data": cached["data"], "meta": meta}
    with ThreadPoolExecutor(max_workers=len(sources)) as pool:
        texts = list(pool.map(lambda s: fetch_source(map_key, s, area, days, date), sources))
    rng = random.Random(0)
    points = []
    tried = []
    total = 0
    for index, source in enumerate(sources):
        sensor = sensor_of(source)
        rows = 0
        for row in csv.DictReader(io.StringIO(texts[index])):
            point = row_to_point(row, source, sensor, total + 1)
            if point is None:
                continue
            rows += 1
            total += 1
            if len(points) < max_points:
                points.append(point)
            else:
                slot = rng.randrange(total)
                if slot < max_points:
                    points[slot] = point
        texts[index] = ""
        tried.append({"source": source, "rows": rows})
    sampled = total > max_points
    availability = get_availability(map_key)
    for entry in tried:
        if entry["source"] in availability:
            entry["first_date"] = availability[entry["source"]]["min"]
            entry["latest_date"] = availability[entry["source"]]["max"]
    assign_countries(points)
    status = "LIVE_NRT"
    if all(s.endswith("_SP") for s in sources):
        status = "ARCHIVE_STANDARD"
    value = {
        "data": points,
        "meta": {
            "data_source": "NASA FIRMS Area API",
            "provider": "NASA FIRMS",
            "sources": tried,
            "area": area,
            "day_range": days,
            "start_date": date or None,
            "status": status,
            "provenance": "OFFICIAL_DOCUMENTED",
            "demo": False,
            "fallback_used": False,
            "rows_total": total,
            "sampled": sampled,
            "generated_at_utc": datetime.now(timezone.utc).isoformat(),
            "unit": "detections (pixels), not fires",
            "warnings": ["FIRMS detections have limited accuracy; not for protection of life or property."],
            "citation_urls": ["https://firms.modaps.eosdis.nasa.gov/api/area/"],
        },
    }
    _cache[key] = {"t": now, "value": value}
    return value
