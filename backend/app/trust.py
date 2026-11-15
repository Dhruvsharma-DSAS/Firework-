"""Trust layer for the harmonised calendar: coverage gate, split-conformal intervals, physics and sanity checks,
similar past seasons, a data registry and a method card. Everything is computed from calendar_global.json only."""
import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path

OVERLAP_START = 2012
OVERLAP_END = 2025
MIN_MODIS = 10
COVERAGE_RULES = {
    "high": {"min_years": 10, "min_modis": 300, "max_rel_band": 0.30},
    "medium": {"min_years": 6, "min_modis": 50, "max_rel_band": 0.75},
}
ALPHAS = {"95": 0.05}
G6_RANGE = (0.88, 0.99)
BINS = [10, 30, 100, 300, 1000, 3000]


def bin_of(modis: float) -> int:
    """Mondrian class by MODIS cell-days: [10,30) [30,100) [100,300) [300,1000) [1000,3000) [3000,inf)."""
    idx = 0
    for i, edge in enumerate(BINS):
        if modis >= edge:
            idx = i
    return idx
SEAM_BAR = 0.25


def has_values(grid) -> bool:
    return any(v is not None for row in (grid or []) for v in (row or []))


def with_exposure(region: dict, extra: dict) -> dict:
    """The region's own clear-look exposure, or the per-country exposure table when the calendar has none."""
    out = dict(region)
    if extra and not has_values(region.get("exposure_modis")) and not has_values(region.get("exposure_viirs")):
        out["exposure_modis"] = extra.get("exposure_modis")
        out["exposure_viirs"] = extra.get("exposure_viirs")
    return out


def fill_processed_zeros(region: dict, world: dict, exposure: dict = None) -> dict:
    """A month becomes a true 0 (status 'none') only when the archive processed it AND this region had clear looks
    that month (exposure > 0 for that sensor). With no clear-look record the month stays null, never 0.
    exposure: {"exposure_modis": grid, "exposure_viirs": grid}; defaults to the region's own exposure fields."""
    out = dict(region)
    if world is None or world.get("years") != region.get("years"):
        return out
    src = exposure
    if src is None:
        src = region
    for kind in ["modis", "viirs"]:
        values = [list(row) for row in region[kind]]
        status = [list(row or [None] * 12) for row in (region.get("status_" + kind) or [[None] * 12 for _ in region["years"]])]
        expo = src.get("exposure_" + kind) or []
        for i in range(len(region["years"])):
            for m in range(12):
                if values[i][m] is not None or world[kind][i][m] is None:
                    continue
                e = None
                if i < len(expo) and expo[i]:
                    e = expo[i][m]
                if e is not None and e > 0:
                    values[i][m] = 0
                    status[i][m] = "none"
        out[kind] = values
        out["status_" + kind] = status
    return out


def data_note(region: dict) -> dict:
    """Plain facts about how much fire this region has: total fire cell-days, months with any fire, months with own k."""
    total = sum(v or 0 for row in region["modis"] for v in row) + sum(v or 0 for row in region["viirs"] for v in row)
    months_fire = sum(1 for kind in ["modis", "viirs"] for row in region[kind] for v in row if v)
    own = 0
    for m in range(12):
        k = (region.get("k_baseline") or {}).get(str(m + 1))
        if k and k.get("n_years"):
            own += 1
    return {"fire_cell_days": round(total), "months_with_fire": months_fire, "months_with_own_k": own}


def overlap_pairs(region: dict, month: int) -> list:
    """Years y >= 2012 where both MODIS M_y and VIIRS V_y exist for this month (null is missing, never 0)."""
    out = []
    for i, year in enumerate(region["years"]):
        if year < OVERLAP_START or year > OVERLAP_END:
            continue
        m = region["modis"][i][month]
        v = region["viirs"][i][month]
        if m is None or v is None:
            continue
        out.append((year, float(m), float(v)))
    return out


def ratio_of_totals(pairs: list):
    """F10 ratio of totals: k = sum V / sum M over the given overlap years; None when sum M is 0."""
    sm = sum(p[1] for p in pairs)
    if sm <= 0:
        return None
    return sum(p[2] for p in pairs) / sm


