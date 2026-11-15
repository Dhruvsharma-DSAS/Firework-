"""Step 2 — download the real FIRMS record (2000 → today) for every region, with your MAP_KEY.

python s02_firms_download.py                       # all regions in regions.json
python s02_firms_download.py --regions punjab_haryana cordoba_ar
python s02_firms_download.py --regions punjab --start 2019-10-01 --end 2019-11-30   # quick test

How it works
- Standard (science-quality) archive: MODIS_SP from 2000-11-01, VIIRS_SNPP_SP from 2012-01-20, VIIRS_NOAA20_SP from 2018-04-01.
- Recent months not yet in SP are filled with NRT sources (labelled processing = NRT, never used for calibration).
- FIRMS Area API: /api/area/csv/{KEY}/{SOURCE}/{W,S,E,N}/{DAY_RANGE}/{DATE}, DAY_RANGE ≤ 5 (live API rejects more: "Expects [1..5]").
- One file per request is saved untouched under data/raw/firms/<region>/<source>/<year>/<date>.csv.
- A manifest makes it resumable: rerun the same command and finished chunks are skipped.
- Throttle: stays under FIRMS_MAX_TRANSACTIONS_PER_10MIN (default 4000; your key allows 5000 / 10 min). A bbox request costs ~17 transactions (measured).
- Self-check: each chunk's acq_date range is compared with the requested window; a mismatch is logged as WARN.
"""
import argparse
import io
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from collections import deque
from datetime import date, datetime, timedelta
from pathlib import Path

import httpx
import pandas as pd

from lib.common import FIRMS_NRT_SOURCES, FIRMS_SP_START, RAW_DIR, env, load_regions, mask, now_utc, sha256_file

BASE = "https://firms.modaps.eosdis.nasa.gov"
DAY_RANGE = 5
TX_PER_REQUEST = 17
WORKERS = 4
LOCK = threading.Lock()
DONE_COUNT = [0]
MANIFEST = RAW_DIR / "firms" / "manifest.csv"
SENT = deque()


def availability(key: str) -> dict:
    """Max date per source from /api/data_availability (used to stop SP and start NRT)."""
    r = httpx.get(BASE + "/api/data_availability/csv/" + key + "/all", timeout=60)
    r.raise_for_status()
    table = pd.read_csv(io.StringIO(r.text))
    out = {}
    for _, row in table.iterrows():
        out[str(row.iloc[0])] = (str(row.iloc[1]), str(row.iloc[2]))
    return out


def used_transactions(key: str) -> int:
    """Transactions FIRMS has counted for this key in the current 10-minute window (mapkey_status), or -1 if unknown."""
    try:
        return int(httpx.get(BASE + "/mapserver/mapkey_status/?MAP_KEY=" + key, timeout=30).json().get("current_transactions", -1))
    except Exception:
        return -1


def throttle(limit: int, key: str = "") -> None:
    """Sliding 10-minute window. A bbox Area request costs about TX_PER_REQUEST transactions (measured 2 Nov 2026: ~4090 after ~235 requests),
    so each request is counted with that weight; every 25 requests the real count from mapkey_status is checked too."""
    with LOCK:
        throttle_locked(limit, key)


def throttle_locked(limit: int, key: str) -> None:
    """Body of throttle(), called with LOCK held so parallel workers share one window."""
    now = time.time()
    while SENT and now - SENT[0] > 600:
        SENT.popleft()
    if len(SENT) * TX_PER_REQUEST + TX_PER_REQUEST > limit:
        wait = 600 - (now - SENT[0]) + 2
        print("  throttle: waiting %.0f s to stay under %d transactions / 10 min" % (wait, limit))
        time.sleep(wait)
    if key and len(SENT) % 25 == 0:
        used = used_transactions(key)
        while used > limit - 10 * TX_PER_REQUEST:
            print("  throttle: FIRMS reports %d transactions, waiting 60 s" % used)
            time.sleep(60)
            used = used_transactions(key)
    SENT.append(time.time())


def fetch(key: str, source: str, bbox: list, start: date, days: int, limit: int) -> str:
    """One request with 4 retries (2, 4, 8, 16 s). Raises on an 'Invalid' reply."""
    area = ",".join("%.4f" % v for v in bbox)
    url = "%s/api/area/csv/%s/%s/%s/%d/%s" % (BASE, key, source, area, days, start.isoformat())
    last = None
    for attempt in range(4):
        throttle(limit, key)
        try:
            r = httpx.get(url, timeout=120)
            text = r.text
            if r.status_code == 200 and not text.startswith("Invalid") and not text.lstrip().startswith("<"):
                return text
            last = "HTTP %s %s" % (r.status_code, text[:120])
            if text.startswith("Invalid"):
                raise SystemExit("FIRMS says: " + mask(text[:200], key))
        except httpx.HTTPError as error:
            last = str(error)
        time.sleep(2 ** (attempt + 1))
    raise RuntimeError(mask("failed after retries: " + str(last), key))


