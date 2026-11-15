"""Advanced trust layer, added on top of trust_global.json (run build_trust.py first).
1. Coverage distance: 5-nearest-neighbour distance of each region-month to the well-tested (High) region-months,
   scaled by median/IQR, turned into a percentile of the leave-one-out distances inside the High set.
2. Why k: a small gradient-boosted model of ln k on five physical/context inputs, with exact interventional
   Shapley values (all 32 coalitions, 30 real background rows) for every region-month.
3. Transfer test T1: hold out one continent AND one year at a time, predict k there from the other continents,
   and compare the error with a single global k (the baseline) and with the region's own k (the ceiling).
4. Burned-area test T2 (optional): if data/processed/global/burned_area_countries.json exists (tools/trust/build_burned_area.py),
   Spearman correlation of yearly harmonised fire cell-days with MODIS MCD64A1 burned area per country.
Run from the repo root: backend/.venv/bin/python tools/trust/build_advanced.py"""
import json
import math
import sys
from itertools import combinations
from pathlib import Path

import numpy as np
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.model_selection import GroupKFold

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
from app.trust import MIN_MODIS, OVERLAP_START, fill_processed_zeros, with_exposure, harmonised_series, overlap_pairs, spearman

GLOBAL = ROOT / "data" / "processed" / "global"
FEATURES = ["abs_lat", "season_sin", "season_cos", "fire_level", "month_share"]
LABELS = {"abs_lat": "Distance from equator", "season_sin": "Season (spring/autumn)", "season_cos": "Season (summer/winter)", "fire_level": "Amount of fire", "month_share": "How peaked the fire season is"}
BUNDLED = {"b_california": (37.0, "North America"), "b_cordoba_ar": (-31.4, "South America"), "b_delhi": (28.6, "Asia"), "b_haryana": (29.1, "Asia"), "b_mato_grosso": (-12.6, "South America"), "b_new_south_wales": (-32.2, "Oceania"), "b_punjab": (30.9, "Asia"), "b_punjab_haryana": (30.0, "Asia")}
K_NN = 5
SEED = 7


def centroid_lat(geom: dict) -> float:
    polys = geom["coordinates"]
    if geom["type"] == "Polygon":
        polys = [polys]
    best = max(polys, key=lambda p: len(p[0]))
    return float(np.mean([pt[1] for pt in best[0]]))


def places() -> dict:
    data = json.load(open(ROOT / "frontend" / "public" / "data" / "countries.json"))["data"]
    out = {"c_" + f["properties"]["iso3"].lower(): (centroid_lat(f["geometry"]), f["properties"]["continent"]) for f in data["features"] if f["properties"].get("iso3")}
    out.update(BUNDLED)
    return out


def k_of(pairs: list):
    sm = sum(p[1] for p in pairs)
    if sm < MIN_MODIS:
        return None
    return sum(p[2] for p in pairs) / sm


def features(region: dict, month: int, lat: float, skip_year=None) -> list:
    pairs = [p for p in overlap_pairs(region, month) if p[0] != skip_year]
    shifted = month
    if lat < 0:
        shifted = (month + 6) % 12
    mean_m = 0.0
    if pairs:
        mean_m = sum(p[1] for p in pairs) / len(pairs)
    year_tot = 0.0
    month_tot = 0.0
    for i, year in enumerate(region["years"]):
        if year < OVERLAP_START or year > 2025 or year == skip_year:
            continue
        row = [v for v in region["modis"][i] if v is not None]
        if region["modis"][i][month] is not None:
            month_tot += region["modis"][i][month]
            year_tot += sum(row)
    share = 0.0
    if year_tot > 0:
        share = month_tot / year_tot
    return [abs(lat), math.sin(2 * math.pi * shifted / 12), math.cos(2 * math.pi * shifted / 12), math.log10(1 + mean_m), share]


