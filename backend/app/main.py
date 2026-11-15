"""FIREWORK CHRONOS API. Every response is {data, meta}. Missing data is never returned as zero."""
import csv
import io
import json
from pathlib import Path
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse

import calendar as calmod
from datetime import date

from app import cells as cellmod
from app import config
from app import ml
from app import store
from app import supa
from app.firms import VALID_SOURCES, get_detections
from app.trust import fill_processed_zeros
from app.orbits import NORAD, fetch_tle

app = FastAPI(title="FIREWORK CHRONOS API", version="2.1.0")
app.add_middleware(CORSMiddleware, allow_origins=config.ALLOWED_ORIGINS, allow_origin_regex=config.ALLOWED_ORIGIN_REGEX, allow_methods=["GET", "POST"], allow_headers=["*"])


@app.middleware("http")
async def stamp_version(request, call_next):
    """G12: every JSON answer with a meta block carries the API version."""
    response = await call_next(request)
    if not request.url.path.startswith("/api/") or "application/json" not in response.headers.get("content-type", ""):
        return response
    body = b""
    async for chunk in response.body_iterator:
        body += chunk
    headers = {k: v for k, v in response.headers.items() if k.lower() != "content-length"}
    try:
        doc = json.loads(body)
    except ValueError:
        return Response(content=body, status_code=response.status_code, headers=headers, media_type="application/json")
    if isinstance(doc, dict) and isinstance(doc.get("meta"), dict):
        doc["meta"].setdefault("version", app.version)
        body = json.dumps(doc, ensure_ascii=False).encode("utf-8")
    return Response(content=body, status_code=response.status_code, headers=headers, media_type="application/json")

DEFAULT_NRT = ["VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT", "VIIRS_SNPP_NRT", "MODIS_NRT"]
PLATFORM_FAMILY = {"terra": "MODIS", "aqua": "MODIS", "snpp": "VIIRS_SNPP", "noaa20": "VIIRS_NOAA20", "noaa21": "VIIRS_NOAA21"}


def read_static(name: str) -> dict:
    """Load a static JSON file shipped with the frontend (real reference data or demo fixtures)."""
    path = config.STATIC_DIR / name
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def number_or_none(text):
    """CSV text → float, empty / nan → None (missing is never 0)."""
    if text is None or text == "" or text == "nan":
        return None
    return float(text)


@app.get("/api/health")
def health() -> dict:
    """Which sources are configured. Reachability is checked lazily by the data routes."""
    sources = read_static("health.json")["data"]["sources"]
    for source in sources:
        if source["auth"] == "FIRMS_MAP_KEY":
            if config.FIRMS_MAP_KEY:
                source["status"] = "CONFIGURED"
            else:
                source["status"] = "MISSING_KEY"
        elif source["auth"] in ["none", ""]:
            source["status"] = "NO_KEY_NEEDED"
        else:
            source["status"] = "NOT_CHECKED"
    return {"data": {"sources": sources}, "meta": {"data_source": "backend config", "firms_live": bool(config.FIRMS_MAP_KEY), "generated_at_utc": now_utc(), "demo": False}}


@app.get("/api/detections")
def detections(source: str = Query("VIIRS_NOAA20_NRT,VIIRS_NOAA21_NRT,VIIRS_SNPP_NRT,MODIS_NRT"), area: str = Query("world"), days: int = Query(1, ge=1, le=5), date: str = Query("", pattern=r"^(\d{4}-\d{2}-\d{2})?$")) -> dict:
    """Real FIRMS detections. Order: live FIRMS → last good copy from the persistent cache (CACHED, with its fetch time) → 503.
    Never demo data. source=ALL means the default NRT set. FIRMS accepts DAY_RANGE 1–5 (tested 1 Nov 2026)."""
    if source.strip().upper() == "ALL":
        sources = DEFAULT_NRT
    else:
        sources = [s.strip() for s in source.split(",") if s.strip() in VALID_SOURCES]
    if not sources:
        raise HTTPException(status_code=422, detail={"field": "source", "allowed": VALID_SOURCES + ["ALL"]})
    if area != "world":
        parts = area.split(",")
        if len(parts) != 4:
            raise HTTPException(status_code=422, detail={"field": "area", "expected": "world or west,south,east,north"})
    key = "detections:" + ",".join(sources) + ":" + area + ":" + str(days) + ":" + date
    reason = "FIRMS_MAP_KEY not set"
    if config.FIRMS_MAP_KEY:
        try:
            result = get_detections(config.FIRMS_MAP_KEY, sources, area, days, config.MAX_POINTS, config.CACHE_SECONDS, date)
            if "cache_age_seconds" not in result["meta"]:
                store.save(key, result, result["meta"]["status"])
                store.keep_detections(result["data"])
            return result
        except RuntimeError as error:
            reason = str(error)
    cached, fetched_at = store.load(key)
    if cached:
        cached["meta"]["status"] = "CACHED"
        cached["meta"]["cached_fetched_at_utc"] = fetched_at
        cached["meta"]["cache_reason"] = reason
        return cached
    raise HTTPException(status_code=503, detail={"status": "UNAVAILABLE", "reason": reason})


