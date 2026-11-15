"""Step 1 — check every key and service before downloading anything.

python s01_check_access.py
Prints OK / MISSING / FAILED for: FIRMS key status, FIRMS data availability, Earth Engine, Open-Meteo, NASA POWER, Supabase.
"""
import io

import httpx
import pandas as pd

from lib.common import env, mask

FIRMS = "https://firms.modaps.eosdis.nasa.gov"


def check_firms(key: str) -> list:
    """MAP_KEY status (transactions used in the last 10 min) and the date range each source has."""
    rows = []
    if not key:
        return [("FIRMS_MAP_KEY", "MISSING", "add it to .env")]
    try:
        r = httpx.get(FIRMS + "/mapserver/mapkey_status/?MAP_KEY=" + key, timeout=30)
        rows.append(("FIRMS key status", "OK" if r.status_code == 200 else "FAILED", mask(r.text[:200], key)))
    except Exception as error:
        rows.append(("FIRMS key status", "FAILED", mask(str(error), key)))
    try:
        r = httpx.get(FIRMS + "/api/data_availability/csv/" + key + "/all", timeout=30)
        table = pd.read_csv(io.StringIO(r.text))
        rows.append(("FIRMS data availability", "OK", "; ".join("%s %s→%s" % (a, b, c) for a, b, c in table.iloc[:, :3].values)))
    except Exception as error:
        rows.append(("FIRMS data availability", "FAILED", mask(str(error), key)))
    return rows


def check_gee(project: str) -> tuple:
    """Earth Engine: needs `earthengine authenticate` once on this machine."""
    if not project:
        return ("GEE_PROJECT", "MISSING", "add it to .env")
    try:
        import ee
        ee.Initialize(project=project)
        n = ee.ImageCollection("MODIS/061/MOD14A1").filterDate("2024-11-01", "2024-11-03").size().getInfo()
        return ("Earth Engine", "OK", "MOD14A1 images for 1–2 Nov 2024: %s" % n)
    except Exception as error:
        return ("Earth Engine", "FAILED", str(error)[:200] + " → run: earthengine authenticate")


def check_url(name: str, url: str) -> tuple:
    """Simple GET check for keyless services."""
    try:
        r = httpx.get(url, timeout=30)
        return (name, "OK" if r.status_code == 200 else "FAILED", "HTTP %s" % r.status_code)
    except Exception as error:
        return (name, "FAILED", str(error)[:150])


def check_db(url: str) -> tuple:
    """Supabase Postgres connection (DATABASE_URL)."""
    if not url:
        return ("DATABASE_URL", "MISSING", "optional until step 7")
    try:
        import psycopg
        with psycopg.connect(url, connect_timeout=10) as conn:
            version = conn.execute("select version()").fetchone()[0]
        return ("Supabase Postgres", "OK", version[:60])
    except Exception as error:
        return ("Supabase Postgres", "FAILED", str(error)[:150])


def main() -> None:
    """Run all checks and print a table."""
    key = env("FIRMS_MAP_KEY")
    rows = check_firms(key)
    rows.append(check_gee(env("GEE_PROJECT")))
    rows.append(check_url("Open-Meteo archive", "https://archive-api.open-meteo.com/v1/archive?latitude=30.9&longitude=75.85&start_date=2024-11-01&end_date=2024-11-02&daily=temperature_2m_max"))
    rows.append(check_url("NASA POWER", "https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M&community=AG&longitude=75.85&latitude=30.9&start=20241101&end=20241102&format=JSON"))
    rows.append(check_url("CelesTrak", "https://celestrak.org/NORAD/elements/gp.php?CATNR=25994&FORMAT=TLE"))
    rows.append(check_db(env("DATABASE_URL")))
    for name, status, detail in rows:
        print("%-26s %-8s %s" % (name, status, detail))


if __name__ == "__main__":
    main()
