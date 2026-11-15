"""Shared helpers for the FIREWORK CHRONOS ML pipeline. Reads FIRMS archive/NRT CSVs into one tidy table."""
import json
import math
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

ML_DIR = Path(__file__).resolve().parent
ROOT = ML_DIR.parent
DATA_DIR = ML_DIR / "data"
MODELS_DIR = ML_DIR / "models"
OUT_DIR = ML_DIR / "out"
PROCESSED_DIR = ROOT / "data" / "processed"

PLATFORM_BY_SATELLITE = {
    "T": "terra", "Terra": "terra", "A": "aqua", "Aqua": "aqua",
    "N": "snpp", "NPP": "snpp", "Suomi NPP": "snpp", "1": "noaa20", "N20": "noaa20", "NOAA-20": "noaa20",
    "2": "noaa21", "N21": "noaa21", "NOAA-21": "noaa21",
}


def local_solar_hour(utc_hhmm: pd.Series, lon: pd.Series) -> pd.Series:
    """F01: local solar hour = (UTC hour + lon / 15) mod 24."""
    hhmm = utc_hhmm.astype(int)
    utc_hour = (hhmm // 100) + (hhmm % 100) / 60.0
    return (utc_hour + lon / 15.0) % 24.0


def cell_index(lat: pd.Series, lon: pd.Series, size_deg: float) -> pd.Series:
    """F03: cell = floor(round((lat+90)/size, 6)) * ncols + floor(round((lon+180)/size, 6)). Rounding first stops 0.1 float errors."""
    ncols = int(round(360.0 / size_deg))
    nrows = int(round(180.0 / size_deg))
    row = np.floor(np.round((lat + 90.0) / size_deg, 6)).astype(int).clip(0, nrows - 1)
    col = np.floor(np.round((lon + 180.0) / size_deg, 6)).astype(int).clip(0, ncols - 1)
    return row * ncols + col


def cell_center(cell: pd.Series, size_deg: float) -> tuple:
    """Inverse of F03: centre lat/lon of a cell."""
    ncols = int(round(360.0 / size_deg))
    row = cell // ncols
    col = cell % ncols
    return (row + 0.5) * size_deg - 90.0, (col + 0.5) * size_deg - 180.0


def read_firms_csv(path: Path) -> pd.DataFrame:
    """Normalise a FIRMS CSV (MODIS or VIIRS, archive or NRT) to: lat, lon, date, utc, sensor, platform, frp, bright, bright2, scan, track, dn, conf, type, lmst, local_date."""
    raw = pd.read_csv(path)
    out = pd.DataFrame()
    out["lat"] = raw["latitude"].astype(float)
    out["lon"] = raw["longitude"].astype(float)
    out["date"] = pd.to_datetime(raw["acq_date"])
    out["utc"] = raw["acq_time"].astype(int)
    if "bright_ti4" in raw.columns:
        out["sensor"] = "VIIRS"
        out["bright"] = raw["bright_ti4"].astype(float)
        out["bright2"] = raw["bright_ti5"].astype(float)
    else:
        out["sensor"] = "MODIS"
        out["bright"] = raw["brightness"].astype(float)
        out["bright2"] = raw["bright_t31"].astype(float)
    out["platform"] = raw["satellite"].astype(str).map(PLATFORM_BY_SATELLITE).fillna("unknown")
    out["frp"] = raw["frp"].astype(float)
    out["scan"] = raw["scan"].astype(float)
    out["track"] = raw["track"].astype(float)
    out["dn"] = raw["daynight"].astype(str)
    out["conf"] = raw["confidence"].astype(str)
    if "type" in raw.columns:
        out["type"] = raw["type"]
    else:
        out["type"] = np.nan
    out["lmst"] = local_solar_hour(out["utc"], out["lon"])
    utc_hours = (out["utc"] // 100) + (out["utc"] % 100) / 60.0
    shift_days = np.floor((utc_hours + out["lon"] / 15.0) / 24.0)
    out["local_date"] = out["date"] + pd.to_timedelta(shift_days, unit="D")
    return out


def read_many(paths: list) -> pd.DataFrame:
    """Concatenate several FIRMS CSVs."""
    frames = [read_firms_csv(Path(p)) for p in paths]
    return pd.concat(frames, ignore_index=True)


def now_utc() -> str:
    """Current UTC time as ISO text."""
    return datetime.now(timezone.utc).isoformat()


def write_json(path: Path, payload: dict) -> None:
    """Write JSON with NaN turned into null (missing is never zero)."""
    path.parent.mkdir(parents=True, exist_ok=True)

    def clean(value):
        if isinstance(value, float):
            if math.isnan(value) or math.isinf(value):
                return None
            return value
        if isinstance(value, dict):
            return {k: clean(v) for k, v in value.items()}
        if isinstance(value, list):
            return [clean(v) for v in value]
        if isinstance(value, (np.floating,)):
            return clean(float(value))
        if isinstance(value, (np.integer,)):
            return int(value)
        return value

    with open(path, "w", encoding="utf-8") as handle:
        json.dump(clean(payload), handle, indent=1)
