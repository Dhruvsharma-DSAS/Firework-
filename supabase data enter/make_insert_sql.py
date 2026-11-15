"""Build the Supabase INSERT files from the real CSVs (no network, no keys).

python "supabase data enter/make_insert_sql.py"            # from the FIREWORK folder

Reads
  data/supabase/csv/*.csv                       19 static reference tables (Natural Earth, NASA / FIRMS / GEE facts)
  pipeline/regions.json                         regions the pipeline downloads (adds ones missing from region.csv)
  pipeline/data/processed/<region>/*.csv        pipeline output (steps 5–6), when it exists
  ml/models/*.card.json                         model cards, when the models have been trained
Writes into this folder
  02_reference_data.sql                         small reference tables, in foreign-key order
  03_grid_cell_partN.sql / 04_region_cell_partN.sql   the two big grid tables, split so the SQL Editor accepts them
  05_pipeline/<region>_<table>.sql              small pipeline tables (region_month, calibration, anomaly); big ones go by CSV + s07 / \\copy
  06_models.sql                                 model_registry rows from the model cards
  csv/                                          the same data as CSV, for the Table Editor importer or psql \\copy
Empty CSV cells become NULL, never 0.
"""
import csv
import json
import shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
STATIC = ROOT / "data" / "supabase" / "csv"
PROCESSED = ROOT / "pipeline" / "data" / "processed"
MODELS = ROOT / "ml" / "models"
PART_ROWS = 4000

REFERENCE_ORDER = ["provenance_label", "data_status", "satellite", "product", "firemask_class", "modis_type_code",
                   "viirs_confidence_class", "worldcover_class", "firms_column", "region", "data_source", "formula",
                   "formula_alias", "claim_ledger", "conflict_log", "audit_check", "milestone"]
PIPELINE_TABLES = ["region_month", "calibration", "anomaly", "cell_month", "cell_day", "fire_detection"]
SQL_TABLES = ["region_month", "calibration", "anomaly"]
PIPELINE_COLUMNS = {
    "region_month": ["region_id", "month", "family", "covered_days", "days_in_month", "hotspots", "night_hotspots", "frp_median", "fire_cell_days",
                     "valid_cell_days", "rate_per_valid_day", "t2m_max_c", "t2m_mean_c", "precip_mm", "wind_ms", "rh_pct", "vpd_kpa", "ndvi", "burned_frac", "status", "boundary"],
    "calibration": ["region_id", "metric", "calendar_month", "k", "k_lo95", "k_hi95", "n_overlap_years", "method", "fitted_at_utc"],
    "anomaly": ["region_id", "month", "value", "median_ref", "mean_ref", "pct_vs_median", "robust_z", "n_ref", "status"],
    "cell_month": ["region_id", "cell_id", "month", "platform", "hotspots", "fire_cell_days", "night_hotspots", "frp_sum", "frp_max", "area_km2", "valid_days", "fire_rate",
                   "valid_terra", "cloud_terra", "firepix_terra", "valid_aqua", "cloud_aqua", "firepix_aqua", "valid_viirs", "cloud_viirs", "firepix_viirs",
                   "burned_frac", "ndvi", "t2m_max_c", "t2m_mean_c", "precip_mm", "wind_ms", "rh_pct", "vpd_kpa"],
    "cell_day": ["region_id", "cell_id", "local_date", "platform", "daynight", "n_detections", "max_frp", "sum_frp"],
    "fire_detection": ["region_id", "lat", "lon", "acq_date", "acq_time", "local_date", "lmst", "sensor", "platform", "brightness", "bright_2", "scan", "track", "frp",
                       "daynight", "confidence_raw", "version", "firms_type", "firms_source", "processing", "cell_id", "month", "family", "static_or_volcano"],
}
INTEGER_COLUMNS = {"covered_days", "days_in_month", "hotspots", "night_hotspots", "fire_cell_days", "n_overlap_years", "n_ref", "cell_id", "n_detections", "acq_time", "firms_type", "calendar_month"}


def literal(value: str, column: str, table: str = "") -> str:
    """One CSV cell → SQL literal. '' / nan → NULL. Integer columns of pipeline tables written as integers (7.0 → 7). Text is quoted with '' escaping."""
    if value is None or value == "" or value.lower() == "nan" or value == "<NA>":
        return "NULL"
    if table in PIPELINE_COLUMNS and column in INTEGER_COLUMNS:
        return str(int(round(float(value))))
    if column == "provenance":
        value = value.strip().upper().replace(" ", "_")
    return "'" + value.replace("'", "''") + "'"


def ident(name: str) -> str:
    """Quoted, lower-case column name (handles reserved words like "check" and "column")."""
    return '"' + name.lower() + '"'


def insert_lines(table: str, columns: list, rows: list) -> list:
    """INSERT statements of 500 rows each; existing primary keys are skipped (on conflict do nothing)."""
    out = []
    head = "insert into %s (%s) values\n" % (table, ", ".join(ident(c) for c in columns))
    for i in range(0, len(rows), 500):
        chunk = rows[i:i + 500]
        values = ",\n".join("(" + ", ".join(literal(r.get(c, ""), c, table) for c in columns) + ")" for r in chunk)
        out.append(head + values + "\non conflict do nothing;\n")
    return out