@app.get("/api/satellites")
def satellites() -> dict:
    """Static satellite facts plus real TLEs from CelesTrak when reachable."""
    result = read_static("satellites.json")
    fetched = 0
    for sat in result["data"]:
        try:
            sat["tle"] = fetch_tle(NORAD[sat["id"]])
            fetched = fetched + 1
        except Exception:
            sat["tle"] = None
    result["meta"]["tle_source"] = "CelesTrak GP"
    result["meta"]["tle_fetched"] = fetched
    result["meta"]["generated_at_utc"] = now_utc()
    return result


def table_rows(region: str, name: str, extra: dict = None) -> list:
    """A pipeline table for a region: the local CSV when it exists (development), otherwise the same table in Supabase (deployed)."""
    path = pipeline_file(region, name + ".csv")
    if path is not None:
        with open(path, encoding="utf-8") as handle:
            return list(csv.DictReader(handle))
    return supa.region_rows(region, name, extra)


def pipeline_file(region: str, name: str):
    """A file written by the data pipeline (pipeline/data/processed/<region>/<name>), or None."""
    path = config.PIPELINE_DIR / region / name
    if path.exists():
        return path
    return None


@app.get("/api/regions")
def regions() -> dict:
    """Static regions plus the pipeline's regions.json (adds e.g. Córdoba, Argentina), each with has_calendar."""
    result = read_static("regions.json")
    known = set(r["id"] for r in result["data"])
    if config.PIPELINE_REGIONS.exists():
        with open(config.PIPELINE_REGIONS, encoding="utf-8") as handle:
            for r in json.load(handle)["regions"]:
                if r["id"] not in known:
                    result["data"].append({"id": r["id"], "name": r["name"], "bbox": r["bbox"], "role": r["role"]})
    remote = supa.regions_with("region_month")
    for r in result["data"]:
        has = pipeline_file(r["id"], "region_month.csv") is not None or (config.PROCESSED_DIR / ("calendar_" + r["id"] + ".json")).exists() or r["id"] in remote
        r["has_calendar"] = has
    return result


FORMULAS_FILE = Path(__file__).resolve().parents[2] / "docs" / "formula_pdfs" / "formulas_content.json"


@app.get("/api/formulas")
def formulas() -> dict:
    """The 46-formula method reference (docs/formula_pdfs/formulas_content.json) in the usual {data, meta} shape."""
    with open(FORMULAS_FILE, encoding="utf-8") as handle:
        payload = json.load(handle)
    return {"data": payload["formulas"], "meta": {"status": "SOURCE_DERIVED", "provenance": "SOURCE_DERIVED", "demo": False, "count": len(payload["formulas"]), "generated": payload.get("generated"), "generated_at_utc": now_utc()}}


def region_name(region: str) -> str:
    """Display name from pipeline/regions.json."""
    if config.PIPELINE_REGIONS.exists():
        with open(config.PIPELINE_REGIONS, encoding="utf-8") as handle:
            for r in json.load(handle)["regions"]:
                if r["id"] == region:
                    return r["name"]
    return region