def table(regions: dict, geo: dict, skip_year=None) -> list:
    rows = []
    for rid, region in regions.items():
        if rid not in geo:
            continue
        lat, continent = geo[rid]
        for month in range(12):
            pairs = [p for p in overlap_pairs(region, month) if p[0] != skip_year]
            rows.append({"rid": rid, "month": month, "continent": continent, "x": features(region, month, lat, skip_year), "k": k_of(pairs), "n": len(pairs)})
    return rows


def model() -> GradientBoostingRegressor:
    return GradientBoostingRegressor(n_estimators=200, max_depth=3, learning_rate=0.05, subsample=0.8, min_samples_leaf=10, random_state=SEED)


def shapley(fit, x: np.ndarray, background: np.ndarray) -> np.ndarray:
    """Exact interventional Shapley values: for each coalition S, features in S come from x, the rest from each background row."""
    p = x.shape[1]
    phi = np.zeros_like(x)
    value = {}
    for size in range(p + 1):
        for s in combinations(range(p), size):
            mixed = np.repeat(background[None, :, :], x.shape[0], axis=0)
            if s:
                mixed[:, :, list(s)] = x[:, None, list(s)]
            value[s] = fit.predict(mixed.reshape(-1, p)).reshape(x.shape[0], -1).mean(axis=1)
    for j in range(p):
        others = [i for i in range(p) if i != j]
        for size in range(p):
            w = math.factorial(size) * math.factorial(p - size - 1) / math.factorial(p)
            for s in combinations(others, size):
                with_j = tuple(sorted(s + (j,)))
                phi[:, j] += w * (value[with_j] - value[s])
    return phi, value[()]


def robust_scale(ref: np.ndarray):
    med = np.median(ref, axis=0)
    iqr = np.subtract(*np.percentile(ref, [75, 25], axis=0))
    iqr[iqr == 0] = 1.0
    return med, iqr


def knn_mean(a: np.ndarray, b: np.ndarray, skip_self: bool) -> np.ndarray:
    d = np.sqrt(((a[:, None, :] - b[None, :, :]) ** 2).sum(axis=2))
    d.sort(axis=1)
    start = 0
    if skip_self:
        start = 1
    return d[:, start:start + K_NN].mean(axis=1)


def score(region: dict, month: int, year: int, k_hat: float):
    i = region["years"].index(year)
    m = region["modis"][i][month]
    v = region["viirs"][i][month]
    if m is None or v is None or m < MIN_MODIS:
        return None
    return abs(math.log((v + 0.5) / (k_hat * m + 0.5)))


def transfer_test(regions: dict, geo: dict) -> dict:
    """T1: leave one continent and one year out; ln k predicted from the other continents and years only."""
    years = list(range(OVERLAP_START, 2026))
    errs = {"model": [], "global_k": [], "own_k": []}
    per = {}
    for year in years:
        rows = [r for r in table(regions, geo, skip_year=year) if r["k"] and r["n"] >= 6]
        for cont in sorted(set(r["continent"] for r in rows)):
            train = [r for r in rows if r["continent"] != cont]
            test = [r for r in rows if r["continent"] == cont]
            if len(train) < 50 or not test:
                continue
            fit = model().fit(np.array([r["x"] for r in train]), np.log([r["k"] for r in train]))
            k_glob = float(np.exp(np.median(np.log([r["k"] for r in train]))))
            pred = np.exp(fit.predict(np.array([r["x"] for r in test])))
            for r, kp in zip(test, pred):
                trio = [score(regions[r["rid"]], r["month"], year, kp), score(regions[r["rid"]], r["month"], year, k_glob), score(regions[r["rid"]], r["month"], year, r["k"])]
                if None in trio:
                    continue
                for key, s in zip(["model", "global_k", "own_k"], trio):
                    errs[key].append(s)
                per.setdefault(cont, {"model": [], "global_k": []})
                per[cont]["model"].append(trio[0])
                per[cont]["global_k"].append(trio[1])
    med = {key: round(float(np.median(v)), 4) for key, v in errs.items()}
    factor = {key: round(math.exp(v), 3) for key, v in med.items()}
    by_cont = {c: {"n": len(v["model"]), "model": round(float(np.median(v["model"])), 4), "global_k": round(float(np.median(v["global_k"])), 4)} for c, v in per.items()}
    wins = sum(1 for v in by_cont.values() if v["model"] <= v["global_k"])
    return {
        "id": "T1",
        "name": "Transfer to unseen continent and year",
        "rule": "median error of the transferred k is lower than a single global k, overall and on at least 4 of 6 continents",
        "n": len(errs["model"]),
        "median_abs_log_error": med,
        "typical_factor": factor,
        "by_continent": by_cont,
        "continents_won": wins,
        "pass": med["model"] < med["global_k"] and wins >= 4,
        "note": "error = |ln((V+0.5)/(k·M+0.5))| for each held-out region-month of the held-out year; own_k is the region's own k (not transferred) and shows the ceiling",
    }


