"""Shared helpers for the FIREWORK CHRONOS real-data pipeline.

Rules kept everywhere: raw files are never edited; missing is null, never 0;
keys come only from .env and are never printed or written to any file.
"""
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from dotenv import load_dotenv

PIPE_DIR = Path(__file__).resolve().parents[1]
ROOT_DIR = PIPE_DIR.parent
load_dotenv(PIPE_DIR / ".env")
load_dotenv(ROOT_DIR / "backend" / ".env")
if not os.environ.get("GEE_PROJECT") and os.environ.get("EE_PROJECT"):
    os.environ["GEE_PROJECT"] = os.environ["EE_PROJECT"]

DATA_DIR = Path(os.environ.get("DATA_DIR", str(PIPE_DIR / "data"))).resolve()
RAW_DIR = DATA_DIR / "raw"
PROC_DIR = DATA_DIR / "processed"
SUPA_DIR = DATA_DIR / "supabase_csv"
CELL_DEG = 0.1

FIRMS_SP_START = {"MODIS_SP": "2000-11-01", "VIIRS_SNPP_SP": "2012-01-20", "VIIRS_NOAA20_SP": "2018-04-01"}
FIRMS_NRT_SOURCES = ["MODIS_NRT", "VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT"]
PLATFORM_BY_SAT = {"T": "terra", "Terra": "terra", "A": "aqua", "Aqua": "aqua", "N": "snpp", "NPP": "snpp", "Suomi NPP": "snpp", "1": "noaa20", "N20": "noaa20", "NOAA-20": "noaa20", "2": "noaa21", "N21": "noaa21", "NOAA-21": "noaa21"}


def env(name: str, required: bool = False) -> str:
    """Read a setting from .env / environment. Never print the value."""
    value = os.environ.get(name, "").strip()
    if required and not value:
        raise SystemExit("Missing %s in pipeline/.env (see .env.example)" % name)
    return value


def mask(text: str, secret: str) -> str:
    """Replace a secret inside a string (URLs in logs) with ***."""
    if secret:
        return text.replace(secret, "***")
    return text


def region_cells(region_id: str) -> set:
    """Cell ids (F03, 0.1°) whose polygon overlaps the region, from data/supabase/csv/region_cell.csv (Natural Earth admin-1).
    Empty set when the region has no polygon there (the bbox is used instead and the output says so)."""
    path = ROOT_DIR / "data" / "supabase" / "csv" / "region_cell.csv"
    if not path.exists():
        return set()
    table = pd.read_csv(path)
    table = table[(table["region_id"] == region_id) & (table["coverage_fraction"] > 0)]
    ncols = int(round(360.0 / CELL_DEG))
    out = set()
    for text in table["cell_id"]:
        row, col = str(text).split("_")
        out.add(int(row) * ncols + int(col))
    return out


def load_regions(only: list = None) -> list:
    """Regions from regions.json; `only` filters by id."""
    regions = json.load(open(PIPE_DIR / "regions.json", encoding="utf-8"))["regions"]
    if only:
        regions = [r for r in regions if r["id"] in only]
    return regions


def now_utc() -> str:
    """UTC timestamp text."""
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def sha256_file(path: Path) -> str:
    """Checksum of a raw file (stored in the fetch log)."""
    h = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def cell_index(lat, lon, size_deg: float = CELL_DEG):
    """F03: row = floor(round((lat+90)/Δ, 9)), col = floor(round((wrap(lon)+180)/Δ, 9)), clamped; id = row * ncols + col."""
    lat = np.asarray(lat, dtype=float)
    lon = ((np.asarray(lon, dtype=float) + 180.0) % 360.0) - 180.0
    nrows = int(round(180.0 / size_deg))
    ncols = int(round(360.0 / size_deg))
    row = np.clip(np.floor(np.round((lat + 90.0) / size_deg, 9)).astype(int), 0, nrows - 1)
    col = np.clip(np.floor(np.round((lon + 180.0) / size_deg, 9)).astype(int), 0, ncols - 1)
    return row * ncols + col