def calendar_from_pipeline(region: str):
    """Calendar for the website from pipeline steps 5–6 (region_month.csv + calibration.csv).
    modis / viirs = fire cell-days of MODIS (Terra+Aqua) and VIIRS S-NPP; only months with status 'ok' carry a value, others are null.
    k_baseline = s06 ratio of totals per calendar month (VIIRS S-NPP / MODIS cell-days, overlap 2012→) with a year-block bootstrap 95 % band."""
    rows = table_rows(region, "region_month")
    if not rows:
        return None
    years = sorted(set(int(r["month"][:4]) for r in rows))
    def empty():
        return [[None] * 12 for _ in years]
    cell_days = {"MODIS": empty(), "VIIRS_SNPP": empty(), "VIIRS_NOAA20": empty()}
    exposure = {"MODIS": empty(), "VIIRS_SNPP": empty()}
    night = {"MODIS": empty(), "VIIRS_SNPP": empty()}
    processed = set()
    boundary = "bbox"
    for r in rows:
        yi = years.index(int(r["month"][:4]))
        mi = int(r["month"][5:7]) - 1
        boundary = r.get("boundary") or boundary
        if r["status"] != "ok" or r["family"] not in cell_days:
            continue
        processed.add(mi + 1)
        cell_days[r["family"]][yi][mi] = number_or_none(r.get("fire_cell_days"))
        if r["family"] in exposure:
            exposure[r["family"]][yi][mi] = number_or_none(r.get("valid_cell_days"))
            night[r["family"]][yi][mi] = number_or_none(r.get("night_hotspots"))
    k_baseline = {}
    method = ""
    calib = table_rows(region, "calibration")
    if calib:
        for r in calib:
            if r["metric"] != "cell_days":
                continue
            k = number_or_none(r["k"])
            method = r["method"]
            if k is not None:
                k_baseline[str(int(r["calendar_month"]))] = {"k": k, "lo": number_or_none(r["k_lo95"]), "hi": number_or_none(r["k_hi95"]), "n_years": int(float(r["n_overlap_years"]))}
    data = {
        "region": region,
        "region_name": region_name(region),
        "years": years,
        "months_processed": sorted(processed),
        "modis": cell_days["MODIS"],
        "viirs": [row if years[i] >= 2012 else [None] * 12 for i, row in enumerate(cell_days["VIIRS_SNPP"])],
        "night_modis": night["MODIS"],
        "night_viirs": night["VIIRS_SNPP"],
        "platforms": {"noaa20": cell_days["VIIRS_NOAA20"]},
        "exposure_modis": exposure["MODIS"],
        "exposure_viirs": exposure["VIIRS_SNPP"],
        "k_baseline": k_baseline,
    }
    meta = {
        "data_source": "NASA FIRMS standard processing (MODIS_SP, VIIRS_SNPP_SP, VIIRS_NOAA20_SP) via pipeline steps 2, 5, 6",
        "provider": "NASA FIRMS",
        "status": "ARCHIVE_STANDARD",
        "provenance": "SOURCE_DERIVED",
        "demo": False,
        "fallback_used": False,
        "unit": "fire cell-days (0.1° cell × local solar day)",
        "rule": "MODIS confidence ≥ 30, VIIRS nominal/high; FIRMS type 1, 2, 3 (static / volcano / offshore) left out (F07)",
        "boundary": boundary,
        "k_method": method,
        "null_rule": "months not fully downloaded are null, never 0",
        "generated_at_utc": now_utc(),
    }
    return {"data": data, "meta": meta}


_GLOBAL = {"mtime": None, "payload": None}


def global_calendar():
    """Whole-Earth calendar from pipeline steps 9–10 (data/processed/global/calendar_global.json), reloaded when the file changes."""
    path = config.PROCESSED_DIR / "global" / "calendar_global.json"
    if not path.exists():
        return None
    mtime = path.stat().st_mtime
    if _GLOBAL["mtime"] != mtime:
        with open(path, encoding="utf-8") as handle:
            _GLOBAL["payload"] = json.load(handle)
        _GLOBAL["mtime"] = mtime
    return _GLOBAL["payload"]


_TRUST = {"mtime": None, "payload": None}
_EXPOSURE = {"mtime": None, "payload": None}


def exposure_countries():
    """Clear-view cell-days per country from Earth Engine (tools/trust/build_exposure.py), reloaded when the file changes."""
    path = config.PROCESSED_DIR / "global" / "exposure_countries.json"
    if not path.exists():
        return None
    mtime = path.stat().st_mtime
    if _EXPOSURE["mtime"] != mtime:
        with open(path, encoding="utf-8") as handle:
            _EXPOSURE["payload"] = json.load(handle)
        _EXPOSURE["mtime"] = mtime
    return _EXPOSURE["payload"]


def trust_global():
    """Trust layer (coverage, conformal, physics checks, similar seasons) built by tools/trust/build_trust.py, reloaded when the file changes."""
    path = config.PROCESSED_DIR / "global" / "trust_global.json"
    if not path.exists():
        return None
    mtime = path.stat().st_mtime
    if _TRUST["mtime"] != mtime:
        with open(path, encoding="utf-8") as handle:
            _TRUST["payload"] = json.load(handle)
        _TRUST["mtime"] = mtime
    return _TRUST["payload"]