def burned_area_test(regions: dict) -> dict:
    path = GLOBAL / "burned_area_countries.json"
    if not path.exists():
        return {"id": "T2", "name": "Agreement with MODIS burned area (MCD64A1)", "status": "pending", "reason": "run tools/trust/build_burned_area.py (needs Earth Engine)"}
    ba = json.load(open(path))["countries"]
    rhos = []
    rows = []
    for iso3, series in ba.items():
        rid = "c_" + iso3.lower()
        if rid not in regions:
            continue
        region = regions[rid]
        harm = harmonised_series(region)
        xs = []
        ys = []
        for i, year in enumerate(region["years"]):
            area = series.get(str(year))
            vals = [v for v in harm[i] if v is not None]
            if area is None or len(vals) < 12:
                continue
            xs.append(sum(vals))
            ys.append(area)
        if len(xs) < 15 or sum(ys) / len(ys) < 100:
            continue
        rho = spearman(xs, ys)
        if rho is None:
            continue
        rhos.append(rho)
        rows.append({"iso3": iso3, "years": len(xs), "rho": round(rho, 3), "mean_burned_km2": round(sum(ys) / len(ys))})
    rows.sort(key=lambda r: -r["mean_burned_km2"])
    med = round(float(np.median(rhos)), 3) if rhos else None
    return {
        "id": "T2",
        "name": "Agreement with MODIS burned area (MCD64A1)",
        "rule": "median year-to-year Spearman correlation between harmonised fire cell-days and burned area is at least 0.5, over countries with ≥ 15 years and ≥ 100 km² burned per year",
        "countries": len(rhos),
        "median_rho": med,
        "share_positive": round(sum(1 for r in rhos if r > 0) / len(rhos), 3) if rhos else None,
        "top": rows[:12],
        "pass": med is not None and med >= 0.5,
        "status": "done",
    }


