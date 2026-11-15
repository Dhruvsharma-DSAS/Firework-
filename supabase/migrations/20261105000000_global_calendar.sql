-- FIREWORK CHRONOS · whole-Earth monthly fire calendar (pipeline steps 9–11)
-- Aggregates only: one row per region × sensor × month. Raw daily fire masks stay in Google Earth Engine.

create table if not exists public.global_calendar_monthly (
  region_id        text        not null,
  region_name      text        not null,
  iso2_fips        text,
  sensor           text        not null check (sensor in ('modis', 'viirs')),
  year             smallint    not null check (year between 2000 and 2100),
  month            smallint    not null check (month between 1 and 12),
  fire_cell_days   double precision not null check (fire_cell_days >= 0),
  valid_cell_days  double precision check (valid_cell_days is null or valid_cell_days >= 0),
  product_days     smallint    not null,
  status           text        not null check (status in ('ok', 'partial', 'nrt')),
  generated_at_utc timestamptz not null,
  primary key (region_id, sensor, year, month)
);
comment on table public.global_calendar_monthly is 'Fire cell-days per region and month from NASA MOD14A1/MYD14A1/VNP14A1 (and FIRMS / NOAA-20 NRT days), counted per 0.1° cell in Earth Engine. Null valid_cell_days = no fire-mask exposure (NRT days). Missing month = no row, never 0. Provenance SOURCE_DERIVED.';
create index if not exists global_calendar_monthly_time on public.global_calendar_monthly (year, month);

create table if not exists public.global_calibration (
  region_id        text        not null,
  calendar_month   smallint    not null check (calendar_month between 1 and 12),
  k                double precision not null,
  k_lo95           double precision,
  k_hi95           double precision,
  k_raw            double precision,
  n_overlap_years  smallint    not null,
  pool_weight      double precision,
  method           text        not null,
  generated_at_utc timestamptz not null,
  primary key (region_id, calendar_month)
);
comment on table public.global_calibration is 'Exchange rate k = VIIRS S-NPP / MODIS fire cell-days per calendar month over 2012–2025, year-block bootstrap 95 %, empirical Bayes pooled toward World. RUN_TESTED_LOCALLY until held-out validation passes.';

create table if not exists public.global_ingestion_jobs (
  job_id           bigint generated always as identity primary key,
  started_at_utc   timestamptz not null default now(),
  finished_at_utc  timestamptz,
  kind             text        not null,
  detail           jsonb       not null default '{}'::jsonb,
  ok               boolean
);

alter table public.global_calendar_monthly enable row level security;
alter table public.global_calibration enable row level security;
alter table public.global_ingestion_jobs enable row level security;

drop policy if exists "public read calendar" on public.global_calendar_monthly;
create policy "public read calendar" on public.global_calendar_monthly for select to anon, authenticated using (true);
drop policy if exists "public read calibration" on public.global_calibration;
create policy "public read calibration" on public.global_calibration for select to anon, authenticated using (true);
drop policy if exists "public read jobs" on public.global_ingestion_jobs;
create policy "public read jobs" on public.global_ingestion_jobs for select to anon, authenticated using (true);
-- no insert / update / delete policies: only the service role (server-side pipeline) can write.
