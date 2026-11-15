"""Context layers from Google Earth Engine for any area: burned area, land cover, clear-sky coverage.

Each layer is reduced to a regular lat/lon grid over the requested bbox. The grid is 0.1° for small areas and coarser
for large ones so one answer stays under ~4,000 cells. Reductions are staged (native pixels → 0.01° / 0.1° → grid)
so Earth Engine never averages more than ~12,000 input pixels per output pixel.
  burned    MODIS/061/MCD64A1 BurnDate > 0 → share of the cell that burned in the month (0–1, MODIS 500 m).
  clearsky  MODIS/061/MOD14A1 + MYD14A1 FireMask ∈ {3, 5, 7, 8, 9} = a valid (clear) observation; mean clear days per
            pixel over the month, averaged over Terra and Aqua (FireMask 4 = cloud, 0–2 = not processed / missing).
  landcover ESA/WorldCover/v200 (2021, 10 m) class per cell, read at grid scale from Earth Engine's pyramid of the map.
Missing coverage stays null. Results are cached for a day (they only change when NASA reprocesses a month).
Needs EE_PROJECT and one of: `earthengine authenticate` on this machine (local), EE_SERVICE_ACCOUNT_JSON (a Google service
account key registered for Earth Engine, raw JSON or base64) or EARTHENGINE_TOKEN (the contents of
~/.config/earthengine/credentials from a machine where you signed in) — the last two are for deployed servers.
"""
import calendar
import math
import os
from datetime import date

from app import config, store

SIZES = [0.1, 0.25, 0.5, 1.0, 2.0, 2.5, 5.0]
MAX_CELLS = 4000
CACHE_S = 24 * 3600
VALID = [3, 5, 7, 8, 9]
WORLDCOVER = {
    10: ("Tree cover", "#006400"), 20: ("Shrubland", "#ffbb22"), 30: ("Grassland", "#ffff4c"), 40: ("Cropland", "#f096ff"),
    50: ("Built-up", "#fa0000"), 60: ("Bare / sparse", "#b4b4b4"), 70: ("Snow and ice", "#f0f0f0"), 80: ("Water", "#0064c8"),
    90: ("Wetland", "#0096a0"), 95: ("Mangroves", "#00cf75"), 100: ("Moss and lichen", "#fae6a0"),
}
STATE = {"ready": False, "error": None}


class ContextError(Exception):
    """A request the API refuses or Earth Engine cannot answer."""


def init() -> None:
    """Initialise Earth Engine once (python.org Python on macOS needs certifi's CA bundle for HTTPS)."""
    if STATE["ready"]:
        return
    if not os.environ.get("SSL_CERT_FILE"):
        try:
            import certifi
            os.environ["SSL_CERT_FILE"] = certifi.where()
        except ImportError:
            pass
    project = os.environ.get("EE_PROJECT") or os.environ.get("GEE_PROJECT")
    if not project:
        raise ContextError("EE_PROJECT not set in backend/.env")
    import ee
    try:
        service_json = os.environ.get("EE_SERVICE_ACCOUNT_JSON", "").strip()
        token = os.environ.get("EARTHENGINE_TOKEN", "").strip()
        if service_json:
            import base64
            import json
            if not service_json.startswith("{"):
                service_json = base64.b64decode(service_json).decode("utf-8")
            info = json.loads(service_json)
            credentials = ee.ServiceAccountCredentials(info["client_email"], key_data=service_json)
            ee.Initialize(credentials, project=project)
            STATE["ready"] = True
            return
        if token:
            from pathlib import Path
            path = Path.home() / ".config" / "earthengine" / "credentials"
            if not path.exists():
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(token, encoding="utf-8")
        ee.Initialize(project=project)
    except Exception as error:
        STATE["error"] = str(error)[:200]
        raise ContextError("Earth Engine not ready: " + STATE["error"])
    STATE["ready"] = True