@app.get("/api/method_card")
def method_card() -> dict:
    """The method card: inputs with SHA-256, harmonisation method, coverage gate, conformal results, physics checks, gates."""
    path = config.PROCESSED_DIR / "global" / "method_card.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail={"status": "UNAVAILABLE", "reason": "run tools/trust/build_trust.py"})
    with open(path, encoding="utf-8") as handle:
        card = json.load(handle)
    return {"data": card, "meta": {"provenance": "RUN_TESTED_LOCALLY", "generated_at_utc": card.get("generated_at_utc")}}


def calendar_from_global(region: str):
    payload = global_calendar()
    if payload is None or region not in payload["regions"]:
        return None
    data = fill_processed_zeros(payload["regions"][region], payload["regions"].get("world"))
    exposure = exposure_countries()
    exposure_added = False
    if exposure and region in exposure["regions"] and not any(v is not None for row in (data.get("exposure_modis") or []) for v in row):
        extra = exposure["regions"][region]
        data["exposure_modis"] = extra["exposure_modis"]
        data["exposure_viirs"] = extra["exposure_viirs"]
        data["exposure_flag"] = extra.get("flag")
        exposure_added = True
    trust = trust_global()
    if trust and region in trust["regions"]:
        data["trust"] = trust["regions"][region]
        data["trust_summary"] = trust["summary"]
    info = payload["meta"]
    has_nrt = any(s == "nrt" for row in data["status_modis"] + data["status_viirs"] for s in row)
    status = "ARCHIVE_STANDARD"
    if has_nrt:
        status = "LIVE_NRT"
    meta = {
        "data_source": "NASA MOD14A1 + MYD14A1 (MODIS), VNP14A1 (VIIRS S-NPP) daily fire masks; recent days FIRMS MODIS NRT and NOAA-20 VIIRS NRT; counted per 0.1° cell in Google Earth Engine (pipeline steps 9–10)",
        "provider": "NASA LP DAAC / FIRMS via Google Earth Engine",
        "status": status,
        "provenance": "SOURCE_DERIVED",
        "demo": False,
        "fallback_used": False,
        "unit": "fire cell-days (0.1° cell × day with a nominal or high confidence fire pixel)",
        "rule": "FireMask 8–9 (nominal, high); valid view FireMask 3, 5, 7, 8, 9; NRT: FIRMS MODIS confidence ≥ 30, NOAA-20 class ≥ 1",
        "boundary": "USDOS LSIB 2017 country polygons",
        "k_method": "ratio of totals per calendar month over 2012–2025 (VIIRS S-NPP / MODIS), year-block bootstrap 95 %, empirical Bayes pooling toward the World value",
        "null_rule": "no product that month = null, never 0; partial and near-real-time months are flagged in status_modis / status_viirs",
        "latest_month_per_product": info.get("latest_month_per_product"),
        "pipeline_generated_at_utc": info.get("generated_at_utc"),
        "trimmed": info.get("trimmed"),
        "generated_at_utc": now_utc(),
    }
    if "FIRMS standard archive" in str(info.get("source", "")):
        meta["data_source"] = "NASA FIRMS standard archive fire points: MODIS Collection 6.1 (Terra + Aqua) 2000–2025, VIIRS 375 m S-NPP 2012–2025, NOAA-20 2018–2025 and NOAA-21 2023–2025 (separate series), plus 2026 year-to-date from the FIRMS API (near-real-time months flagged nrt); built in Google Colab (fireworklib)"
        meta["provider"] = "NASA FIRMS (LANCE / MODAPS)"
        meta["unit"] = "fire cell-days (0.1° cell × local solar day with at least one qualifying fire point)"
        meta["rule"] = "MODIS confidence ≥ 30; VIIRS confidence nominal or high; FIRMS type 0 (vegetation fire); local solar day = UTC + longitude / 15 h"
        meta["boundary"] = "Natural Earth 10 m admin-0 countries (cell centre); custom boxes b_*"
    if exposure_added:
        meta["exposure_source"] = exposure["meta"]["source"] + " · " + exposure["meta"]["missing"]
    return {"data": data, "meta": meta}


@app.get("/api/calendar_regions")
def calendar_regions() -> dict:
    """Every region the whole-Earth calendar covers (World + countries), with total fire cell-days for sorting."""
    payload = global_calendar()
    if payload is None:
        raise HTTPException(status_code=404, detail={"status": "UNAVAILABLE", "reason": "run pipeline steps 9 and 10"})
    rows = []
    for rid, r in payload["regions"].items():
        total = 0
        for row in r["modis"]:
            for v in row:
                if v:
                    total = total + v
        rows.append({"id": rid, "name": r["region_name"], "fips": r.get("iso2", ""), "modis_cell_days_total": round(total)})
    rows.sort(key=lambda x: (x["id"] != "world", -x["modis_cell_days_total"]))
    return {"data": rows, "meta": {"provenance": "SOURCE_DERIVED", "count": len(rows), "generated_at_utc": payload["meta"].get("generated_at_utc")}}