def read_csv(path: Path) -> tuple:
    """Header and rows of a CSV file."""
    with open(path, encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        rows = list(reader)
        return reader.fieldnames, rows


def write_parts(stem: str, table: str, columns: list, rows: list, before: str = "", after: str = "") -> list:
    """Split rows into files of PART_ROWS rows; returns the file names written."""
    names = []
    parts = max(1, (len(rows) + PART_ROWS - 1) // PART_ROWS)
    for p in range(parts):
        chunk = rows[p * PART_ROWS:(p + 1) * PART_ROWS]
        name = "%s_part%d.sql" % (stem, p + 1)
        if parts == 1:
            name = stem + ".sql"
        text = "-- %s rows %d–%d of %d\n" % (table, p * PART_ROWS + 1, p * PART_ROWS + len(chunk), len(rows))
        if p == 0:
            text = text + before
        text = text + "".join(insert_lines(table, columns, chunk))
        if p == parts - 1:
            text = text + after
        (HERE / name).parent.mkdir(parents=True, exist_ok=True)
        (HERE / name).write_text(text, encoding="utf-8")
        names.append(name)
    return names


def reference() -> None:
    """02_reference_data.sql + the two grid tables + pipeline-only regions."""
    lines = ["-- Static reference data (real facts). Run after 01_schema.sql.\n"]
    for table in REFERENCE_ORDER:
        columns, rows = read_csv(STATIC / (table + ".csv"))
        lines.append("\n-- %s (%d rows)\n" % (table, len(rows)))
        lines.extend(insert_lines(table, columns, rows))
    regions = json.load(open(ROOT / "pipeline" / "regions.json", encoding="utf-8"))["regions"]
    known = set(r["region_id"] for r in read_csv(STATIC / "region.csv")[1])
    extra = []
    for r in regions:
        if r["id"] not in known:
            w, s, e, n = r["bbox"]
            extra.append({"region_id": r["id"], "name": r["name"], "role": r["role"], "bbox_west": str(w), "bbox_south": str(s), "bbox_east": str(e), "bbox_north": str(n),
                          "boundary_source": r.get("note", "bbox from pipeline/regions.json")})
    if extra:
        lines.append("\n-- regions used by the pipeline that have no Natural Earth polygon in region.csv (bbox only)\n")
        lines.extend(insert_lines("region", ["region_id", "name", "role", "bbox_west", "bbox_south", "bbox_east", "bbox_north", "boundary_source"], extra))
    lines.append("\n-- geometry from the WKT text\nupdate region set geom = st_multi(st_geomfromewkt(geom_wkt)) where geom is null and geom_wkt is not null and geom_wkt <> '';\n")
    lines.append("update region set geom = st_multi(st_makeenvelope(bbox_west, bbox_south, bbox_east, bbox_north, 4326)) where geom is null and bbox_west is not null;\n")
    (HERE / "02_reference_data.sql").write_text("".join(lines), encoding="utf-8")
    columns, rows = read_csv(STATIC / "grid_cell.csv")
    write_parts("03_grid_cell", "grid_cell", columns, rows, after="\nupdate grid_cell set geom = st_geomfromewkt(geom_wkt) where geom is null;\ncreate index if not exists grid_cell_geom on grid_cell using gist (geom);\n")
    columns, rows = read_csv(STATIC / "region_cell.csv")
    write_parts("04_region_cell", "region_cell", columns, rows)
    (HERE / "csv").mkdir(exist_ok=True)
    for path in STATIC.glob("*.csv"):
        shutil.copyfile(path, HERE / "csv" / path.name)


def pipeline() -> int:
    """05_pipeline/<region>_<table>[_partN].sql for every processed region; each table file starts by deleting that region's rows."""
    if not PROCESSED.exists():
        return 0
    count = 0
    for folder in sorted(p for p in PROCESSED.iterdir() if p.is_dir() and p.name != "train"):
        rid = folder.name
        for table in PIPELINE_TABLES:
            path = folder / (table + ".csv")
            if not path.exists():
                continue
            header, rows = read_csv(path)
            for r in rows:
                r["region_id"] = rid
            columns = [c for c in PIPELINE_COLUMNS[table] if c in header or c == "region_id"]
            if table in SQL_TABLES:
                before = "delete from %s where region_id = '%s';\n" % (table, rid)
                write_parts("05_pipeline/%s_%s" % (rid, table), table, columns, rows, before=before)
            target = HERE / "csv" / "pipeline" / rid
            target.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, target / path.name)
            count = count + 1
    return count


def models() -> int:
    """06_models.sql: model cards into model_registry (provenance comes from the card, never upgraded here)."""
    lines = ["-- Model cards (test metrics + provenance). Only show a model on the site if it beats its baseline.\n"]
    n = 0
    for path in sorted(MODELS.glob("*.card.json")):
        card = json.load(open(path, encoding="utf-8"))
        mid = card["model"] + "_v" + card["version"]
        payload = json.dumps(card).replace("'", "''")
        lines.append("insert into model_registry (id, model, version, trained_at_utc, provenance, card, artifact_path, is_active) values ('%s', '%s', '%s', '%s', '%s', '%s'::jsonb, '%s', false)\n"
                     "on conflict (id) do update set card = excluded.card, provenance = excluded.provenance, trained_at_utc = excluded.trained_at_utc;\n"
                     % (mid, card["model"], card["version"], card["trained_at_utc"], card["provenance"], payload, "ml/models/" + path.name.replace(".card.json", ".joblib")))
        n = n + 1
    (HERE / "06_models.sql").write_text("".join(lines), encoding="utf-8")
    return n


if __name__ == "__main__":
    reference()
    print("reference data written")
    print("pipeline tables written:", pipeline())
    print("model cards written:", models())
