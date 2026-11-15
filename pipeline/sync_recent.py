"""Daily refresh of the whole-Earth calendar: re-count the current year (archive + near-real-time) in Earth Engine,
rebuild the calendar and push it to Supabase. Older years are not touched.

python sync_recent.py                 # current year; also last year during January (late archive revisions)
python sync_recent.py --no-supabase   # local files only
"""
import argparse
import json
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
PY = sys.executable
STATE = HERE.parent / "data" / "processed" / "global" / "ee_tasks.json"


def run(*args) -> str:
    out = subprocess.run([PY, *args], cwd=HERE, capture_output=True, text=True)
    print(out.stdout[-2000:], out.stderr[-2000:])
    if out.returncode != 0:
        raise SystemExit("failed: " + " ".join(args))
    return out.stdout


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-supabase", action="store_true")
    a = ap.parse_args()
    now = datetime.now(timezone.utc)
    years = [now.year, now.year]
    if now.month == 1:
        years = [now.year - 1, now.year]
    state = json.loads(STATE.read_text()) if STATE.exists() else {}
    for p in ["modis", "viirs", "modis_nrt", "viirs_nrt"]:
        for y in range(years[0], years[1] + 1):
            state.pop("%s_%d" % (p, y), None)
    STATE.write_text(json.dumps(state, indent=1))
    run("s09_global_calendar_ee.py", "submit", "--products", "modis", "viirs", "modis_nrt", "viirs_nrt", "--years", str(years[0]), str(years[1]))
    for _ in range(120):
        out = run("s09_global_calendar_ee.py", "status")
        if "READY" not in out and "RUNNING" not in out:
            break
        time.sleep(60)
    run("s09_global_calendar_ee.py", "collect")
    run("s10_global_calendar_build.py")
    if not a.no_supabase:
        run("s11_load_global_supabase.py")


if __name__ == "__main__":
    main()