@app.get("/api/calendar/{region}")
def calendar(region: str) -> dict:
    """Real calendar: pipeline tables first, then an older processed file, then the persistent cache copy. 404 until the pipeline has run. Never demo data."""
    result = calendar_from_pipeline(region)
    if result is None:
        result = calendar_from_global(region)
    if result is None:
        legacy = config.PROCESSED_DIR / ("calendar_" + region + ".json")
        if legacy.exists():
            with open(legacy, encoding="utf-8") as handle:
                result = json.load(handle)
    if result is not None:
        store.save("calendar:" + region, result, result["meta"].get("status", "ARCHIVE_STANDARD"))
        return result
    cached, fetched_at = store.load("calendar:" + region)
    if cached:
        cached["meta"]["status"] = "CACHED"
        cached["meta"]["cached_fetched_at_utc"] = fetched_at
        return cached
    raise HTTPException(status_code=404, detail={"status": "UNAVAILABLE", "reason": "no processed calendar yet for " + region + " — run pipeline steps 2, 5, 6"})


@app.get("/api/anomaly/{region}")
def anomaly(region: str, month: str = Query(None, pattern=r"^\d{4}-\d{2}$")) -> dict:
    """This month vs the same month in other years (harmonised hot spots): value, median, mean, % vs median, robust z, n.
    Without ?month= returns the latest month that has enough history."""
    rows = table_rows(region, "anomaly", {"order": "month"})
    if not rows:
        raise HTTPException(status_code=404, detail={"status": "UNAVAILABLE", "reason": "run pipeline step 6 for " + region})
    usable = [r for r in rows if r["status"] in ("ok", "indicative")]
    pick = None
    if month:
        found = [r for r in rows if r["month"] == month]
        if found:
            pick = found[0]
    elif usable:
        pick = usable[-1]
    if pick is None:
        raise HTTPException(status_code=404, detail={"status": "UNAVAILABLE", "reason": "no anomaly for that month"})
    out = {}
    for k, v in pick.items():
        if k in ("region_id", "month", "status"):
            out[k] = v
        else:
            out[k] = number_or_none(v)
    return {"data": out, "meta": {"status": "ARCHIVE_STANDARD", "provenance": "SOURCE_DERIVED", "unit": "hot spots (harmonised to VIIRS S-NPP)", "method": "F27 robust z, leave-target-out, n ≥ 8 = ok", "generated_at_utc": now_utc()}}


@app.get("/api/export/hotspots.csv")
def export_hotspots(region: str = Query(None), bbox: str = Query(None), start: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"), end: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$")):
    """CSV of every hot spot in an area and date range: archive rows from the pipeline (region) plus live rows kept by the cache."""
    if bbox:
        parts = [float(x) for x in bbox.split(",")]
        if len(parts) != 4:
            raise HTTPException(status_code=422, detail={"field": "bbox", "expected": "west,south,east,north"})
    else:
        parts = [-180.0, -90.0, 180.0, 90.0]
    west, south, east, north = parts
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["lat", "lon", "acq_date", "acq_time_utc", "lmst", "sensor", "platform", "frp_mw", "confidence_native", "daynight", "firms_type", "processing", "source", "origin"])
    count = 0
    path = None
    if region:
        path = pipeline_file(region, "fire_detection.csv")
    if path is not None:
        with open(path, encoding="utf-8") as handle:
            for r in csv.DictReader(handle):
                d = r["acq_date"][:10]
                lat = float(r["lat"])
                lon = float(r["lon"])
                if start <= d <= end and south <= lat <= north and west <= lon <= east:
                    writer.writerow([lat, lon, d, r["acq_time"], r["lmst"], r["sensor"], r["platform"], r["frp"], r["confidence_raw"], r["daynight"], r["firms_type"], r["processing"], r["firms_source"], "pipeline archive"])
                    count = count + 1
    for p in store.history(west, south, east, north, start, end):
        writer.writerow([p["lat"], p["lon"], p.get("date"), p.get("utc"), p.get("lmst"), p.get("sensor"), p.get("platform"), p.get("frp"), p.get("conf"), p.get("dn"), "", "NRT", p.get("firms_source"), "live cache"])
        count = count + 1
    buf.seek(0)
    name = "hotspots_%s_%s_%s.csv" % (region or "bbox", start, end)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=" + name, "X-Row-Count": str(count)})


