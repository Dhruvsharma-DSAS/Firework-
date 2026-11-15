"""Persistent cache so the website never depends on a live request succeeding.

Every successful upstream response (FIRMS, CelesTrak, ...) is written to a local SQLite file (Python stdlib, no new package).
If the upstream later fails, the last good copy is served with status CACHED and its fetched_at time — never demo data.
FIRMS detections are also kept per acquisition date, so the history the site has seen keeps growing (exportable as CSV).
"""
import json
import sqlite3
import threading
from datetime import datetime, timezone

from app import config

_LOCK = threading.Lock()


def _connect() -> sqlite3.Connection:
    """Open (and create) the cache database."""
    config.CACHE_DB.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(config.CACHE_DB, timeout=30)
    conn.execute("create table if not exists api_cache (cache_key text primary key, payload text not null, status text not null, fetched_at text not null)")
    conn.execute("create table if not exists firms_chunk (chunk_key text primary key, payload text not null, fetched_at text not null, final integer not null)")
    conn.execute("create table if not exists detection_history (firms_source text not null, acq_date text not null, lat real not null, lon real not null, utc text not null, payload text not null, fetched_at text not null, primary key (firms_source, acq_date, lat, lon, utc))")
    return conn


def now_utc() -> str:
    """UTC timestamp text."""
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def save(key: str, payload: dict, status: str) -> None:
    """Remember the last good response for a request key."""
    with _LOCK, _connect() as conn:
        conn.execute("insert or replace into api_cache values (?, ?, ?, ?)", (key, json.dumps(payload), status, now_utc()))


def load(key: str) -> tuple:
    """Last good response and when it was fetched, or (None, None)."""
    with _LOCK, _connect() as conn:
        row = conn.execute("select payload, fetched_at from api_cache where cache_key = ?", (key,)).fetchone()
    if not row:
        return None, None
    return json.loads(row[0]), row[1]


def keep_detections(points: list) -> int:
    """Append FIRMS points to the growing history (duplicates ignored)."""
    stamp = now_utc()
    rows = [(p.get("firms_source", ""), p.get("date", ""), p["lat"], p["lon"], p.get("utc", ""), json.dumps(p), stamp) for p in points]
    with _LOCK, _connect() as conn:
        conn.executemany("insert or ignore into detection_history values (?, ?, ?, ?, ?, ?, ?)", rows)
    return len(rows)


def history(west: float, south: float, east: float, north: float, start: str, end: str, limit: int = 200000) -> list:
    """Stored detections inside a bbox and date range (inclusive)."""
    with _LOCK, _connect() as conn:
        rows = conn.execute("select payload from detection_history where lon between ? and ? and lat between ? and ? and acq_date between ? and ? order by acq_date limit ?", (west, east, south, north, start, end, limit)).fetchall()
    return [json.loads(r[0]) for r in rows]


def chunk_get(key: str, max_age_s: float) -> str:
    """A cached raw FIRMS chunk. Final chunks (fully in the past) never expire; recent ones expire after max_age_s."""
    with _LOCK, _connect() as conn:
        row = conn.execute("select payload, fetched_at, final from firms_chunk where chunk_key = ?", (key,)).fetchone()
    if not row:
        return None
    if row[2] == 1:
        return row[0]
    age = (datetime.now(timezone.utc) - datetime.fromisoformat(row[1])).total_seconds()
    if age <= max_age_s:
        return row[0]
    return None


def chunk_put(key: str, payload: str, final: bool) -> None:
    """Keep a raw FIRMS chunk untouched."""
    with _LOCK, _connect() as conn:
        conn.execute("insert or replace into firms_chunk values (?, ?, ?, ?)", (key, payload, now_utc(), int(final)))
