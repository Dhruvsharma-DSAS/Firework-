"""Step 7 — load the processed CSVs into Supabase Postgres (fast COPY, idempotent per region).

python s07_load_supabase.py --regions punjab_haryana            # aggregates + detections for detail regions
python s07_load_supabase.py --regions mato_grosso --no-detections

Needs DATABASE_URL in .env (Supabase → Project Settings → Database → connection string, use the pooler URI).
Run "supabase data enter/01_schema.sql" and 02_reference_data.sql first (merged schema; sql/schema_v3.sql alone conflicts with the v2 tables). Free tier = 500 MB: raw detections are loaded only for regions with "detail": true.
For each region the rows are deleted and re-inserted, so reruns never duplicate.
"""
import argparse
import io
import json

import pandas as pd
import psycopg

from lib.common import PROC_DIR, RAW_DIR, env, load_regions

TABLES = [
    ("fire_detection", "fire_detection.csv", ["region_id", "lat", "lon", "acq_date", "acq_time", "local_date", "lmst", "sensor", "platform", "brightness", "bright_2", "scan", "track", "frp", "daynight", "confidence_raw", "version", "firms_type", "firms_source", "processing", "cell_id", "month", "family", "static_or_volcano"]),
    ("cell_day", "cell_day.csv", None),
    ("cell_month", "cell_month.csv", None),
    ("region_month", "region_month.csv", None),
    ("calibration", "calibration.csv", None),
    ("anomaly", "anomaly.csv", None),
]


def copy_df(conn, table: str, df: pd.DataFrame) -> int:
    """COPY a DataFrame (only columns that exist in the table); NaN → NULL; integer columns cast so 7.0 loads as 7."""
    info = conn.execute("select column_name, data_type from information_schema.columns where table_name = %s and is_generated = 'NEVER' and column_name not in ('id', 'created_at', 'geom')", (table,)).fetchall()
    types = dict(info)
    use = [c for c in df.columns if c in types]
    out = df[use].copy()
    for c in use:
        if types[c] in ("integer", "smallint", "bigint"):
            out[c] = pd.to_numeric(out[c], errors="coerce").round().astype("Int64")
        if types[c] == "boolean":
            out[c] = out[c].map({True: "true", False: "false", "True": "true", "False": "false"})
    buf = io.StringIO()
    out.to_csv(buf, index=False, header=False, na_rep="")
    buf.seek(0)
    with conn.cursor().copy("copy %s (%s) from stdin with (format csv, null '')" % (table, ",".join(use))) as cp:
        cp.write(buf.read())
    return len(out)


def main() -> None:
    """Upsert regions, then replace each region's rows table by table."""
    ap = argparse.ArgumentParser()
    ap.add_argument("--regions", nargs="*")
    ap.add_argument("--no-detections", action="store_true")
    args = ap.parse_args()
    url = env("DATABASE_URL", required=True)
    with psycopg.connect(url) as conn:
        for region in load_regions(args.regions):
            rid = region["id"]
            w, s, e, n = region["bbox"]
            conn.execute("insert into region (region_id, name, role, bbox_west, bbox_south, bbox_east, bbox_north, boundary_source) values (%s, %s, %s, %s, %s, %s, %s, %s) on conflict (region_id) do nothing",
                         (rid, region["name"], region["role"], w, s, e, n, region.get("note", "bbox from pipeline/regions.json")))
            if conn.execute("select 1 from pg_extension where extname = 'postgis'").fetchone():
                conn.execute("update region set geom = st_multi(st_makeenvelope(bbox_west, bbox_south, bbox_east, bbox_north, 4326)) where region_id = %s and geom is null", (rid,))
            for table, fname, _ in TABLES:
                path = PROC_DIR / rid / fname
                if not path.exists():
                    continue
                if table == "fire_detection" and (args.no_detections or not region.get("detail", True)):
                    continue
                df = pd.read_csv(path, low_memory=False)
                if "region_id" not in df.columns:
                    df["region_id"] = rid
                conn.execute("delete from %s where region_id = %%s" % table, (rid,))
                n = copy_df(conn, table, df)
                print(rid, table, n, "rows")
            man = RAW_DIR / "firms" / "manifest.csv"
            if man.exists():
                m = pd.read_csv(man)
                m = m[m["region"] == rid].rename(columns={"region": "region_id", "start": "start_date", "check": "check_note"})
                conn.execute("delete from fetch_log where region_id = %s", (rid,))
                copy_df(conn, "fetch_log", m)
            cal = PROC_DIR / rid / ("calendar_%s.json" % rid)
            if cal.exists():
                conn.execute("insert into api_cache (cache_key, payload, status, source) values (%s, %s, 'ARCHIVE_STANDARD', 'pipeline s06') on conflict (cache_key) do update set payload = excluded.payload, fetched_at = now()", ("calendar:" + rid, json.dumps(json.load(open(cal)))))
            conn.commit()


if __name__ == "__main__":
    main()