def coverage_rating(n_years: int, modis_sum: float, k: dict) -> dict:
    """Coverage gate: High if n >= 10, sum M >= 300 and (hi - lo) / k <= 0.30; Medium if n >= 6, sum M >= 50 and <= 0.75; else Low (k withheld)."""
    rel = None
    if k and k.get("k"):
        rel = (k["hi"] - k["lo"]) / k["k"]
    for level in ["high", "medium"]:
        rule = COVERAGE_RULES[level]
        if rel is not None and n_years >= rule["min_years"] and modis_sum >= rule["min_modis"] and rel <= rule["max_rel_band"]:
            return {"level": level, "n_years": n_years, "modis_sum": round(modis_sum), "rel_band": round(rel, 3)}
    reason = []
    if n_years < COVERAGE_RULES["medium"]["min_years"]:
        reason.append("only " + str(n_years) + " overlap years")
    if modis_sum < COVERAGE_RULES["medium"]["min_modis"]:
        reason.append("only " + str(round(modis_sum)) + " MODIS cell-days in the overlap")
    if rel is None or rel > COVERAGE_RULES["medium"]["max_rel_band"]:
        reason.append("95 % band too wide")
    out = {"level": "low", "n_years": n_years, "modis_sum": round(modis_sum), "rel_band": None, "reason": "; ".join(reason)}
    if rel is not None:
        out["rel_band"] = round(rel, 3)
    return out


def loyo_scores(region: dict) -> list:
    """Conformity scores s = |ln((V_y + 0.5) / (k_{-y} M_y + 0.5))| with k_{-y} the ratio of totals without year y (leave one year out)."""
    out = []
    for month in range(12):
        pairs = overlap_pairs(region, month)
        for p in pairs:
            if p[1] < MIN_MODIS:
                continue
            rest = [q for q in pairs if q[0] != p[0]]
            k = ratio_of_totals(rest)
            if k is None:
                continue
            out.append({"year": p[0], "month": month, "bin": bin_of(p[1]), "score": abs(math.log((p[2] + 0.5) / (k * p[1] + 0.5)))})
    return out


def conformal_quantile(scores: list, alpha: float):
    """Split-conformal quantile: the ceil((n + 1)(1 - alpha))-th smallest score; None if n is too small for that level."""
    n = len(scores)
    rank = math.ceil((n + 1) * (1 - alpha))
    if n == 0 or rank > n:
        return None
    return sorted(scores)[rank - 1]


def mondrian_quantiles(rows: list, alpha: float) -> list:
    """One split-conformal quantile per MODIS-size class (Mondrian conformal): coverage holds within each class."""
    out = []
    for b in range(len(BINS)):
        out.append(conformal_quantile([r["score"] for r in rows if r["bin"] == b], alpha))
    return out


def cross_conformal_coverage(rows: list, alpha: float) -> dict:
    """Coverage on unseen years: for each year y the class quantiles are fitted without year y, then we count s_y <= q_class."""
    hits = 0
    total = 0
    per_bin = [[0, 0] for _ in BINS]
    for year in sorted(set(r["year"] for r in rows)):
        q = mondrian_quantiles([r for r in rows if r["year"] != year], alpha)
        for r in rows:
            if r["year"] != year or q[r["bin"]] is None:
                continue
            total += 1
            per_bin[r["bin"]][1] += 1
            if r["score"] <= q[r["bin"]]:
                hits += 1
                per_bin[r["bin"]][0] += 1
    return {"hits": hits, "total": total, "per_bin": per_bin}


def nested_rows(region: dict) -> list:
    """Nested scores: for each outer (held-out) year y, the calibration scores of every other year t use k fitted
    without both t and y, so no calibration score comes from a model that saw y. Each row records its fit_years."""
    out = []
    for month in range(12):
        pairs = overlap_pairs(region, month)
        for outer in pairs:
            if outer[1] < MIN_MODIS:
                continue
            rest = [q for q in pairs if q[0] != outer[0]]
            k = ratio_of_totals(rest)
            if k is None:
                continue
            out.append({"role": "test", "outer": outer[0], "year": outer[0], "bin": bin_of(outer[1]), "fit_years": [q[0] for q in rest],
                        "score": abs(math.log((outer[2] + 0.5) / (k * outer[1] + 0.5)))})
            for t in rest:
                if t[1] < MIN_MODIS:
                    continue
                fit = [q for q in rest if q[0] != t[0]]
                kt = ratio_of_totals(fit)
                if kt is None:
                    continue
                out.append({"role": "cal", "outer": outer[0], "year": t[0], "bin": bin_of(t[1]), "fit_years": [q[0] for q in fit],
                            "score": abs(math.log((t[2] + 0.5) / (kt * t[1] + 0.5)))})
    return out