def main():
    calendar = json.load(open(GLOBAL / "calendar_global.json"))
    world = calendar["regions"].get("world")
    expo = json.load(open(GLOBAL / "exposure_countries.json")).get("regions", {})
    regions = {rid: fill_processed_zeros(with_exposure(r, expo.get(rid)), world) for rid, r in calendar["regions"].items()}
    trust = json.load(open(GLOBAL / "trust_global.json"))
    geo = places()
    rows = table(regions, geo)
    level = {rid: [c["level"] for c in t["coverage"]] for rid, t in trust["regions"].items()}

    x_all = np.array([r["x"] for r in rows])
    ref_mask = np.array([level.get(r["rid"], ["low"] * 12)[r["month"]] == "high" for r in rows])
    med, iqr = robust_scale(x_all[ref_mask])
    z = (x_all - med) / iqr
    ref = z[ref_mask]
    loo = knn_mean(ref, ref, skip_self=True)
    d75, d95, d99 = [float(np.percentile(loo, q)) for q in (75, 95, 99)]
    dist = knn_mean(z, ref, skip_self=False)
    dist[ref_mask] = loo
    for r, d in zip(rows, dist):
        pct = float((loo <= d).mean() * 100)
        zone = "core"
        if d >= d75:
            zone = "edge"
        if d >= d95:
            zone = "outside"
        r["distance"] = {"d": round(float(d), 3), "pct": round(pct, 1), "zone": zone}

    fit_rows = [r for r in rows if r["k"] and r["n"] >= 6]
    xf = np.array([r["x"] for r in fit_rows])
    yf = np.log([r["k"] for r in fit_rows])
    groups = [r["rid"] for r in fit_rows]
    pred = np.zeros_like(yf)
    for tr, te in GroupKFold(n_splits=5).split(xf, yf, groups):
        pred[te] = model().fit(xf[tr], yf[tr]).predict(xf[te])
    r2 = 1 - ((yf - pred) ** 2).sum() / ((yf - yf.mean()) ** 2).sum()
    mae_model = float(np.median(np.abs(yf - pred)))
    mae_const = float(np.median(np.abs(yf - np.median(yf))))
    fit = model().fit(xf, yf)
    rng = np.random.default_rng(SEED)
    background = xf[rng.choice(len(xf), 30, replace=False)]
    phi, base = shapley(fit, x_all, background)
    k_hat = np.exp(fit.predict(x_all))
    importance = np.abs(phi[[i for i, r in enumerate(rows) if r["k"] and r["n"] >= 6]]).mean(axis=0)

    for i, r in enumerate(rows):
        t = trust["regions"].get(r["rid"])
        if t is None:
            continue
        t.setdefault("distance", [None] * 12)[r["month"]] = r["distance"]
        t.setdefault("why_k", [None] * 12)[r["month"]] = {
            "k_model": round(float(k_hat[i]), 3),
            "base": round(float(math.exp(base[0])), 3),
            "parts": [{"f": f, "label": LABELS[f], "ln": round(float(phi[i, j]), 4), "value": round(float(r["x"][j]), 3)} for j, f in enumerate(FEATURES)],
        }

    t1 = transfer_test(regions, geo)
    t2 = burned_area_test(regions)
    trust["summary"]["advanced"] = {
        "coverage_distance": {"method": "mean distance to the 5 nearest High-coverage region-months, median/IQR scaled", "features": [LABELS[f] for f in FEATURES], "reference": int(ref_mask.sum()), "d75": round(d75, 3), "d95": round(d95, 3), "d99": round(d99, 3), "zones": {zz: sum(1 for r in rows if r["distance"]["zone"] == zz) for zz in ["core", "edge", "outside"]}},
        "why_k": {"method": "gradient-boosted trees on ln k, exact interventional Shapley values (32 coalitions, 30 real background rows)", "rows": len(fit_rows), "cv": "GroupKFold by region (5 folds)", "r2_unseen_regions": round(float(r2), 3), "median_abs_ln_error": round(mae_model, 4), "median_abs_ln_error_constant": round(mae_const, 4), "importance": [{"f": f, "label": LABELS[f], "mean_abs_ln": round(float(v), 4)} for f, v in zip(FEATURES, importance)]},
        "tests": [t1, t2],
    }
    with open(GLOBAL / "trust_global.json", "w", encoding="utf-8") as handle:
        json.dump(trust, handle, separators=(",", ":"))
    card_path = GLOBAL / "method_card.json"
    card = json.load(open(card_path))
    card["advanced"] = trust["summary"]["advanced"]
    with open(card_path, "w", encoding="utf-8") as handle:
        json.dump(card, handle, indent=1, ensure_ascii=False)
    with open(ROOT / "frontend" / "public" / "data" / "method_card.json", "w", encoding="utf-8") as handle:
        json.dump(card, handle, indent=1, ensure_ascii=False)
    print(json.dumps({k: v for k, v in trust["summary"]["advanced"].items() if k != "tests"}, indent=1))
    print(json.dumps(t1, indent=1))
    print(json.dumps({k: v for k, v in t2.items() if k != "top"}))


if __name__ == "__main__":
    main()
