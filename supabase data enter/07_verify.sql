-- Run after loading. Every query is read-only.

-- 1. Row counts per table (reference: region 9, grid_cell 20990, region_cell 22060, formula 46, satellite 5)
select 'region' as t, count(*) from region
union all select 'grid_cell', count(*) from grid_cell
union all select 'region_cell', count(*) from region_cell
union all select 'satellite', count(*) from satellite
union all select 'formula', count(*) from formula
union all select 'region_month', count(*) from region_month
union all select 'calibration', count(*) from calibration
union all select 'anomaly', count(*) from anomaly
union all select 'cell_month', count(*) from cell_month
union all select 'cell_day', count(*) from cell_day
union all select 'fire_detection', count(*) from fire_detection
union all select 'model_registry', count(*) from model_registry;

-- 2. Regions and how many 0.1° cells each polygon touches
select r.region_id, r.name, r.role, count(rc.cell_id) as cells
from region r left join region_cell rc using (region_id)
group by r.region_id, r.name, r.role order by cells desc;

-- 3. Calendar for the flagship region: fire cell-days per month and sensor (null = not fully downloaded, never 0)
select month, family, fire_cell_days, hotspots, status
from region_month where region_id = 'punjab_haryana' order by month, family;

-- 4. Exchange rate k (VIIRS S-NPP / MODIS cell-days) per calendar month with its 95 % band
select calendar_month, round(k::numeric, 2) as k, round(k_lo95::numeric, 2) as lo, round(k_hi95::numeric, 2) as hi, n_overlap_years
from calibration where region_id = 'punjab_haryana' and metric = 'cell_days' order by calendar_month;

-- 5. Unusual months (robust z ≥ 3 with enough reference years)
select month, value, median_ref, round(pct_vs_median::numeric, 0) as pct_vs_median, round(robust_z::numeric, 2) as z, n_ref
from anomaly where region_id = 'punjab_haryana' and status = 'ok' and robust_z >= 3 order by month;

-- 6. Busiest cells in November across all years (needs cell_month), joined to the grid for their centre
select cm.cell_id, g.center_lat, g.center_lon, sum(cm.fire_cell_days) as cell_days
from cell_month cm join grid_cell g on g.cell_num = cm.cell_id
where cm.region_id = 'punjab_haryana' and right(cm.month, 2) = '11'
group by cm.cell_id, g.center_lat, g.center_lon order by cell_days desc limit 20;

-- 7. Detections inside the true Punjab polygon (PostGIS), November 2024
select count(*) from fire_detection d join region r on r.region_id = 'punjab'
where d.acq_date between '2024-11-01' and '2024-11-30' and st_contains(r.geom, d.geom);

-- 8. Model cards: show a model on the site only when it beats its baseline
select id, provenance, card->'model_test'->>'f1' as f1_model, card->'baseline_rule_test'->>'f1' as f1_rule,
       card->'cell_month_test'->>'mae_model' as mae_model, card->'cell_month_test'->>'mae_constant_k' as mae_const_k
from model_registry;
