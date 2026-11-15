# Supabase data enter — what goes into the database and how

Everything in this folder is **real data** (no demo numbers). Empty values load as `NULL`, never `0`.
Tested on 2 Nov 2026 by loading every file twice into a local Postgres 15, UTF-8 (re-running never duplicates rows),
and by running `s07_load_supabase.py` against it. PostGIS calls (`st_*`) could not be tested locally; Supabase has PostGIS built in.

## What is loaded today (tested counts)
| table | rows | how |
|---|---|---|
| reference tables (02) | region 9 · grid_cell 20,990 · region_cell 22,060 · formula 46 · satellite 5 · … | SQL files |
| region_month | 600 (25 years × sensor families, one processed region) | SQL file or s07 |
| calibration | 24 (k per calendar month, hot spots + cell-days, 95 % band) | SQL file or s07 |
| anomaly | 324 | SQL file or s07 |
| model_registry | 3 model cards | 06_models.sql |
| cell_month | 173,069 | s07 / \copy only |
| cell_day | 697,731 | s07 / \copy only |
| fire_detection | 2,433,852 NASA FIRMS archive detections | s07 / \copy only |
| fetch_log | 3,664 download chunks with SHA-256 | s07 only |

**Size:** everything = ~800 MB; without `fire_detection` = ~120 MB. Supabase's free tier is 500 MB, so on the free tier run
`s07_load_supabase.py --regions punjab_haryana --no-detections` (all aggregates, no raw points). The raw points stay in the CSV.

## What is in the folder

| file | what it loads | rows | source |
|---|---|---|---|
| `01_schema.sql` | all tables, views, read-only access rules | — | merged v2 + v3 schema |
| `02_reference_data.sql` | provenance labels, statuses, 5 satellites, products, FireMask classes, MODIS type codes, VIIRS confidence, WorldCover classes, FIRMS columns, 9 regions, data sources, 46 formulas, aliases, claim ledger, conflict log, audit checks, milestones | ~300 | `data/supabase/csv/` (NASA / FIRMS / GEE / Natural Earth facts) |
| `03_grid_cell_part1…6.sql` | 0.1° grid cells over the study regions, with area and polygon | 20,990 | computed from the grid on a sphere (R = 6371.0088 km) |
| `04_region_cell_part1…6.sql` | which cells belong to which region (share of the cell inside the Natural Earth polygon) | 22,060 | Natural Earth 10m admin-1 |
| `05_pipeline/` | fire calendar tables per region: `region_month`, `calibration` (k with 95 % band), `anomaly`, `cell_month`, `cell_day`, `fire_detection` | grows with the pipeline | NASA FIRMS archive via `pipeline/` |
| `06_models.sql` | model cards (test scores + provenance) | 1 per trained model | `ml/models/*.card.json` |
| `07_verify.sql` | read-only checks and example queries | — | — |
| `csv/` | the same data as CSV (Table Editor import or `\copy`) | — | — |
| `make_insert_sql.py` | rebuilds 02–06 from the CSVs | — | — |

`05_pipeline/` and `06_models.sql` fill up after the pipeline and the models have run. Rebuild them with:
```bash
cd "Spacecode 3 /FIREWORK"
backend/.venv/bin/python "supabase data enter/make_insert_sql.py"
```

## Way 1 — Supabase SQL Editor (no install, best for 01–04, 06)

1. Open your project at https://supabase.com/dashboard → **SQL Editor** → **New query**.
2. Open each file below in a text editor, copy everything, paste, press **Run**. Order matters (foreign keys):
   1. `01_schema.sql`
   2. `02_reference_data.sql`
   3. `03_grid_cell_part1.sql` … `03_grid_cell_part6.sql` (one at a time, each ~0.7 MB)
   4. `04_region_cell_part1.sql` … `04_region_cell_part6.sql`
   5. every file in `05_pipeline/` — for each region: `region_month`, `calibration`, `anomaly`, then `cell_month`, `cell_day`
   6. `06_models.sql`
3. Run `07_verify.sql`; the first query should show region 9, grid_cell 20990, region_cell 22060, satellite 5, formula 46.

Each `05_pipeline` table file starts with `delete from <table> where region_id = '<region>'`, so you can run it again after a new pipeline run.
**`fire_detection` is large** (hundreds of thousands of rows per region): load it with Way 2, not the SQL Editor.

## Way 2 — from your computer with the connection string (fast, best for big tables)

1. Supabase → **Project Settings → Database → Connection string → URI** (use the pooler URI). It looks like
   `postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`
2. Put it in `backend/.env` as `DATABASE_URL=...` (that file is git-ignored; never paste it in chat or a commit).
3. Schema + reference data with `psql` (installed at `/Library/PostgreSQL/15/bin/psql` on this Mac):
```bash
cd "Spacecode 3 /FIREWORK/supabase data enter"
export DATABASE_URL='postgresql://...'
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 01_schema.sql -f 02_reference_data.sql
for f in 03_grid_cell_part*.sql 04_region_cell_part*.sql 06_models.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"; done
```
4. Pipeline tables (all of them, including `fire_detection`) straight from the processed CSVs with fast COPY:
```bash
cd "Spacecode 3 /FIREWORK/pipeline"
../backend/.venv/bin/python s07_load_supabase.py --regions punjab_haryana
```
   Or one table by hand with `\copy` (columns must be listed because the CSV has extra ones):
```sql
\copy region_month (family, month, covered_days, days_in_month, hotspots, night_hotspots, frp_median, fire_cell_days, status, region_id, boundary) from 'csv/pipeline/punjab_haryana/region_month.csv' with (format csv, header true)
```

## Way 3 — Table Editor CSV import (small tables only)
Table Editor → choose the table → **Insert → Import data from CSV** → pick the file from `csv/`. Same order as Way 1.
After importing `region` and `grid_cell` this way, run the two `update ... st_geomfromewkt(geom_wkt)` lines at the end of `02_reference_data.sql` and `03_grid_cell_part6.sql`.

## Keys
- Reading (website): `SUPABASE_URL` + the **anon** key. Writing (loading): `DATABASE_URL` or the **service_role** key.
- They go only in `backend/.env`. Every table has row level security: anyone may read, only the service role writes.

## Notes on the data
- `cell_id` in pipeline tables is the integer F03 index `row × 3600 + col`; `grid_cell.cell_num` is the same number, `grid_cell.cell_id` is the text `row_col`.
- Pipeline regions are cut to the Natural Earth polygon cells in `region_cell` (a bounding box around Punjab + Haryana would also catch Pakistan's Punjab and Rajasthan).
- `cordoba_ar` has only an approximate bbox (no polygon yet), so its counts use the bbox; `region_month.boundary` says which was used.
- A hot spot is a satellite pixel, not a fire; a fire cell-day is not burned area.
- Two fixes made while testing the original v2 package: `satellite.provenance` used "OFFICIAL DOCUMENTED" (space) and failed its foreign key — it is written as `OFFICIAL_DOCUMENTED`; `formula_alias` keeps the row whose `formula_id` is `REJECT` (a rejected idea), so that column has no foreign key.
