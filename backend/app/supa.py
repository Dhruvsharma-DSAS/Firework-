"""Read-only Supabase (PostgREST) client: the deployed backend's data source when pipeline files are not on disk.

Uses SUPABASE_URL + SUPABASE_ANON_KEY (public read is enough: every table has a "public read" RLS policy),
or SUPABASE_SERVICE_KEY when no anon key is set. Keys stay on the server; nothing here writes.
"""
import os
import time

import httpx

PAGE = 1000
_CACHE = {}


def base() -> str:
    """Project URL, or '' when Supabase is not configured."""
    return os.environ.get("SUPABASE_URL", "").strip().rstrip("/")


def key() -> str:
    """Read key: anon if set, otherwise service role."""
    return os.environ.get("SUPABASE_ANON_KEY", "").strip() or os.environ.get("SUPABASE_SERVICE_KEY", "").strip()


def enabled() -> bool:
    """True when the backend can read from Supabase."""
    return bool(base() and key())


def select(table: str, params: dict, max_rows: int = 200000, ttl: float = 600) -> list:
    """All rows matching PostgREST filters (paged 1,000 at a time), cached for ttl seconds."""
    if not enabled():
        return None
    cache_key = table + "?" + "&".join("%s=%s" % kv for kv in sorted(params.items()))
    hit = _CACHE.get(cache_key)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    headers = {"apikey": key(), "Authorization": "Bearer " + key()}
    rows = []
    start = 0
    while start < max_rows:
        h = dict(headers, **{"Range-Unit": "items", "Range": "%d-%d" % (start, start + PAGE - 1)})
        r = httpx.get(base() + "/rest/v1/" + table, params=params, headers=h, timeout=60)
        if r.status_code not in (200, 206):
            raise RuntimeError("Supabase %s: HTTP %s %s" % (table, r.status_code, r.text[:120]))
        batch = r.json()
        rows.extend(batch)
        if len(batch) < PAGE:
            break
        start = start + PAGE
    _CACHE[cache_key] = (time.time(), rows)
    return rows


def region_rows(region: str, table: str, extra: dict = None) -> list:
    """Rows of one region's table, or None when Supabase is off / has none."""
    params = {"select": "*", "region_id": "eq." + region}
    if extra:
        params.update(extra)
    try:
        rows = select(table, params)
    except Exception:
        return None
    if not rows:
        return None
    return rows


def regions_with(table: str) -> set:
    """Region ids that have at least one row in a table (cached 10 min)."""
    if not enabled():
        return set()
    out = set()
    try:
        for r in select("region", {"select": "region_id"}):
            rows = select(table, {"select": "region_id", "region_id": "eq." + r["region_id"], "limit": "1"})
            if rows:
                out.add(r["region_id"])
    except Exception:
        return set()
    return out