def grid_size(bbox: list) -> float:
    """Smallest grid step that keeps the bbox under MAX_CELLS cells."""
    w, s, e, n = bbox
    area = (e - w) * (n - s)
    for size in SIZES:
        if area / (size * size) <= MAX_CELLS:
            return size
    return SIZES[-1]


def snap(bbox: list, size: float) -> list:
    """bbox snapped outward to the grid, clamped to the globe."""
    w, s, e, n = bbox
    w = max(-180.0, math.floor(w / size) * size)
    s = max(-90.0, math.floor(s / size) * size)
    e = min(180.0, math.ceil(e / size) * size)
    n = min(90.0, math.ceil(n / size) * size)
    return [round(w, 6), round(s, 6), round(e, 6), round(n, 6)]


def month_range(month: str) -> tuple:
    """'YYYY-MM' → (first day ISO, first day of next month ISO)."""
    y, m = int(month[:4]), int(month[5:7])
    last = calendar.monthrange(y, m)[1]
    start = date(y, m, 1)
    end = date(y, m, last)
    return start.isoformat(), date.fromordinal(end.toordinal() + 1).isoformat()


def to_grid(img, bbox: list, size: float, reducer, native_deg: float):
    """Stage the reduction native → ×50 → ... → grid (each step averages ≤ 2,500 pixels), then sample the grid as a 2-D array."""
    import ee
    w, s, e, n = bbox
    out = img
    chain = []
    step = native_deg * 50
    while step < size:
        chain.append(step)
        step = step * 50
    chain.append(size)
    for step in chain:
        proj = ee.Projection("EPSG:4326", [step, 0, w, 0, -step, n])
        out = out.reduceResolution(reducer=reducer, maxPixels=65535, bestEffort=False).reproject(proj)
    region = ee.Geometry.Rectangle([w, s, e, n], None, False)
    arr = out.rename(["v"]).unmask(-9999).sampleRectangle(region=region, defaultValue=-9999).get("v").getInfo()
    return arr


def burned(bbox: list, size: float, month: str):
    """Share of each cell burned in the month (MCD64A1)."""
    import ee
    a, b = month_range(month)
    col = ee.ImageCollection("MODIS/061/MCD64A1").filterDate(a, b).select("BurnDate")
    if col.size().getInfo() == 0:
        raise ContextError("MCD64A1 has no image for %s yet (it is released about 1–2 months after the month ends)" % month)
    img = col.max().gt(0).unmask(0).setDefaultProjection(col.first().projection())
    return to_grid(img, bbox, size, ee.Reducer.mean(), 0.0045)


def clearsky(bbox: list, size: float, month: str):
    """Mean clear (valid) observation days per pixel in the month, Terra and Aqua averaged (MOD14A1/MYD14A1 FireMask)."""
    import ee
    a, b = month_range(month)
    parts = []
    for coll in ["MODIS/061/MOD14A1", "MODIS/061/MYD14A1"]:
        c = ee.ImageCollection(coll).filterDate(a, b).select("FireMask")
        if c.size().getInfo() > 0:
            parts.append(c.map(lambda im: im.remap(VALID, [1] * len(VALID), 0)).sum().setDefaultProjection(c.first().projection()))
    if not parts:
        raise ContextError("no MOD14A1 / MYD14A1 images for %s yet" % month)
    img = ee.ImageCollection(parts).mean().setDefaultProjection(parts[0].projection())
    return to_grid(img, bbox, size, ee.Reducer.mean(), 0.009)


def landcover(bbox: list, size: float, month: str):
    """Dominant ESA WorldCover 2021 class per cell (month is ignored: WorldCover is one map)."""
    import ee
    w, s, e, n = bbox
    img = ee.ImageCollection("ESA/WorldCover/v200").first().select("Map")
    proj = ee.Projection("EPSG:4326", [size, 0, w, 0, -size, n])
    region = ee.Geometry.Rectangle([w, s, e, n], None, False)
    return img.reproject(proj).rename(["v"]).unmask(-9999).sampleRectangle(region=region, defaultValue=-9999).get("v").getInfo()


