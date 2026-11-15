-- FIREWORK CHRONOS — Supabase schema v3 (real data). Run once in the Supabase SQL editor, then `python s07_load_supabase.py`.
-- Rules: missing = NULL (never 0); every derived row keeps status + provenance; public read, writes only with the service role.

create extension if not exists postgis;

create table if not exists region (
  id text primary key, name text not null, role text, bbox double precision[4] not null,
  geom geometry(Polygon, 4326), created_at timestamptz default now());

create table if not exists fetch_log (
  id bigserial primary key, region_id text references region(id), source text not null, start_date date not null, days int not null,
  rows int not null, min_date date, max_date date, sha256 text, file text, fetched_at_utc timestamptz, check_note text,
  unique (region_id, source, start_date));

create table if not exists fire_detection (
  id bigserial primary key, region_id text references region(id), lat double precision not null, lon double precision not null,
  acq_date date not null, acq_time int not null, local_date date not null, lmst real, sensor text not null, platform text,
  brightness real, bright_2 real, scan real, track real, frp real, daynight text, confidence_raw text, version text,
  firms_type smallint, firms_source text not null, processing text not null check (processing in ('SP','NRT')),
  cell_id int not null, month text not null, family text, static_or_volcano boolean,
  geom geometry(Point, 4326) generated always as (st_setsrid(st_makepoint(lon, lat), 4326)) stored);
create index if not exists fire_detection_region_date on fire_detection (region_id, local_date);
create index if not exists fire_detection_cell_month on fire_detection (cell_id, month);
create index if not exists fire_detection_geom on fire_detection using gist (geom);
create unique index if not exists fire_detection_uniq on fire_detection (lat, lon, acq_date, acq_time, platform);

create table if not exists cell_day (
  region_id text references region(id), cell_id int not null, local_date date not null, platform text not null, daynight text not null,
  n_detections int not null, max_frp real, sum_frp real, primary key (region_id, cell_id, local_date, platform, daynight));

create table if not exists cell_month (
  region_id text references region(id), cell_id int not null, month text not null, platform text not null,
  hotspots int, fire_cell_days int, night_hotspots int, frp_sum real, frp_max real, area_km2 real,
  valid_days real, fire_rate real,
  valid_terra real, cloud_terra real, firepix_terra real, valid_aqua real, cloud_aqua real, firepix_aqua real,
  valid_viirs real, cloud_viirs real, firepix_viirs real, burned_frac real, ndvi real,
  t2m_max_c real, t2m_mean_c real, precip_mm real, wind_ms real, rh_pct real, vpd_kpa real,
  primary key (region_id, cell_id, month, platform));

create table if not exists region_month (
  region_id text references region(id), month text not null, family text not null,
  covered_days int, days_in_month int, hotspots int, night_hotspots int, frp_median real, fire_cell_days int,
  valid_cell_days real, rate_per_valid_day real,
  t2m_max_c real, t2m_mean_c real, precip_mm real, wind_ms real, rh_pct real, vpd_kpa real, ndvi real, burned_frac real,
  status text not null, primary key (region_id, month, family));

create table if not exists calibration (
  region_id text references region(id), metric text not null, calendar_month int not null check (calendar_month between 1 and 12),
  k double precision, k_lo95 double precision, k_hi95 double precision, n_overlap_years int, method text, fitted_at_utc timestamptz,
  provenance text default 'PROPOSED_UNVALIDATED', primary key (region_id, metric, calendar_month));

create table if not exists anomaly (
  region_id text references region(id), month text not null, value double precision, median_ref double precision, mean_ref double precision,
  pct_vs_median double precision, robust_z double precision, n_ref int, status text, primary key (region_id, month));

create table if not exists weather_daily (
  region_id text references region(id), lat real not null, lon real not null, day date not null, source text not null,
  t2m_max_c real, t2m_min_c real, precip_mm real, wind_max_ms real, rh_mean_pct real, et0_mm real, vpd_max_kpa real,
  primary key (region_id, lat, lon, day, source));

create table if not exists model_registry (
  id text primary key, model text not null, version text not null, trained_at_utc timestamptz, provenance text not null,
  card jsonb not null, artifact_path text, is_active boolean default false);

create table if not exists prediction (
  model_id text references model_registry(id), region_id text references region(id), cell_id int, month text not null,
  target text not null, value double precision, lo double precision, hi double precision, created_at timestamptz default now(),
  primary key (model_id, region_id, cell_id, month, target));

create table if not exists api_cache (
  cache_key text primary key, payload jsonb not null, status text not null, fetched_at timestamptz not null default now(), source text);

-- Views the website reads
create or replace view v_calendar_hotspots as
  select region_id, month, family, hotspots, fire_cell_days, rate_per_valid_day, status from region_month;
create or replace view v_latest_anomaly as
  select distinct on (region_id) * from anomaly where status in ('ok', 'indicative') order by region_id, month desc;

-- Row level security: anyone can read, only the service role writes
do $$ declare t text; begin
  foreach t in array array['region','fetch_log','fire_detection','cell_day','cell_month','region_month','calibration','anomaly','weather_daily','model_registry','prediction','api_cache'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "public read" on %I', t);
    execute format('create policy "public read" on %I for select using (true)', t);
  end loop; end $$;