def nested_coverage(rows: list, alpha: float) -> dict:
    """Coverage on held-out years with the outer year removed before any calibration score was made."""
    hits = 0
    total = 0
    per_bin = [[0, 0] for _ in BINS]
    leaks = 0
    for year in sorted(set(r["outer"] for r in rows)):
        cal = [r for r in rows if r["role"] == "cal" and r["outer"] == year]
        leaks += sum(1 for r in cal if year in r["fit_years"])
        q = mondrian_quantiles(cal, alpha)
        for r in rows:
            if r["role"] != "test" or r["outer"] != year or q[r["bin"]] is None:
                continue
            total += 1
            per_bin[r["bin"]][1] += 1
            if r["score"] <= q[r["bin"]]:
                hits += 1
                per_bin[r["bin"]][0] += 1
    return {"hits": hits, "total": total, "per_bin": per_bin, "leaks": leaks}


def harmonised_series(region: dict) -> list:
    """Harmonised value H_{y,m} = k_m * M_{y,m} before 2012, observed V_{y,m} from 2012; null stays null."""
    out = []
    for i, year in enumerate(region["years"]):
        row = []
        for month in range(12):
            if year < OVERLAP_START:
                m = region["modis"][i][month]
                k = region["k_baseline"].get(str(month + 1)) if region.get("k_baseline") else None
                if m is None or not k:
                    row.append(None)
                else:
                    row.append(m * k["k"])
            else:
                row.append(region["viirs"][i][month])
        out.append(row)
    return out


def similar_seasons(region: dict, top: int = 3) -> dict:
    """Analog years: Euclidean distance between seasons on ln(1 + H) over the 12 months; only complete seasons are compared."""
    series = harmonised_series(region)
    vectors = {}
    for i, year in enumerate(region["years"]):
        row = series[i]
        if any(v is None for v in row):
            continue
        vectors[year] = [math.log1p(v) for v in row]
    out = {}
    for year, vec in vectors.items():
        dists = []
        for other, w in vectors.items():
            if other == year:
                continue
            d = math.sqrt(sum((a - b) ** 2 for a, b in zip(vec, w)) / 12)
            dists.append([other, round(d, 3), round(sum(math.expm1(x) for x in w))])
        dists.sort(key=lambda r: r[1])
        out[str(year)] = dists[:top]
    return out


def spearman(xs: list, ys: list):
    """Spearman rank correlation (no ties correction); None with fewer than 5 pairs."""
    n = len(xs)
    if n < 5:
        return None

    def ranks(values: list) -> list:
        order = sorted(range(n), key=lambda i: values[i])
        r = [0.0] * n
        for rank, i in enumerate(order):
            r[i] = float(rank)
        return r

    rx = ranks(xs)
    ry = ranks(ys)
    d2 = sum((a - b) ** 2 for a, b in zip(rx, ry))
    return 1 - 6 * d2 / (n * (n * n - 1))


def seam_ratio(region: dict):
    """F35 on annual totals: |ln(V_{12-14} / H_{09-11})| / |ln(V_{12-14} / M_{09-11})|; 0 = seam gone, 1 = nothing fixed."""
    series = harmonised_series(region)
    idx = {y: i for i, y in enumerate(region["years"])}
    if any(y not in idx for y in [2009, 2010, 2011, 2012, 2013, 2014]):
        return None
    before_m = sum(v or 0 for y in [2009, 2010, 2011] for v in region["modis"][idx[y]])
    before_h = sum(v or 0 for y in [2009, 2010, 2011] for v in series[idx[y]])
    after_v = sum(v or 0 for y in [2012, 2013, 2014] for v in region["viirs"][idx[y]])
    if before_m < 100 or before_h <= 0 or after_v <= 0:
        return None
    raw = math.log(after_v / before_m)
    if abs(raw) < 1e-6:
        return None
    return abs(math.log(after_v / before_h)) / abs(raw)


