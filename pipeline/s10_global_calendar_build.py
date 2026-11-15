"""Step 10 — build the whole-Earth calendar (every country + World) from step 9's Earth Engine tables.

python s10_global_calendar_build.py

Input : data/processed/global/country_monthly_ee.csv   (step 9 collect)
Output: data/processed/global/calendar_global.json      (served by /api/calendar/{region})
        data/exports/calendar_country_monthly.csv       (tidy export, one row per region × month × sensor)
        data/manifests/calendar_global.manifest.json    (row counts, sha256, coverage)

Per region and month:
  modis  = MODIS (Terra + Aqua) fire cell-days: archive MOD14A1/MYD14A1, then FIRMS MODIS NRT days after the archive ends
  viirs  = VIIRS fire cell-days: S-NPP VNP14A1 archive, then NOAA-20 NRT days (S-NPP new data ended 2 Nov 2026)
  exposure_* = valid cell-days (clear view) from the archive fire masks; null when NRT days are included (no mask)
  status_* = ok | partial (fewer product days than calendar days) | nrt (includes near-real-time days) | null
Exchange rate k per calendar month (F10/F12/F18, baseline B2 = ratio of totals over the overlap):
  overlap = complete years 2012–2025, k_raw = ΣV / ΣM, year-block bootstrap 95 % band (2,000 resamples)
  Empirical Bayes partial pooling of log k toward the World value of the same month (DerSimonian–Laird τ²),
  so countries with few fires borrow strength; n_years and the pooling weight are published with k.
"""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
GLOBAL = ROOT / "data" / "processed" / "global"
EXPORTS = ROOT / "data" / "exports"
MANIFESTS = ROOT / "data" / "manifests"
OVERLAP = range(2012, 2026)
RNG = np.random.default_rng(20261105)
B = 2000


def days_in(year: int, month: int) -> int:
    return pd.Period("%d-%02d" % (year, month)).days_in_month


def region_tables(df: pd.DataFrame) -> dict:
    """{region_id: {(product_family, year, month): row}} with World as the sum over countries."""
    df = df.copy()
    df["family"] = df["product"].str.replace("_nrt", "", regex=False)
    df["is_nrt"] = df["product"].str.endswith("_nrt")
    world = df.groupby(["product", "family", "is_nrt", "year", "month"], as_index=False).agg(fire_cell_days=("fire_cell_days", "sum"), valid_cell_days=("valid_cell_days", "sum"), days=("days", "max"))
    world["iso2"] = "WORLD"
    world["country"] = "Whole Earth"
    df = pd.concat([df, world], ignore_index=True)
    out = {}
    for (iso2, country), g in df.groupby(["iso2", "country"]):
        rid = "world" if iso2 == "WORLD" else "c_" + str(iso2).lower()
        cells = {}
        for (fam, y, m), gg in g.groupby(["family", "year", "month"]):
            arch = gg[~gg["is_nrt"]]
            nrt = gg[gg["is_nrt"]]
            fire = float(gg["fire_cell_days"].sum())
            days = int(arch["days"].max()) if len(arch) else 0
            ndays = int(nrt["days"].max()) if len(nrt) else 0
            valid = float(arch["valid_cell_days"].sum()) if len(arch) and len(nrt) == 0 else None
            status = "ok"
            if len(nrt):
                status = "nrt"
            elif days < days_in(int(y), int(m)):
                status = "partial"
            cells[(fam, int(y), int(m))] = {"fire": fire, "valid": valid, "status": status, "days": days + ndays}
        out[rid] = {"name": country, "iso2": "" if iso2 == "WORLD" else iso2, "cells": cells}
    return out


def k_for(cells: dict, month: int):
    m = np.array([cells.get(("modis", y, month), {}).get("fire", np.nan) for y in OVERLAP], dtype=float)
    v = np.array([cells.get(("viirs", y, month), {}).get("fire", np.nan) for y in OVERLAP], dtype=float)
    ok = ~np.isnan(m) & ~np.isnan(v)
    m, v = m[ok], v[ok]
    if len(m) < 3 or m.sum() <= 0:
        return None
    k = v.sum() / m.sum()
    idx = RNG.integers(0, len(m), size=(B, len(m)))
    ms = m[idx].sum(1)
    vs = v[idx].sum(1)
    good = ms > 0
    boot = np.log(vs[good] / ms[good]) if good.any() else np.array([np.log(k)])
    boot = boot[np.isfinite(boot)]
    var = float(np.var(boot)) if len(boot) > 1 else np.inf
    if v.sum() <= 0:
        return None
    return {"k_raw": float(k), "logk": float(np.log(k)), "var": var, "n_years": int(len(m)), "m_total": float(m.sum())}


def pool(estimates: list, world_logk: float) -> float:
    """DerSimonian–Laird between-region variance τ² of log k for one calendar month."""
    y = np.array([e["logk"] for e in estimates])
    s2 = np.array([max(e["var"], 1e-6) for e in estimates])
    w = 1 / s2
    if len(y) < 3:
        return 0.0
    mu = np.sum(w * y) / np.sum(w)
    q = np.sum(w * (y - mu) ** 2)
    c = np.sum(w) - np.sum(w ** 2) / np.sum(w)
    return float(max(0.0, (q - (len(y) - 1)) / c)) if c > 0 else 0.0