def load_manifest() -> pd.DataFrame:
    """Finished chunks."""
    if MANIFEST.exists():
        return pd.read_csv(MANIFEST, dtype=str)
    return pd.DataFrame(columns=["region", "source", "start", "days", "rows", "min_date", "max_date", "sha256", "file", "fetched_at_utc", "check"])


def plan(region: dict, avail: dict, start_override: str, end_override: str) -> list:
    """List of (source, start_date, days) for the region: SP first, then NRT after the SP end."""
    today = date.today()
    end_all = date.fromisoformat(end_override) if end_override else today
    jobs = []
    sp_end = {}
    for source, sp_start in FIRMS_SP_START.items():
        s = date.fromisoformat(start_override) if start_override else date.fromisoformat(sp_start)
        s = max(s, date.fromisoformat(sp_start))
        e = end_all
        if source in avail:
            e = min(e, date.fromisoformat(avail[source][1][:10]))
        sp_end[source] = e
        d = s
        while d <= e:
            jobs.append((source, d, min(DAY_RANGE, (e - d).days + 1)))
            d = d + timedelta(days=DAY_RANGE)
    nrt_start = min(sp_end.values()) + timedelta(days=1)
    for source in FIRMS_NRT_SOURCES:
        s = nrt_start
        if source in avail:
            s = max(s, date.fromisoformat(avail[source][0][:10]))
        d = s
        while d <= end_all:
            jobs.append((source, d, min(DAY_RANGE, (end_all - d).days + 1)))
            d = d + timedelta(days=DAY_RANGE)
    return jobs


def save_chunk(region_id: str, source: str, start: date, days: int, text: str) -> None:
    """Write one raw chunk untouched and append its manifest row (dates self-checked against the requested window)."""
    folder = RAW_DIR / "firms" / region_id / source / str(start.year)
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / (start.isoformat() + ".csv")
    path.write_text(text, encoding="utf-8")
    df = pd.read_csv(io.StringIO(text)) if text.strip() else pd.DataFrame()
    rows = len(df)
    mn = mx = ""
    check = "OK"
    if rows:
        mn = str(df["acq_date"].min())
        mx = str(df["acq_date"].max())
        lo = start.isoformat()
        hi = (start + timedelta(days=days - 1)).isoformat()
        if mn < lo or mx > hi:
            check = "WARN dates %s..%s outside %s..%s" % (mn, mx, lo, hi)
    entry = {"region": region_id, "source": source, "start": start.isoformat(), "days": str(days), "rows": str(rows), "min_date": mn, "max_date": mx, "sha256": sha256_file(path), "file": str(path.relative_to(RAW_DIR)), "fetched_at_utc": now_utc(), "check": check}
    with LOCK:
        pd.DataFrame([entry]).to_csv(MANIFEST, mode="a", header=not MANIFEST.exists(), index=False)
        DONE_COUNT[0] = DONE_COUNT[0] + 1
        if DONE_COUNT[0] % 50 == 0 or check != "OK":
            print("  %s %s %s rows=%d %s (%d done)" % (region_id, source, start, rows, check, DONE_COUNT[0]), flush=True)


def main() -> None:
    """Download every planned chunk that is not in the manifest yet."""
    ap = argparse.ArgumentParser()
    ap.add_argument("--regions", nargs="*")
    ap.add_argument("--start")
    ap.add_argument("--end")
    args = ap.parse_args()
    key = env("FIRMS_MAP_KEY", required=True)
    limit = int(env("FIRMS_MAX_TRANSACTIONS_PER_10MIN") or 4000)
    avail = availability(key)
    print("FIRMS availability:", {k: v for k, v in avail.items()})
    manifest = load_manifest()
    done = set(zip(manifest["region"], manifest["source"], manifest["start"]))
    covered = set()
    for _, r in manifest.iterrows():
        for i in range(int(r["days"])):
            covered.add((r["region"], r["source"], (date.fromisoformat(r["start"]) + timedelta(days=i)).isoformat()))
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    for region in load_regions(args.regions):
        jobs = []
        for j in plan(region, avail, args.start, args.end):
            window = [(region["id"], j[0], (j[1] + timedelta(days=i)).isoformat()) for i in range(j[2])]
            if (region["id"], j[0], j[1].isoformat()) in done or all(w in covered for w in window):
                continue
            jobs.append(j)
        print("%s: %d chunks to fetch" % (region["id"], len(jobs)))
        def run(job: tuple) -> None:
            source, start, days = job
            text = fetch(key, source, region["bbox"], start, days, limit)
            save_chunk(region["id"], source, start, days, text)

        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            list(pool.map(run, jobs))
    print("done. Manifest:", MANIFEST)


if __name__ == "__main__":
    main()