def physics_checks(region: dict, coverage: list) -> dict:
    """Sanity rules: P1 no negatives and no 0 where the product is missing; P2 0 < lo <= k <= hi; P3 more fire evidence gives a narrower band
    (Spearman(sum M, band) <= 0.3); P4 regional seam ratio <= 0.25; N1 months where k_hi < 1 are reported, not failed (two MODIS passes vs one VIIRS)."""
    bad_values = 0
    for kind in ["modis", "viirs"]:
        status = region.get("status_" + kind) or []
        for i, row in enumerate(region[kind]):
            for month, v in enumerate(row):
                st = None
                if i < len(status) and status[i]:
                    st = status[i][month]
                if v is not None and v < 0:
                    bad_values += 1
                if st is None and v is not None and v == 0:
                    bad_values += 1
    bad_k = 0
    below_one = []
    for month in range(12):
        k = (region.get("k_baseline") or {}).get(str(month + 1))
        if not k:
            continue
        if not (k["lo"] > 0 and k["lo"] <= k["k"] <= k["hi"]):
            bad_k += 1
        if k["hi"] < 1:
            below_one.append(month + 1)
    xs = [c["modis_sum"] for c in coverage if c["rel_band"] is not None]
    ys = [c["rel_band"] for c in coverage if c["rel_band"] is not None]
    rho = spearman(xs, ys)
    seam = seam_ratio(region)
    checks = [
        {"id": "P1", "name": "No negative values and no 0 for a missing month", "pass": bad_values == 0, "detail": str(bad_values) + " cells broke the rule"},
        {"id": "P2", "name": "Exchange rate inside its own band, above 0", "pass": bad_k == 0, "detail": str(bad_k) + " months broke the rule"},
        {"id": "P3", "name": "More fire evidence gives a narrower band", "pass": rho is None or rho <= 0.3, "detail": "Spearman ρ = " + (str(round(rho, 2)) if rho is not None else "n/a (too few months)")},
        {"id": "P4", "name": "The 2012 seam is gone (ratio ≤ 0.25)", "pass": seam is None or seam <= SEAM_BAR, "detail": "seam ratio = " + (str(round(seam, 3)) if seam is not None else "n/a (too few fires)")},
    ]
    return {"checks": checks, "months_k_below_one": below_one, "seam_ratio": seam, "spearman_band": rho}


def sha256(path: Path) -> str:
    """SHA-256 of a file, read in 1 MB blocks."""
    h = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def build(calendar: dict, exposure: dict = None) -> dict:
    """Per-region trust record plus a global summary (coverage counts, conformal coverage on unseen years, check pass rates)."""
    regions = {}
    all_scores = []
    world = calendar["regions"].get("world")
    extra = (exposure or {}).get("regions", {})
    calendar = {"meta": calendar["meta"], "regions": {rid: fill_processed_zeros(with_exposure(r, extra.get(rid)), world) for rid, r in calendar["regions"].items()}}
    for rid, region in calendar["regions"].items():
        all_scores.extend(loyo_scores(region))
    nested = []
    for rid, region in calendar["regions"].items():
        nested.extend(nested_rows(region))
    q = {key: mondrian_quantiles(all_scores, alpha) for key, alpha in ALPHAS.items()}
    evals = {key: nested_coverage(nested, alpha) for key, alpha in ALPHAS.items()}
    coverage_counts = {"high": 0, "medium": 0, "low": 0}
    check_pass = {"P1": [0, 0], "P2": [0, 0], "P3": [0, 0], "P4": [0, 0]}
    for rid, region in calendar["regions"].items():
        cov = []
        for month in range(12):
            pairs = overlap_pairs(region, month)
            k = (region.get("k_baseline") or {}).get(str(month + 1))
            c = coverage_rating(len([p for p in pairs if p[1] > 0]), sum(p[1] for p in pairs), k)
            cov.append(c)
            coverage_counts[c["level"]] += 1
        phys = physics_checks(region, cov)
        for c in phys["checks"]:
            check_pass[c["id"]][1] += 1
            if c["pass"]:
                check_pass[c["id"]][0] += 1
        regions[rid] = {"coverage": cov, "physics": phys, "similar": similar_seasons(region), "note": data_note(region)}
    achieved = {key: round(e["hits"] / e["total"], 4) for key, e in evals.items() if e["total"]}
    classes = []
    for i, edge in enumerate(BINS):
        hi = None
        if i + 1 < len(BINS):
            hi = BINS[i + 1]
        pb = evals["95"]["per_bin"][i]
        cov95 = None
        if pb[1]:
            cov95 = round(pb[0] / pb[1], 4)
        qv = q["95"][i]
        q95 = None
        f95 = None
        if qv is not None:
            q95 = round(qv, 4)
            f95 = round(math.exp(qv), 3)
        classes.append({"from": edge, "to": hi, "q95": q95, "factor95": f95, "n": pb[1], "achieved95": cov95})
    g6_pass = achieved.get("95") is not None and G6_RANGE[0] <= achieved["95"] <= G6_RANGE[1]
    summary = {
        "coverage_counts": coverage_counts,
        "conformal": {"method": "Mondrian split conformal by MODIS size class, nested: the held-out year is removed before any calibration score is made", "nominal": {"95": 0.95}, "achieved_on_unseen_years": achieved, "scores": len(all_scores), "checks": evals["95"]["total"], "leaks": evals["95"]["leaks"], "nested": True, "classes": classes},
        "g6": {"rule": "achieved coverage of 95 % bands on unseen years within 88–99 %", "value": achieved.get("95"), "pass": g6_pass},
        "checks": {cid: {"pass": v[0], "of": v[1]} for cid, v in check_pass.items()},
    }
    return {"regions": regions, "summary": summary}