@app.get("/api/ml/models")
def ml_models() -> dict:
    """Model cards with held-out test metrics and provenance."""
    return ml.cards()


@app.post("/api/ml/source")
def ml_source(body: dict) -> dict:
    """Body {"points": [{id, lat, lon, date, utc, dn, frp}]}. Returns P(static / non-vegetation) per point, max 5000 points."""
    points = body.get("points", [])
    if not isinstance(points, list) or len(points) > 5000:
        raise HTTPException(status_code=422, detail={"field": "points", "expected": "list of at most 5000 detections"})
    result = ml.classify(points)
    if result["meta"]["status"] == "UNAVAILABLE":
        raise HTTPException(status_code=503, detail=result["meta"])
    return result


@app.get("/api/ml/harmonised/{region}")
def ml_harmonised(region: str) -> dict:
    """VIIRS-equivalent calendar with band from the harmonisation model. 404 until ml/train_harmonise.py has run."""
    result = ml.harmonised(region)
    if result is None:
        raise HTTPException(status_code=404, detail={"status": "UNAVAILABLE", "reason": "no harmonised calendar yet for " + region})
    return result


REGION_CSV = config.ROOT / "data" / "supabase" / "csv" / "region.csv"
REGION_CELL_CSV = config.ROOT / "data" / "supabase" / "csv" / "region_cell.csv"
FAMILY_OF = {"terra": "MODIS", "aqua": "MODIS", "snpp": "VIIRS_SNPP", "noaa20": "VIIRS_NOAA20", "noaa21": "VIIRS_NOAA21"}


def region_area(region: str) -> tuple:
    """bbox [W, S, E, N] and the polygon cell set (Natural Earth, region_cell.csv) of a region id; empty set = bbox only."""
    bbox = None
    if config.PIPELINE_REGIONS.exists():
        with open(config.PIPELINE_REGIONS, encoding="utf-8") as handle:
            for r in json.load(handle)["regions"]:
                if r["id"] == region:
                    bbox = r["bbox"]
    if bbox is None and REGION_CSV.exists():
        with open(REGION_CSV, encoding="utf-8") as handle:
            for r in csv.DictReader(handle):
                if r["region_id"] == region:
                    bbox = [float(r["bbox_west"]), float(r["bbox_south"]), float(r["bbox_east"]), float(r["bbox_north"])]
    if bbox is None:
        raise HTTPException(status_code=404, detail={"status": "UNAVAILABLE", "reason": "unknown region " + region + " — use bbox=west,south,east,north for any other area"})
    cells = set()
    if REGION_CELL_CSV.exists():
        with open(REGION_CELL_CSV, encoding="utf-8") as handle:
            for r in csv.DictReader(handle):
                if r["region_id"] == region and float(r["coverage_fraction"]) > 0:
                    row, col = r["cell_id"].split("_")
                    cells.add(int(row) * 3600 + int(col))
    return bbox, cells


def parse_bbox(text: str) -> list:
    """bbox query text → [W, S, E, N] floats."""
    try:
        parts = [float(x) for x in text.split(",")]
    except ValueError:
        parts = []
    if len(parts) != 4:
        raise HTTPException(status_code=422, detail={"field": "bbox", "expected": "west,south,east,north in degrees"})
    return parts


def pipeline_cells(region: str, name: str, keep, remote: dict = None) -> list:
    """Rows of a cell table the pipeline already built for this region (full archive), filtered by keep(row).
    Deployed: read from Supabase with the same filter done server-side (remote = PostgREST filters)."""
    path = pipeline_file(region, name)
    if path is None:
        if remote is None:
            return None
        return supa.region_rows(region, name.replace(".csv", ""), remote)
    out = []
    with open(path, encoding="utf-8") as handle:
        for r in csv.DictReader(handle):
            if keep(r):
                out.append(r)
    return out


def respond_cells(rows: list, meta: dict, fmt: str, filename: str):
    """JSON {data, meta} or a CSV download of the same rows."""
    if fmt == "csv":
        buf = io.StringIO()
        if rows:
            writer = csv.DictWriter(buf, fieldnames=list(rows[0].keys()))
            writer.writeheader()
            writer.writerows(rows)
        return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=" + filename, "X-Row-Count": str(len(rows))})
    return {"data": rows, "meta": meta}


def number_cell(v):
    """CSV cell → int / float / None."""
    if v in ("", "nan", None):
        return None
    f = float(v)
    if f.is_integer():
        return int(f)
    return round(f, 3)