LAYERS = {"burned": burned, "clearsky": clearsky, "landcover": landcover}
LATEST_COLL = {"burned": "MODIS/061/MCD64A1", "clearsky": "MODIS/061/MOD14A1", "landcover": "ESA/WorldCover/v200"}


def latest_month(layer: str) -> str:
    """Newest complete month Earth Engine actually has for this layer (cached 6 h)."""
    key = "context-latest:" + layer
    cached, fetched = store.load(key)
    if cached and fetched:
        from datetime import datetime, timezone
        if (datetime.now(timezone.utc) - datetime.fromisoformat(fetched)).total_seconds() < 6 * 3600:
            return cached["month"]
    init()
    import ee
    if layer == "landcover":
        month = "2021-01"
    else:
        last = ee.ImageCollection(LATEST_COLL[layer]).sort("system:time_start", False).first().date()
        y, m, d = [int(v) for v in last.format("YYYY-MM-dd").getInfo().split("-")]
        if layer == "clearsky" and d < calendar.monthrange(y, m)[1]:
            m = m - 1
            if m < 1:
                y, m = y - 1, 12
        month = "%04d-%02d" % (y, m)
    store.save(key, {"month": month}, "OK")
    return month


def cells(layer: str, bbox: list, month: str) -> dict:
    """Grid cells with values for a layer: {data: [{lat, lon, size, value, ...}], meta}. month None = newest available."""
    if layer not in LAYERS:
        raise ContextError("unknown layer " + layer)
    if month is None:
        month = latest_month(layer)
    w, s, e, n = bbox
    if layer != "landcover" and (e - w > 30 or n - s > 30):
        raise ContextError("too large for %s: at most 30° × 30° per request (search a country or region first)" % layer)
    size = grid_size(bbox)
    box = snap(bbox, size)
    key = "context:%s:%s:%s:%s" % (layer, ",".join(str(v) for v in box), size, month)
    cached, fetched = store.load(key)
    if cached and fetched:
        from datetime import datetime, timezone
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(fetched)).total_seconds()
        if age < CACHE_S:
            cached["meta"]["cached"] = True
            return cached
    init()
    arr = LAYERS[layer](box, size, month)
    w, s, e, n = box
    rows = []
    for i, line in enumerate(arr):
        lat = n - (i + 0.5) * size
        for j, v in enumerate(line):
            if v is None or v <= -9998:
                continue
            lon = w + (j + 0.5) * size
            item = {"lat": round(lat, 4), "lon": round(lon, 4), "value": round(float(v), 4)}
            if layer == "landcover":
                code = int(round(v))
                if code not in WORLDCOVER:
                    continue
                item["value"] = code
                item["class"] = WORLDCOVER[code][0]
            elif layer == "burned" and v <= 0:
                continue
            rows.append(item)
    meta = {"status": "ARCHIVE_STANDARD", "provenance": "SOURCE_DERIVED", "layer": layer, "month": month, "grid_deg": size, "bbox": box, "cells": len(rows),
            "data_source": {"burned": "NASA MODIS MCD64A1 v061 via Google Earth Engine", "clearsky": "NASA MODIS MOD14A1 + MYD14A1 v061 FireMask via Google Earth Engine", "landcover": "ESA WorldCover v200 (2021) via Google Earth Engine"}[layer],
            "unit": {"burned": "share of cell burned (0–1)", "clearsky": "clear observation days per pixel in the month (Terra/Aqua mean)", "landcover": "dominant WorldCover class"}[layer],
            "classes": {str(k): {"name": v[0], "color": v[1]} for k, v in WORLDCOVER.items()} if layer == "landcover" else None,
            "null_rule": "cells without data are left out (not 0)", "demo": False}
    result = {"data": rows, "meta": meta}
    store.save(key, result, "ARCHIVE_STANDARD")
    return result
