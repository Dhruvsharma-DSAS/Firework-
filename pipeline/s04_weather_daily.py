"""Step 4 — daily weather (no key): Open-Meteo historical archive (ERA5-based), NASA POWER as backup.

python s04_weather_daily.py --regions punjab_haryana --start 2000-01-01
Points: the region centre plus a coarse 1° grid inside the bbox (max 25 points per region).
Saved untouched per point: data/raw/weather/<region>/<source>_<lat>_<lon>.csv
Daily variables (Open-Meteo names): temperature_2m_max, temperature_2m_min, precipitation_sum, wind_speed_10m_max,
relative_humidity_2m_mean, et0_fao_evapotranspiration, vapour_pressure_deficit_max.
Weather is context for models, never a fire label. Open-Meteo is free for non-commercial use; be polite (1 request / 2 s).
"""
import argparse
import io
import time
from datetime import date

import httpx
import numpy as np
import pandas as pd

from lib.common import RAW_DIR, load_regions

OM = "https://archive-api.open-meteo.com/v1/archive"
POWER = "https://power.larc.nasa.gov/api/temporal/daily/point"
DAILY = "temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,relative_humidity_2m_mean,et0_fao_evapotranspiration,vapour_pressure_deficit_max"


def points(bbox: list, max_points: int = 25) -> list:
    """Centre + 1° grid points inside the bbox."""
    w, s, e, n = bbox
    pts = [((s + n) / 2, (w + e) / 2)]
    for la in np.arange(np.ceil(s) + 0.5, n, 1.0):
        for lo in np.arange(np.ceil(w) + 0.5, e, 1.0):
            pts.append((float(la), float(lo)))
    return [(round(a, 2), round(b, 2)) for a, b in pts[:max_points]]


def open_meteo(lat: float, lon: float, start: str, end: str) -> pd.DataFrame:
    """One point, full date range, timezone GMT."""
    r = httpx.get(OM, params={"latitude": lat, "longitude": lon, "start_date": start, "end_date": end, "daily": DAILY, "timezone": "GMT"}, timeout=300)
    r.raise_for_status()
    d = r.json()["daily"]
    return pd.DataFrame(d)


def nasa_power(lat: float, lon: float, start: str, end: str) -> pd.DataFrame:
    """Backup: NASA POWER daily point (T2M_MAX, T2M_MIN, PRECTOTCORR, WS10M_MAX, RH2M)."""
    r = httpx.get(POWER, params={"parameters": "T2M_MAX,T2M_MIN,PRECTOTCORR,WS10M_MAX,RH2M", "community": "AG", "latitude": lat, "longitude": lon, "start": start.replace("-", ""), "end": end.replace("-", ""), "format": "CSV", "header": "false"}, timeout=300)
    r.raise_for_status()
    df = pd.read_csv(io.StringIO(r.text))
    return df.replace(-999, np.nan)


def main() -> None:
    """Download each point once; Open-Meteo first, NASA POWER if it fails."""
    ap = argparse.ArgumentParser()
    ap.add_argument("--regions", nargs="*")
    ap.add_argument("--start", default="2000-01-01")
    ap.add_argument("--end", default=None)
    args = ap.parse_args()
    end = args.end or (date.today().replace(day=1).isoformat())
    for region in load_regions(args.regions):
        folder = RAW_DIR / "weather" / region["id"]
        folder.mkdir(parents=True, exist_ok=True)
        for lat, lon in points(region["bbox"]):
            out = folder / ("openmeteo_%s_%s.csv" % (lat, lon))
            if out.exists():
                continue
            try:
                df = open_meteo(lat, lon, args.start, end)
                df.to_csv(out, index=False)
            except Exception as error:
                print("Open-Meteo failed", lat, lon, str(error)[:100], "→ NASA POWER")
                df = nasa_power(lat, lon, args.start, end)
                df.to_csv(folder / ("power_%s_%s.csv" % (lat, lon)), index=False)
            print(region["id"], lat, lon, len(df), "days")
            time.sleep(2)


if __name__ == "__main__":
    main()