def from_pipeline_row(r: dict, kind: str) -> dict:
    """Pipeline CSV row → the same schema the live API returns."""
    cid = int(float(r["cell_id"]))
    lat, lon = cellmod.cell_center(cid)
    base = {"cell_id": cid, "lat": lat, "lon": lon}
    if kind == "day":
        base.update({"local_date": r["local_date"][:10], "platform": r["platform"], "family": FAMILY_OF.get(r["platform"], ""), "daynight": r["daynight"], "n_detections": number_cell(r["n_detections"]), "max_frp": number_cell(r["max_frp"]), "sum_frp": number_cell(r["sum_frp"])})
    else:
        base.update({"month": r["month"], "platform": r["platform"], "family": FAMILY_OF.get(r["platform"], ""), "hotspots": number_cell(r["hotspots"]), "fire_cell_days": number_cell(r["fire_cell_days"]), "night_hotspots": number_cell(r["night_hotspots"]), "frp_sum": number_cell(r["frp_sum"]), "frp_max": number_cell(r["frp_max"]), "area_km2": number_cell(r["area_km2"])})
    return base


def cells_meta(area: dict, res: dict, start: date, end: date, kind: str) -> dict:
    """Shared meta block for the cells endpoints."""
    status = "ARCHIVE_STANDARD"
    if any(src.endswith("_NRT") for v in res.get("sources", {}).values() for src in v):
        status = "LIVE_NRT"
        if any(src.endswith("_SP") for v in res.get("sources", {}).values() for src in v):
            status = "ARCHIVE_STANDARD+NRT"
    return {
        "status": status, "provenance": "SOURCE_DERIVED", "demo": False, "kind": kind, "area": area,
        "start": start.isoformat(), "end": end.isoformat(), "data_source": "NASA FIRMS Area API (computed on request, raw chunks cached)",
        "sources_used": res.get("sources", {}), "chunks": res.get("jobs", 0), "chunks_from_cache": res.get("cached", 0),
        "detections_raw": res.get("raw", 0), "detections_kept": len(res.get("points", [])), "coverage": cellmod.coverage(start, end, res.get("failed", [])), "failed": res.get("failed", []),
        "rule": "F07 MODIS confidence ≥ 30 and type 0, VIIRS nominal/high · F01 local solar date · F03 0.1° cell · F05 cell-day",
        "null_rule": "days in failed chunks are unknown (not 0); cells with no detection are absent, not 0 rows",
        "generated_at_utc": now_utc(),
    }


def run_cells(region, bbox, start: date, end: date, kind: str, fmt: str):
    """Fast path for regions the pipeline already processed, otherwise live FIRMS for any area."""
    area = {}
    cells_set = set()
    if region:
        box, cells_set = region_area(region)
        area = {"region": region, "bbox": box, "boundary": "Natural Earth polygon cells" if cells_set else "bbox"}
        name = "cell_day.csv" if kind == "day" else "cell_month.csv"
        if kind == "day":
            keep = lambda r: start.isoformat() <= r["local_date"][:10] <= end.isoformat()
        else:
            keep = lambda r: start.strftime("%Y-%m") <= r["month"] <= end.strftime("%Y-%m")
        if kind == "day":
            remote = {"and": "(local_date.gte.%s,local_date.lte.%s)" % (start.isoformat(), end.isoformat()), "order": "local_date"}
        else:
            remote = {"and": "(month.gte.%s,month.lte.%s)" % (start.strftime("%Y-%m"), end.strftime("%Y-%m")), "order": "month"}
        rows = pipeline_cells(region, name, keep, remote)
        if rows is not None:
            data = [from_pipeline_row(r, kind) for r in rows]
            meta = {"status": "ARCHIVE_STANDARD", "provenance": "SOURCE_DERIVED", "demo": False, "kind": kind, "area": area, "start": start.isoformat(), "end": end.isoformat(),
                    "data_source": "NASA FIRMS archive, processed by the pipeline (full 2000→ record for this region)", "rows": len(data), "generated_at_utc": now_utc()}
            return respond_cells(data, meta, fmt, "cell_%s_%s_%s_%s.csv" % (kind, region, start, end))
    else:
        box = parse_bbox(bbox)
        area = {"bbox": box, "boundary": "bbox"}
    if not config.FIRMS_MAP_KEY:
        raise HTTPException(status_code=503, detail={"status": "UNAVAILABLE", "reason": "FIRMS_MAP_KEY not set"})
    try:
        res = cellmod.detections(config.FIRMS_MAP_KEY, box, start, end, cells_set)
    except cellmod.CellsError as error:
        raise HTTPException(status_code=422, detail={"status": "REFUSED", "reason": str(error)})
    if kind == "day":
        data = cellmod.cell_days(res["points"])
    else:
        data = cellmod.cell_months(res["points"])
    meta = cells_meta(area, res, start, end, kind)
    meta["rows"] = len(data)
    label = region or "bbox"
    return respond_cells(data, meta, fmt, "cell_%s_%s_%s_%s.csv" % (kind, label, start, end))