def main() -> None:
    src = GLOBAL / "country_monthly_ee.csv"
    df = pd.read_csv(src, keep_default_na=False, na_values=[""])
    regions = region_tables(df)
    years = list(range(int(df["year"].min()), int(df["year"].max()) + 1))
    raw_k = {rid: {mo: k_for(r["cells"], mo) for mo in range(1, 13)} for rid, r in regions.items()}
    tau2 = {}
    for mo in range(1, 13):
        est = [raw_k[rid][mo] for rid in regions if rid != "world" and raw_k[rid][mo] and np.isfinite(raw_k[rid][mo]["var"])]
        world = raw_k["world"][mo]
        tau2[mo] = pool(est, world["logk"] if world else 0.0)
    out = {}
    export_rows = []
    for rid, r in regions.items():
        cells = r["cells"]
        k_baseline = {}
        for mo in range(1, 13):
            e = raw_k[rid][mo]
            w = raw_k["world"][mo]
            if e is None and w is None:
                continue
            if rid == "world" or w is None:
                post, pv, weight = e["logk"], e["var"], 1.0
            elif e is None or not np.isfinite(e["var"]):
                post, pv, weight = w["logk"], tau2[mo] + w["var"], 0.0
            else:
                weight = tau2[mo] / (tau2[mo] + e["var"]) if (tau2[mo] + e["var"]) > 0 else 1.0
                post = weight * e["logk"] + (1 - weight) * w["logk"]
                pv = weight * e["var"] + (1 - weight) ** 2 * w["var"]
            sd = float(np.sqrt(max(pv, 0)))
            k_baseline[str(mo)] = {"k": round(float(np.exp(post)), 4), "lo": round(float(np.exp(post - 1.96 * sd)), 4), "hi": round(float(np.exp(post + 1.96 * sd)), 4), "n_years": e["n_years"] if e else 0, "k_raw": round(e["k_raw"], 4) if e else None, "pool_weight": round(float(weight), 3)}

        def grid(fam, key):
            return [[(lambda c: None if c is None else (None if c[key] is None else round(c[key], 2)))(cells.get((fam, y, mo))) for mo in range(1, 13)] for y in years]

        def status(fam):
            return [[(cells.get((fam, y, mo)) or {}).get("status") for mo in range(1, 13)] for y in years]

        viirs = grid("viirs", "fire")
        out[rid] = {
            "region": rid, "region_name": r["name"], "iso2": r["iso2"], "years": years, "months_processed": list(range(1, 13)),
            "modis": grid("modis", "fire"), "viirs": [row if years[i] >= 2012 else [None] * 12 for i, row in enumerate(viirs)],
            "exposure_modis": grid("modis", "valid"), "exposure_viirs": grid("viirs", "valid"),
            "status_modis": status("modis"), "status_viirs": status("viirs"),
            "night_modis": None, "night_viirs": None, "platforms": {}, "k_baseline": k_baseline,
        }
        for (fam, y, mo), c in sorted(cells.items()):
            export_rows.append({"region_id": rid, "region_name": r["name"], "iso2_fips": r["iso2"], "sensor": fam, "year": y, "month": mo, "fire_cell_days": round(c["fire"], 3), "valid_cell_days": None if c["valid"] is None else round(c["valid"], 2), "product_days": c["days"], "status": c["status"]})
    gen = datetime.now(timezone.utc).isoformat()
    last = df.groupby("product").apply(lambda g: "%d-%02d" % (g["year"].max(), g[g["year"] == g["year"].max()]["month"].max())).to_dict()
    payload = {"meta": {"generated_at_utc": gen, "source_table": str(src.relative_to(ROOT)), "regions": len(out), "years": [years[0], years[-1]], "latest_month_per_product": last, "tau2_logk_by_month": {str(k): round(v, 4) for k, v in tau2.items()}}, "regions": out}
    GLOBAL.mkdir(parents=True, exist_ok=True)
    (GLOBAL / "calendar_global.json").write_text(json.dumps(payload, separators=(",", ":")))
    EXPORTS.mkdir(parents=True, exist_ok=True)
    ex = pd.DataFrame(export_rows)
    ex.to_csv(EXPORTS / "calendar_country_monthly.csv", index=False)
    MANIFESTS.mkdir(parents=True, exist_ok=True)
    def sha(p):
        return hashlib.sha256(p.read_bytes()).hexdigest()
    manifest = {"generated_at_utc": gen, "inputs": {str(src.relative_to(ROOT)): {"sha256": sha(src), "rows": int(len(df))}}, "outputs": {"data/exports/calendar_country_monthly.csv": {"sha256": sha(EXPORTS / "calendar_country_monthly.csv"), "rows": int(len(ex))}, "data/processed/global/calendar_global.json": {"sha256": sha(GLOBAL / "calendar_global.json"), "regions": len(out)}}, "coverage": {"years": [years[0], years[-1]], "latest_month_per_product": last, "geography": "USDOS LSIB 2017 countries, Antarctica excluded, 60°S–84°N"}, "products": {"modis": "MODIS/061/MOD14A1 + MODIS/061/MYD14A1 (Earth Engine)", "viirs": "NASA/VIIRS/002/VNP14A1 (Earth Engine)", "modis_nrt": "FIRMS (Earth Engine, MODIS NRT raster)", "viirs_nrt": "NASA/LANCE/NOAA20_VIIRS/C2 (Earth Engine)"}, "provenance": "SOURCE_DERIVED"}
    (MANIFESTS / "calendar_global.manifest.json").write_text(json.dumps(manifest, indent=1))
    print("regions", len(out), "export rows", len(ex), "latest", last)


if __name__ == "__main__":
    main()
