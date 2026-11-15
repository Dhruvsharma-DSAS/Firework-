-- FIREWORK CHRONOS — Supabase schema (merged v2 reference tables + v3 pipeline tables).
-- Run this whole file ONCE in Supabase → SQL Editor → New query → Run.
-- Rules: missing = NULL (never 0); derived rows keep status + provenance; everyone can read, only the service role writes.
-- v2 and v3 both defined region / fire_detection / cell_day / cell_month / calibration with different columns;
-- this file keeps ONE version of each (the v3 pipeline version for observations, the v2 Natural Earth version for region).

create extension if not exists postgis;
create extension if not exists vector;

-- ───────────── 1. Reference tables (static facts, filled by 02_reference_data.sql) ─────────────
create table if not exists provenance_label (label text primary key, meaning text not null);
create table if not exists data_status (status text primary key, meaning text not null);

create table if not exists region (
  region_id text primary key,
  name text not null,
  country text,
  iso_3166_2 text,
  role text,
  bbox_west double precision, bbox_south double precision,
  bbox_east double precision, bbox_north double precision,
  area_km2_gridded double precision,
  boundary_source text, source_url text, accessed_on date,
  geom_wkt text,
  geom geometry(MultiPolygon, 4326)
);

create table if not exists grid_cell (
  cell_id text primary key,
  row_idx int not null, col_idx int not null,
  center_lat double precision not null, center_lon double precision not null,
  area_km2 double precision not null,
  size_deg double precision not null,
  geom_wkt text,
  geom geometry(Polygon, 4326),
  cell_num int generated always as (row_idx * 3600 + col_idx) stored
);

create table if not exists region_cell (
  region_id text references region(region_id),
  cell_id text references grid_cell(cell_id),
  coverage_fraction real not null,
  area_in_region_km2 double precision not null,
  primary key (region_id, cell_id)
);

create table if not exists satellite (
  platform_id text primary key, name text, instrument text, norad_id int,
  launch_date date, firms_archive_start date,
  nominal_equator_crossing_lst text, planned_end_as_of_2026_10_27 text,
  firms_sources text, source_urls text, provenance text references provenance_label(label)
);

create table if not exists product (
  product_id text primary key, name text, geometry text, record_start date,
  latency_notes text, key_fields text, source_url text
);

create table if not exists firemask_class (
  product text, value int, meaning_catalogue_2026_10_27 text,
  exposure_rule_v2 text, state text,
  primary key (product, value)
);

create table if not exists modis_type_code (code int primary key, meaning text, use_v2 text);
create table if not exists viirs_confidence_class (code text primary key, meaning text, use_v2 text);
create table if not exists worldcover_class (value int primary key, class text, role_in_l2 text);
create table if not exists firms_column ("column" text, sensor text, meaning text, unit text, primary key ("column", sensor));

create table if not exists data_source (
  source_id text primary key, input_x text, role text, provider text, product text,
  endpoint text, auth_env_var text, cadence text, latency text, backup_of text,
  limits text, licence text, verified_on date, verification_note text
);

create table if not exists formula (
  formula_id text primary key, name text, layer text, family text,
  equation_v1 text, equation_v2 text, audit_verdict text, audit_finding text,
  v2_status text, code_hook_v2 text, ui_surface text
);

-- formula_id is a formula id or 'REJECT' (an idea that was considered and rejected), so it has no foreign key.
create table if not exists formula_alias (alias text, context text, formula_id text, note text, primary key (alias, formula_id));

create table if not exists claim_ledger (
  claim_id text primary key, claim text, value text, region text, period text, units text,
  source_url text, verified_on date, status text, test text
);

create table if not exists conflict_log (
  conflict_id text primary key, topic text, old_position text, new_position text,
  evidence text, decision text, tradeoff text, status text
);

create table if not exists audit_check (formula_id text, "check" text, old text, new text, verdict text, note text, primary key (formula_id, "check"));
create table if not exists milestone (id text primary key, name text, done_when text);

-- ───────────── 2. Observation + analysis tables (filled by the pipeline, step 7 / 05_pipeline_data) ─────────────
-- cell_id here is the integer F03 index on the 0.1° grid: row * 3600 + col  (= grid_cell.cell_num).

create table if not exists fetch_log (
  id bigserial primary key, region_id text references region(region_id), source text not null, start_date date not null, days int not null,
  rows int not null, min_date date, max_date date, sha256 text, file text, fetched_at_utc timestamptz, check_note text,
  unique (region_id, source, start_date));

