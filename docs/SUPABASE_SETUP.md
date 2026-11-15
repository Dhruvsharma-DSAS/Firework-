# Whole-Earth calendar · data pipeline and Supabase setup

## What it does
NASA's daily fire-mask products are counted per 0.1° cell and per country inside Google Earth Engine.
Only the per-country monthly totals leave Google (kilobytes, not the ~6.6 GB FIRMS archive).

| product | Earth Engine collection | covers | role |
|---|---|---|---|
| MODIS Terra | `MODIS/061/MOD14A1` | 24 Feb 2000 → about 2 weeks ago | archive fire mask + valid view |
| MODIS Aqua | `MODIS/061/MYD14A1` | 4 Jul 2002 → about 2 weeks ago | archive fire mask + valid view |
| VIIRS S-NPP | `NASA/VIIRS/002/VNP14A1` | 19 Jan 2012 → 2 Nov 2026 (S-NPP new data ended) | archive fire mask + valid view |
| MODIS NRT | `FIRMS` | rolling, ~1 day latency | days after the MODIS archive ends |
| VIIRS NOAA-20 NRT | `NASA/LANCE/NOAA20_VIIRS/C2` | from 2023-10, ~1 day latency | days after the S-NPP archive ends |

Rules: fire = FireMask 8–9 (nominal / high); valid view = FireMask 3, 5, 7, 8, 9; NRT fire = FIRMS MODIS confidence ≥ 30,
NOAA-20 class ≥ 1. A month is `ok`, `partial` (fewer product days) or `nrt` (includes near-real-time days, no valid-view mask).
Missing = no row / null, never 0.

## Steps
```bash
cd pipeline
python s09_global_calendar_ee.py submit --products modis viirs modis_nrt viirs_nrt --years 2000 2026   # ~44 Earth Engine tasks
python s09_global_calendar_ee.py status
python s09_global_calendar_ee.py collect            # -> data/processed/global/country_monthly_ee.csv
python s10_global_calendar_build.py                 # -> calendar_global.json, data/exports/, data/manifests/
python verify_global.py --countries Nepal Portugal --years 2015 2021   # independent FIRMS recount
python s11_load_global_supabase.py                  # -> Supabase (needs the migration below)
```

## Supabase (once)
Open the Supabase dashboard → SQL editor → paste and run `supabase/migrations/20261105000000_global_calendar.sql`.
It creates `global_calendar_monthly`, `global_calibration`, `global_ingestion_jobs` with row level security:
anyone can read, only the service role (server-side pipeline) can write. Never put the service key in the frontend.

## Daily automatic update
`.github/workflows/calendar-sync.yml` runs `pipeline/sync_recent.py` every day at 06:30 UTC: it re-counts the current year
(archive + NRT), rebuilds the calendar, upserts Supabase and commits the refreshed files (Render and Vercel redeploy).
Add these repository secrets (GitHub → Settings → Secrets and variables → Actions):

| secret | value |
|---|---|
| `EARTHENGINE_TOKEN` | contents of `~/.config/earthengine/credentials` |
| `GEE_PROJECT` | your Earth Engine cloud project id |
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_KEY` | service-role key (server only) |

## Website
`/api/calendar/world` and `/api/calendar/c_<fips>` serve the calendar; `/api/calendar_regions` lists every country.
The Calendar page has a country picker; the month inspector shows valid-view exposure, k with its band and pooling weight,
and MONTH TO DATE / near-real-time status.
