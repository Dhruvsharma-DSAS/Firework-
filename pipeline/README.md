# FIREWORK CHRONOS — real-data pipeline

Turns your keys into real, stored data: 25 years of NASA FIRMS hot spots, Earth Engine clear-sky days, weather, vegetation and burned area,
into tables the website and the ML models read. Nothing here is simulated (except `tests/make_fake_raw.py`, used only by tests).

## Run it (your laptop or Google Colab)
```bash
cd pipeline
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env            # put FIRMS_MAP_KEY and GEE_PROJECT in .env — never commit it
earthengine authenticate        # once per machine
python s01_check_access.py      # every row should say OK
python s02_firms_download.py --regions punjab --start 2019-10-01 --end 2019-11-30   # 1-minute test
python run_all.py --regions punjab_haryana cordoba_ar california new_south_wales   # full run, resumable
```
No terminal? Open `notebooks/FIREWORK_pipeline_colab.ipynb` in Google Colab — same steps in the browser.

## Steps
| step | script | needs | writes |
|---|---|---|---|
| 1 | s01_check_access.py | keys | a status table |
| 2 | s02_firms_download.py | FIRMS_MAP_KEY | data/raw/firms/<region>/<source>/<year>/<date>.csv + manifest.csv |
| 2b | s02b_firms_country_yearly.py | nothing | yearly country CSVs (global studies) |
| 3 | s03_gee_monthly.py (+ `--static` once) | GEE_PROJECT | data/raw/gee/<region>/monthly_<year>.csv, static_landcover.csv |
| 4 | s04_weather_daily.py | nothing | data/raw/weather/<region>/*.csv |
| 5 | s05_build_tables.py | steps 2 (+3) | data/processed/<region>/fire_detection, cell_day, cell_month, region_month, coverage |
| 6 | s06_harmonise.py | step 5 | calibration.csv, calendar_<region>.json, anomaly.csv |
| 7 | s07_load_supabase.py | DATABASE_URL + sql/schema_v3.sql | Supabase tables |
| 8 | s08_train_models.py | steps 2, 5, 6 | ml/models/*.joblib + model cards |

## How the website uses it
Set `PIPELINE_PROCESSED_DIR` in `backend/.env` to this `data/processed` folder (default already points here).
The backend then serves `/api/calendar/<region>`, `/api/anomaly/<region>`, `/api/export/hotspots.csv` from these files,
and keeps every live FIRMS answer in `data/cache/fc_cache.sqlite`, so the site shows real data even when NASA is down.
Demo data appears only if you set `VITE_ALLOW_DEMO=true` in `frontend/.env`.

## Truth rules kept in code
- Raw downloads are saved untouched with a SHA-256 in the manifest; reruns skip finished chunks.
- A month that was not fully downloaded is `partial` / `not_downloaded`, and its calendar cell is null — never 0.
- Standard (SP) data is preferred; NRT rows on dates already covered by SP are dropped.
- Confidence stays sensor-native (MODIS ≥ 30, VIIRS n/h by default); MODIS `type` 1/2/3 rows are kept but flagged and left out of the calendar.
- Keys are read from `.env` only and masked in every log line.

## Sizes (rough, check before loading)
Punjab + Haryana: ~1,800 FIRMS requests; MODIS ~10–30 k hot spots/year, VIIRS ~50–100 k/year in heavy seasons.
Supabase free tier = 500 MB: load raw detections only for regions with `"detail": true`; aggregates for all.
