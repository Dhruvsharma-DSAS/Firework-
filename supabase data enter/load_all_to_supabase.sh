#!/bin/bash
# Loads everything in this folder into your Supabase database, in the right order.
# Needs: DATABASE_URL=... (Supabase "Connect" -> Session pooler URI with your password) in FIREWORK/backend/.env
# Run on your Mac:  bash "supabase data enter/load_all_to_supabase.sh"
# Safe to re-run. Raw fire_detection (2.4 M rows, ~680 MB) is NOT loaded: it does not fit the free 500 MB tier.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$HERE")"
PSQL=/Library/PostgreSQL/15/bin/psql
if [ ! -x "$PSQL" ]; then PSQL="$(command -v psql || true)"; fi
if [ -z "$PSQL" ]; then echo "psql not found. Install PostgreSQL client (brew install libpq) and try again."; exit 1; fi
ENV_FILE="$ROOT/backend/.env"
DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//')"
if [ -z "$DATABASE_URL" ]; then echo "No DATABASE_URL in $ENV_FILE — add it first (never paste it in chat)."; exit 1; fi
export PGCONNECT_TIMEOUT=20
run() { echo "→ loading $1"; "$PSQL" "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f "$HERE/$1" > /dev/null; }

echo "1/6 testing connection"; "$PSQL" "$DATABASE_URL" -tAc "select 'connected to ' || current_database()"
echo "2/6 schema + reference data"; run 01_schema.sql; run 02_reference_data.sql
echo "3/6 grid cells and region cells (12 files)"
for f in 03_grid_cell_part1.sql 03_grid_cell_part2.sql 03_grid_cell_part3.sql 03_grid_cell_part4.sql 03_grid_cell_part5.sql 03_grid_cell_part6.sql \
         04_region_cell_part1.sql 04_region_cell_part2.sql 04_region_cell_part3.sql 04_region_cell_part4.sql 04_region_cell_part5.sql 04_region_cell_part6.sql; do run "$f"; done
echo "4/6 fire calendar tables (region_month, calibration, anomaly) + model cards"
for f in 05_pipeline/*_region_month*.sql 05_pipeline/*_calibration*.sql 05_pipeline/*_anomaly*.sql; do [ -f "$HERE/$f" ] && run "$f"; done
run 06_models.sql
echo "5/6 cell_month + cell_day (fast COPY, no raw detections)"
if [ -f "$ROOT/pipeline/s07_load_supabase.py" ] && [ -x "$ROOT/backend/.venv/bin/python" ]; then
  (cd "$ROOT/pipeline" && DATABASE_URL="$DATABASE_URL" "$ROOT/backend/.venv/bin/python" s07_load_supabase.py --regions punjab_haryana --no-detections)
else
  echo "   skipped: pipeline/s07_load_supabase.py or backend/.venv not found — ask Claude Code to run it"
fi
echo "6/6 checks"
"$PSQL" "$DATABASE_URL" -f "$HERE/07_verify.sql" 2>&1 | head -30
"$PSQL" "$DATABASE_URL" -tAc "select 'database size: ' || pg_size_pretty(pg_database_size(current_database()))"
echo "Done. Expected: region 9, grid_cell 20990, region_cell 22060, satellite 5, formula 46."