def parse_day(text: str, field: str) -> date:
    """YYYY-MM-DD → date with a clear 422."""
    try:
        return date.fromisoformat(text)
    except ValueError:
        raise HTTPException(status_code=422, detail={"field": field, "expected": "YYYY-MM-DD"})


@app.get("/api/cells/day")
def cells_day(start: str = Query(...), end: str = Query(...), region: str = Query(None), bbox: str = Query(None), format: str = Query("json", pattern="^(json|csv)$")):
    """Fire cell-days (cell × local day × platform × day/night) for any area: ?bbox=W,S,E,N or ?region=id, &start=&end= (max 31 days live)."""
    d0 = parse_day(start, "start")
    d1 = parse_day(end, "end")
    if d1 < d0:
        raise HTTPException(status_code=422, detail={"field": "end", "expected": "end ≥ start"})
    if not region and not bbox:
        raise HTTPException(status_code=422, detail={"field": "bbox", "expected": "bbox=west,south,east,north or region=id"})
    if not region and (d1 - d0).days > 30:
        raise HTTPException(status_code=422, detail={"status": "REFUSED", "reason": "at most 31 days per live request; ask month by month (answers are cached)"})
    return run_cells(region, bbox, d0, d1, "day", format)


@app.get("/api/cells/month")
def cells_month(start: str = Query(..., pattern=r"^\d{4}-\d{2}$"), end: str = Query(..., pattern=r"^\d{4}-\d{2}$"), region: str = Query(None), bbox: str = Query(None), format: str = Query("json", pattern="^(json|csv)$")):
    """Fire cell-months (cell × month × platform: hot spots, fire cell-days, FRP) for any area: ?bbox=W,S,E,N or ?region=id, &start=YYYY-MM&end=YYYY-MM."""
    y0, m0 = int(start[:4]), int(start[5:7])
    y1, m1 = int(end[:4]), int(end[5:7])
    d0 = date(y0, m0, 1)
    d1 = date(y1, m1, calmod.monthrange(y1, m1)[1])
    if d1 < d0:
        raise HTTPException(status_code=422, detail={"field": "end", "expected": "end ≥ start"})
    if not region and not bbox:
        raise HTTPException(status_code=422, detail={"field": "bbox", "expected": "bbox=west,south,east,north or region=id"})
    if d1 > date.today():
        d1 = date.today()
    return run_cells(region, bbox, d0, d1, "month", format)


@app.get("/api/chat/models")
def chat_models() -> dict:
    """AI models the assistant can use (only those with a key in backend/.env). 'auto' tries them in order."""
    from app import llm
    return {"data": [{"id": "auto", "label": "Auto · best available"}] + llm.available(), "meta": {"status": "OK"}}


@app.post("/api/chat")
def chat(body: dict) -> dict:
    """Body {question, history: [{role, content}], page, context: {...}, model: 'auto' | id}. Words only — numbers come from site data and are checked."""
    from app import llm
    question = str(body.get("question", "")).strip()
    if not question:
        raise HTTPException(status_code=422, detail={"field": "question", "expected": "a non-empty question"})
    history = body.get("history", [])
    if not isinstance(history, list):
        history = []
    result = llm.ask(question, history, {"page": body.get("page", ""), "context": body.get("context", {})}, str(body.get("model", "auto")))
    if result["data"] is None:
        raise HTTPException(status_code=503, detail=result["meta"])
    return result


@app.get("/api/context/{layer}")
def context_layer(layer: str, bbox: str = Query("-180,-90,180,90"), month: str = Query(None, pattern=r"^\d{4}-\d{2}$")) -> dict:
    """Context layer cells from Earth Engine: burned (MCD64A1 share burned), clearsky (MOD14A1/MYD14A1 clear days), landcover (WorldCover class).
    ?bbox=W,S,E,N (burned and clearsky at most 30° × 30°) &month=YYYY-MM (default: the newest month Earth Engine has for that layer)."""
    from app import context as ctx
    box = parse_bbox(bbox)
    try:
        return ctx.cells(layer, box, month)
    except ctx.ContextError as error:
        code = 422
        if "not ready" in str(error) or "not set" in str(error):
            code = 503
        raise HTTPException(status_code=code, detail={"status": "UNAVAILABLE", "reason": str(error)})
