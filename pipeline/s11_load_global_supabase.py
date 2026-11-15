"""Step 11 — upsert the whole-Earth calendar (step 10 outputs) into Supabase over REST.

python s11_load_global_supabase.py

Needs SUPABASE_URL and SUPABASE_SERVICE_KEY (environment or backend/.env) and the tables from
supabase/migrations/20261105000000_global_calendar.sql. Upserts are idempotent (merge on primary key).
"""
import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path

import httpx
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
BATCH = 1000


def env(name: str) -> str:
    if os.environ.get(name):
        return os.environ[name]
    path = ROOT / "backend" / ".env"
    if path.exists():
        for line in open(path, encoding="utf-8"):
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip()
    return ""


def clean(v):
    if v is None:
        return None
    if isinstance(v, float) and math.isnan(v):
        return None
    return v


def upsert(url: str, key: str, table: str, rows: list, conflict: str) -> int:
    h = {"apikey": key, "Authorization": "Bearer " + key, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"}
    done = 0
    for i in range(0, len(rows), BATCH):
        r = httpx.post(url + "/rest/v1/" + table + "?on_conflict=" + conflict, headers=h, content=json.dumps(rows[i:i + BATCH]), timeout=120)
        if r.status_code >= 300:
            raise SystemExit("%s: HTTP %d %s" % (table, r.status_code, r.text[:300]))
        done += len(rows[i:i + BATCH])
    return done


def main() -> None:
    url, key = env("SUPABASE_URL"), env("SUPABASE_SERVICE_KEY")
    if not url or not key:
        raise SystemExit("SUPABASE_URL / SUPABASE_SERVICE_KEY missing")
    payload = json.loads((ROOT / "data" / "processed" / "global" / "calendar_global.json").read_text())
    gen = payload["meta"]["generated_at_utc"]
    ex = pd.read_csv(ROOT / "data" / "exports" / "calendar_country_monthly.csv", keep_default_na=False, na_values=[""])
    rows = [{k: clean(v) for k, v in r.items()} | {"generated_at_utc": gen} for r in ex.to_dict("records")]
    for r in rows:
        for k in ("year", "month", "product_days"):
            r[k] = int(r[k])
    n1 = upsert(url, key, "global_calendar_monthly", rows, "region_id,sensor,year,month")
    method = "ratio of totals per calendar month 2012-2025, year-block bootstrap 95 %, empirical Bayes pooled toward World"
    cal = []
    for rid, r in payload["regions"].items():
        for mo, k in r["k_baseline"].items():
            cal.append({"region_id": rid, "calendar_month": int(mo), "k": k["k"], "k_lo95": k["lo"], "k_hi95": k["hi"], "k_raw": k["k_raw"], "n_overlap_years": k["n_years"], "pool_weight": k["pool_weight"], "method": method, "generated_at_utc": gen})
    n2 = upsert(url, key, "global_calibration", cal, "region_id,calendar_month")
    job = [{"kind": "load_global_calendar", "finished_at_utc": datetime.now(timezone.utc).isoformat(), "ok": True, "detail": {"calendar_rows": n1, "calibration_rows": n2, "latest_month_per_product": payload["meta"].get("latest_month_per_product")}}]
    h = {"apikey": key, "Authorization": "Bearer " + key, "Content-Type": "application/json", "Prefer": "return=minimal"}
    httpx.post(url + "/rest/v1/global_ingestion_jobs", headers=h, content=json.dumps(job), timeout=60)
    print("upserted", n1, "calendar rows,", n2, "calibration rows")


if __name__ == "__main__":
    main()