create table if not exists fire_detection (
  id bigserial primary key, region_id text references region(region_id), lat double precision not null, lon double precision not null,
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
  region_id text references region(region_id), cell_id int not null, local_date date not null, platform text not null, daynight text not null,
  n_detections int not null, max_frp real, sum_frp real, primary key (region_id, cell_id, local_date, platform, daynight));

create table if not exists cell_month (
  region_id text references region(region_id), cell_id int not null, month text not null, platform text not null,
  hotspots int, fire_cell_days int, night_hotspots int, frp_sum real, frp_max real, area_km2 real,
  valid_days real, fire_rate real,
  valid_terra real, cloud_terra real, firepix_terra real, valid_aqua real, cloud_aqua real, firepix_aqua real,
  valid_viirs real, cloud_viirs real, firepix_viirs real, burned_frac real, ndvi real,
  t2m_max_c real, t2m_mean_c real, precip_mm real, wind_ms real, rh_pct real, vpd_kpa real,
  primary key (region_id, cell_id, month, platform));

create table if not exists region_month (
  region_id text references region(region_id), month text not null, family text not null,
  covered_days int, days_in_month int, hotspots int, night_hotspots int, frp_median real, fire_cell_days int,
  valid_cell_days real, rate_per_valid_day real,
  t2m_max_c real, t2m_mean_c real, precip_mm real, wind_ms real, rh_pct real, vpd_kpa real, ndvi real, burned_frac real,
  status text not null, boundary text, primary key (region_id, month, family));

create table if not exists calibration (
  region_id text references region(region_id), metric text not null, calendar_month int not null check (calendar_month between 1 and 12),
  k double precision, k_lo95 double precision, k_hi95 double precision, n_overlap_years int, method text, fitted_at_utc timestamptz,
  provenance text default 'PROPOSED_UNVALIDATED', primary key (region_id, metric, calendar_month));

create table if not exists anomaly (
  region_id text references region(region_id), month text not null, value double precision, median_ref double precision, mean_ref double precision,
  pct_vs_median double precision, robust_z double precision, n_ref int, status text, primary key (region_id, month));

create table if not exists weather_daily (
  region_id text references region(region_id), lat real not null, lon real not null, day date not null, source text not null,
  t2m_max_c real, t2m_min_c real, precip_mm real, wind_max_ms real, rh_mean_pct real, et0_mm real, vpd_max_kpa real,
  primary key (region_id, lat, lon, day, source));

create table if not exists model_registry (
  id text primary key, model text not null, version text not null, trained_at_utc timestamptz, provenance text not null,
  card jsonb not null, artifact_path text, is_active boolean default false);

create table if not exists prediction (
  model_id text references model_registry(id), region_id text references region(region_id), cell_id int, month text not null,
  target text not null, value double precision, lo double precision, hi double precision, created_at timestamptz default now(),
  primary key (model_id, region_id, cell_id, month, target));

create table if not exists api_cache (
  cache_key text primary key, payload jsonb not null, status text not null, fetched_at timestamptz not null default now(), source text);

create table if not exists doc_chunk (
  id bigserial primary key, doc_id text, title text, source_url text, source_kind text,
  provenance_tier text, page int, heading_path text, product_version text,
  document_date date, ingested_at timestamptz default now(), checksum text,
  section_key text, allowed_use text, license text, body text, embedding vector(384));

-- ───────────── 3. Views the website reads ─────────────
create or replace view v_calendar_hotspots as
  select region_id, month, family, hotspots, fire_cell_days, rate_per_valid_day, status from region_month;
create or replace view v_latest_anomaly as
  select distinct on (region_id) * from anomaly where status in ('ok', 'indicative') order by region_id, month desc;

-- ───────────── 4. Row level security: anyone can read, only the service role writes ─────────────
do $$ declare t text; begin
  foreach t in array array['provenance_label','data_status','region','grid_cell','region_cell','satellite','product','firemask_class',
    'modis_type_code','viirs_confidence_class','worldcover_class','firms_column','data_source','formula','formula_alias','claim_ledger',
    'conflict_log','audit_check','milestone','fetch_log','fire_detection','cell_day','cell_month','region_month','calibration','anomaly',
    'weather_daily','model_registry','prediction','api_cache','doc_chunk'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "public read" on %I', t);
    execute format('create policy "public read" on %I for select using (true)', t);
  end loop; end $$;