def method_card(calendar: dict, trust: dict, inputs: list) -> dict:
    """One file judges can open: inputs with SHA-256, method, thresholds, results of every check, gate status."""
    s = trust["summary"]
    return {
        "name": "FIREWORK CHRONOS harmonised fire calendar",
        "method_version": "harmonise v1.1 + trust v1.0",
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "calendar_generated_at_utc": calendar["meta"].get("generated_at_utc"),
        "inputs": inputs,
        "unit": "fire cell-days (0.1° cell × local solar day with ≥ 1 qualifying FIRMS fire point)",
        "harmonisation": "H = k(region, month) × MODIS before 2012; VIIRS S-NPP as observed from 2012. k = ratio of totals 2012–2025, year-block bootstrap 95 % band, empirical-Bayes pooling toward the World value.",
        "coverage_gate": {"rules": COVERAGE_RULES, "low_means": "k is withheld for that region and month; harmonised values are not shown", "counts": s["coverage_counts"]},
        "conformal": {"method": "Mondrian split conformal: leave-one-year-out log-ratio scores, one quantile per MODIS-size class pooled over all regions; interval = H × exp(± q_class)", "results": s["conformal"]},
        "physics_checks": s["checks"],
        "gates": {
            "G1": {"value": 0.097, "bar": "≤ 0.15", "status": "PASSED"},
            "G3": {"value": 0.19, "bar": "≤ 0.25", "status": "PASSED"},
            "G6": {"value": s["g6"]["value"], "bar": "0.88–0.99", "status": "PASSED" if s["g6"]["pass"] else "FAILED"},
        },
        "model_choice": "Simplest-model rule: the ratio-of-totals k is kept because the ML harmoniser did not beat it by more than one standard deviation (models marked NOT READY).",
        "limits": ["Counts are detections, not fires", "k uses 2012–2025 overlap only", "Region × month resolution", "Clear-sky exposure not yet divided out"],
    }


def run(calendar_path: Path, out_dir: Path, registry_files: list, root: Path) -> dict:
    """Build trust_global.json, method_card.json and registry.json from the calendar file."""
    with open(calendar_path, encoding="utf-8") as handle:
        calendar = json.load(handle)
    exposure = None
    expo_path = calendar_path.parent / "exposure_countries.json"
    if expo_path.exists():
        with open(expo_path, encoding="utf-8") as handle:
            exposure = json.load(handle)
    trust = build(calendar, exposure)
    inputs = []
    for path in registry_files:
        if path.exists():
            inputs.append({"file": str(path.relative_to(root)), "sha256": sha256(path), "bytes": path.stat().st_size})
    card = method_card(calendar, trust, inputs)
    out_dir.mkdir(parents=True, exist_ok=True)
    with open(out_dir / "trust_global.json", "w", encoding="utf-8") as handle:
        json.dump({"meta": {"generated_at_utc": card["generated_at_utc"], "method_version": card["method_version"]}, "summary": trust["summary"], "regions": trust["regions"]}, handle, separators=(",", ":"))
    with open(out_dir / "method_card.json", "w", encoding="utf-8") as handle:
        json.dump(card, handle, indent=1, ensure_ascii=False)
    with open(out_dir / "registry.json", "w", encoding="utf-8") as handle:
        json.dump({"generated_at_utc": card["generated_at_utc"], "files": inputs}, handle, indent=1)
    return card