def cell_center(cell, size_deg: float = CELL_DEG):
    """Inverse of F03: centre lat, lon."""
    ncols = int(round(360.0 / size_deg))
    cell = np.asarray(cell)
    return (cell // ncols + 0.5) * size_deg - 90.0, (cell % ncols + 0.5) * size_deg - 180.0


def cell_area_km2(lat_center, size_deg: float = CELL_DEG):
    """F04: A = R² Δλ (sin φ2 − sin φ1), R = 6371.0088 km."""
    r = 6371.0088
    lat1 = np.radians(np.asarray(lat_center) - size_deg / 2)
    lat2 = np.radians(np.asarray(lat_center) + size_deg / 2)
    return r * r * np.radians(size_deg) * (np.sin(lat2) - np.sin(lat1))


def cells_in_bbox(bbox: list, size_deg: float = CELL_DEG) -> pd.DataFrame:
    """All grid cells whose centre lies inside [W, S, E, N]."""
    w, s, e, n = bbox
    lats = np.arange(np.floor(s / size_deg) * size_deg + size_deg / 2, n, size_deg)
    lons = np.arange(np.floor(w / size_deg) * size_deg + size_deg / 2, e, size_deg)
    la, lo = np.meshgrid(lats[lats >= s], lons[lons >= w], indexing="ij")
    df = pd.DataFrame({"lat": la.ravel().round(4), "lon": lo.ravel().round(4)})
    df["cell_id"] = cell_index(df["lat"], df["lon"], size_deg)
    df["area_km2"] = cell_area_km2(df["lat"], size_deg)
    return df


def normalise_firms(raw: pd.DataFrame, source: str) -> pd.DataFrame:
    """FIRMS CSV (MODIS or VIIRS, archive or NRT) → one tidy schema. Confidence stays sensor-native; frp missing stays NaN."""
    out = pd.DataFrame()
    out["lat"] = pd.to_numeric(raw["latitude"], errors="coerce")
    out["lon"] = pd.to_numeric(raw["longitude"], errors="coerce")
    out["acq_date"] = pd.to_datetime(raw["acq_date"], errors="coerce")
    out["acq_time"] = pd.to_numeric(raw["acq_time"], errors="coerce").astype("Int64")
    viirs = "bright_ti4" in raw.columns
    out["sensor"] = "VIIRS" if viirs else "MODIS"
    out["brightness"] = pd.to_numeric(raw["bright_ti4"] if viirs else raw["brightness"], errors="coerce")
    out["bright_2"] = pd.to_numeric(raw["bright_ti5"] if viirs else raw["bright_t31"], errors="coerce")
    sat = raw["satellite"].astype(str).str.strip()
    out["platform"] = sat.map(PLATFORM_BY_SAT)
    if source.startswith("VIIRS_SNPP"):
        out["platform"] = "snpp"
    if source.startswith("VIIRS_NOAA20"):
        out["platform"] = "noaa20"
    if source.startswith("VIIRS_NOAA21"):
        out["platform"] = "noaa21"
    out["scan"] = pd.to_numeric(raw.get("scan"), errors="coerce")
    out["track"] = pd.to_numeric(raw.get("track"), errors="coerce")
    out["frp"] = pd.to_numeric(raw.get("frp"), errors="coerce")
    out["daynight"] = raw.get("daynight", pd.Series([None] * len(raw))).astype(str)
    out["confidence_raw"] = raw["confidence"].astype(str)
    out["version"] = raw.get("version", pd.Series([None] * len(raw))).astype(str)
    out["firms_type"] = pd.to_numeric(raw["type"], errors="coerce").astype("Int64") if "type" in raw.columns else pd.array([pd.NA] * len(raw), dtype="Int64")
    out["firms_source"] = source
    out["processing"] = "SP" if source.endswith("_SP") or source.startswith("ARCHIVE") else "NRT"
    out = out.dropna(subset=["lat", "lon", "acq_date", "acq_time"])
    hh = (out["acq_time"].astype(int) // 100) + (out["acq_time"].astype(int) % 100) / 60.0
    out["lmst"] = ((hh + out["lon"] / 15.0) % 24.0).round(3)
    shift = np.floor((hh + out["lon"] / 15.0) / 24.0)
    out["local_date"] = (out["acq_date"] + pd.to_timedelta(shift, unit="D")).dt.date
    out["cell_id"] = cell_index(out["lat"], out["lon"])
    return out
