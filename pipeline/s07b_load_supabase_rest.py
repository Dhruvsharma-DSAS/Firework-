"""Step 7b — load processed tables into Supabase through its REST API (no database password needed).

python s07b_load_supabase_rest.py --regions punjab_haryana --tables cell_day fetch_log
python s07b_load_supabase_rest.py --regions punjab_haryana                      # all aggregate tables

Needs SUPABASE_URL and SUPABASE_SERVICE_KEY in backend/.env (service role: it bypasses row level security, keep it secret).
Rows are upserted in batches with "ignore duplicates" on each table's primary / unique key, so reruns and half-finished
loads are safe: existing rows are kept, missing rows are added. Empty cells become NULL, never 0.
Raw fire_detection is skipped unless --with-detections (it does not fit the free 500 MB tier).
"""
import argparse
import math
import time

import httpx
import pandas as pd

from lib.common import PROC_DIR, RAW_DIR, env, load_regions

BATCH = 2000
TABLES = {
    "region_month": {"file": "region_month.csv", "conflict": "region_id,month,family"},
    "calibration": {"file": "calibration.csv", "conflict": "region_id,metric,calendar_month"},
    "anomaly": {"file": "anomaly.csv", "conflict": "region_id,month"},
    "cell_month": {"file": "cell_month.csv", "conflict": "region_id,cell_id,month,platform"},
    "cell_day": {"file": "cell_day.csv", "conflict": "region_id,cell_id,local_date,platform,daynight"},
    "fetch_log": {"file": None, "conflict": "region_id,source,start_date"},
    "fire_detection": {"file": "fire_detection.csv", "conflict": "lat,lon,acq_date,acq_time,platform"},
}
INTS = {"cell_id", "hotspots", "fire_cell_days", "night_hotspots", "n_detections", "covered_days", "days_in_month", "n_ref", "n_overlap_years", "calendar_month", "days", "rows", "acq_time", "firms_type"}


def columns_of(url: str, headers: dict, table: str) -> list:
    """Column names Supabase exposes for a table (from the REST OpenAPI description)."""
    r = httpx.get(url + "/rest/v1/", headers=headers, timeout=60)
    r.raise_for_status()
    props = r.json().get("definitions", {}).get(table, {}).get("properties", {})
    return [c for c in props if c not in ("id", "geom", "created_at")]


def clean(value, column: str):
    """CSV value → JSON value: NaN/'' → None, integer columns → int, booleans kept."""
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    if isinstance(value, str) and value in ("", "nan", "<NA>"):
        return None
    if column in INTS:
        return int(round(float(value)))
    if isinstance(value, (bool,)):
        return value
    if hasattr(value, "item"):
        return value.item()
    return value


def frame_for(table: str, rid: str) -> pd.DataFrame:
    """The processed table of one region as a DataFrame (fetch_log comes from the download manifest)."""
    if table == "fetch_log":
        path = RAW_DIR / "firms" / "manifest.csv"
        if not path.exists():
            return pd.DataFrame()
        m = pd.read_csv(path, dtype=str)
        m = m[m["region"] == rid].rename(columns={"region": "region_id", "start": "start_date", "check": "check_note"})
        return m
    path = PROC_DIR / rid / TABLES[table]["file"]
    if not path.exists():
        return pd.DataFrame()
    df = pd.read_csv(path, low_memory=False)
    df["region_id"] = rid
    return df


def post(url: str, headers: dict, table: str, conflict: str, rows: list) -> None:
    """Upsert one batch, ignoring rows whose key already exists. Retries 4 times."""
    last = None
    for attempt in range(4):
        try:
            r = httpx.post(url + "/rest/v1/" + table + "?on_conflict=" + conflict, headers=headers, json=rows, timeout=120)
            if r.status_code in (200, 201, 204):
                return
            last = "HTTP %s %s" % (r.status_code, r.text[:200])
        except httpx.HTTPError as error:
            last = str(error)
        time.sleep(2 ** (attempt + 1))
    raise SystemExit("load failed for %s: %s" % (table, last))


def main() -> None:
    """Load each requested table for each region."""
    ap = argparse.ArgumentParser()
    ap.add_argument("--regions", nargs="*")
    ap.add_argument("--tables", nargs="*", default=["region_month", "calibration", "anomaly", "cell_month", "cell_day", "fetch_log"])
    ap.add_argument("--with-detections", action="store_true")
    args = ap.parse_args()
    url = env("SUPABASE_URL", required=True).rstrip("/")
    key = env("SUPABASE_SERVICE_KEY", required=True)
    base = {"apikey": key, "Authorization": "Bearer " + key}
    write = dict(base, **{"Content-Type": "application/json", "Prefer": "resolution=ignore-duplicates,return=minimal"})
    tables = list(args.tables)
    if args.with_detections and "fire_detection" not in tables:
        tables.append("fire_detection")
    for region in load_regions(args.regions):
        rid = region["id"]
        for table in tables:
            df = frame_for(table, rid)
            if df.empty:
                print(rid, table, "nothing to load")
                continue
            cols = [c for c in columns_of(url, base, table) if c in df.columns]
            records = df[cols].to_dict("records")
            t0 = time.time()
            for i in range(0, len(records), BATCH):
                batch = [{c: clean(r[c], c) for c in cols} for r in records[i:i + BATCH]]
                post(url, write, table, TABLES[table]["conflict"], batch)
                done = min(i + BATCH, len(records))
                if (i // BATCH) % 25 == 0 or done == len(records):
                    print("%s %s %d / %d rows (%.0f s)" % (rid, table, done, len(records), time.time() - t0), flush=True)
            count = httpx.get(url + "/rest/v1/" + table + "?select=region_id&region_id=eq." + rid, headers=dict(base, **{"Prefer": "count=exact", "Range": "0-0"}), timeout=60)
            print(rid, table, "now in Supabase:", count.headers.get("content-range", "?"), flush=True)


if __name__ == "__main__":
    main()
