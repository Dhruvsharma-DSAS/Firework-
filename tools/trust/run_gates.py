"""Run the validation gates that the calendar data can answer, with the rules fixed on 27 Oct 2026.
Writes data/processed/global/gates.json (copied to frontend/public/data/gates.json). A gate is "passed" or "failed"
only from a real computation here; anything this script cannot compute stays "pending" with the reason.
Run from the repo root: backend/.venv/bin/python tools/trust/run_gates.py"""
import json
import math
import random
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from scipy import stats

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
GLOBAL = ROOT / "data" / "processed" / "global"
OV = list(range(2012, 2026))
SEED = 20261027


def load():
    cal = json.load(open(GLOBAL / "calendar_global.json"))["regions"]
    return {rid: r for rid, r in cal.items() if rid == "world" or rid.startswith(("c_", "b_"))}


def cell(r, key, y, m):
    i = r["years"].index(y)
    v = r[key][i][m]
    if v is None:
        return 0.0
    return float(v)


def k_month(regions, months, years):
    m = sum(cell(r, "modis", y, mo) for r in regions for y in years for mo in months)
    v = sum(cell(r, "viirs", y, mo) for r in regions for y in years for mo in months)
    if m <= 0:
        return None
    return v / m


def g1(cal):
    """Leave-one-year-out median relative error of annual totals; per region-month k vs one global k (B1)."""
    own, b1 = [], []
    for y in OV:
        train = [t for t in OV if t != y]
        kg = k_month([cal["world"]], range(12), train)
        e_own, e_b1 = [], []
        for rid, r in cal.items():
            pred, pred_b1, v_tot, m_tot = 0.0, 0.0, 0.0, 0.0
            for mo in range(12):
                k = k_month([r], [mo], train)
                m = cell(r, "modis", y, mo)
                if k is not None:
                    pred += k * m
                pred_b1 += kg * m
                v_tot += cell(r, "viirs", y, mo)
            if v_tot >= 100:
                e_own.append(abs(pred - v_tot) / v_tot)
                e_b1.append(abs(pred_b1 - v_tot) / v_tot)
        own.append(float(np.median(e_own)))
        b1.append(float(np.median(e_b1)))
    a, b = float(np.median(own)), float(np.median(b1))
    return {"value": round(a, 4), "b1_one_global_k": round(b, 4), "rule": "median relative error ≤ 0.15 and better than B1 (one global k)", "pass": a <= 0.15 and a < b}


def continents():
    data = json.load(open(ROOT / "frontend" / "public" / "data" / "countries.json"))["data"]["features"]
    return {"c_" + f["properties"]["iso3"].lower(): f["properties"]["continent"] for f in data if f["properties"].get("iso3")}


def g2(cal):
    """Train on the other countries of the same continent, test on this country; compare with its own LOYO error."""
    cont = continents()
    by = {}
    for rid in cal:
        if rid in cont:
            by.setdefault(cont[rid], []).append(rid)
    ratios, t_err, o_err = [], [], []
    for c, members in by.items():
        for rid in members:
            others = [cal[x] for x in members if x != rid]
            r = cal[rid]
            for y in OV:
                v_tot = sum(cell(r, "viirs", y, mo) for mo in range(12))
                if v_tot < 100:
                    continue
                train = [t for t in OV if t != y]
                pt, po = 0.0, 0.0
                for mo in range(12):
                    m = cell(r, "modis", y, mo)
                    kt = k_month(others, [mo], train)
                    ko = k_month([r], [mo], train)
                    if kt is not None:
                        pt += kt * m
                    if ko is not None:
                        po += ko * m
                t_err.append(abs(pt - v_tot) / v_tot)
                o_err.append(abs(po - v_tot) / v_tot)
    a, b = float(np.median(t_err)), float(np.median(o_err))
    return {"value": round(a / b, 3), "transfer_error": round(a, 4), "in_region_error": round(b, 4), "n": len(t_err), "rule": "error ≤ 1.5 × in-region error", "pass": a <= 1.5 * b}


def seam_ratios(cal):
    out = []
    for rid, r in cal.items():
        ann = {y: (sum(cell(r, "modis", y, mo) for mo in range(12)), sum(cell(r, "viirs", y, mo) for mo in range(12))) for y in range(2009, 2015)}
        kk = sum(ann[y][1] for y in (2012, 2013, 2014)) / max(sum(ann[y][0] for y in (2012, 2013, 2014)), 1)
        before_raw = math.log(np.mean([ann[y][0] for y in (2009, 2010, 2011)]) + 1)
        after_raw = math.log(np.mean([ann[y][1] for y in (2012, 2013, 2014)]) + 1)
        before_h = math.log(kk * np.mean([ann[y][0] for y in (2009, 2010, 2011)]) + 1)
        if abs(after_raw - before_raw) > 0.1:
            out.append(abs(after_raw - before_h) / abs(after_raw - before_raw))
    return out


def g3(cal):
    s = np.array(seam_ratios(cal))
    rng = np.random.default_rng(SEED)
    boots = np.median(s[rng.integers(0, len(s), (2000, len(s)))], axis=1)
    hi = float(np.percentile(boots, 97.5))
    return {"value": round(float(np.median(s)), 4), "upper_ci95": round(hi, 4), "regions": int(len(s)), "rule": "seam ratio upper 95 % CI ≤ 0.25", "pass": hi <= 0.25}


def harmonised(r):
    """Annual harmonised series 2001-2025: k(region, month) × MODIS before 2012, VIIRS S-NPP from 2012."""
    k = r.get("k_baseline") or {}
    out = {}
    for y in range(2001, 2026):
        tot = 0.0
        for mo in range(12):
            if y < 2012:
                e = k.get(str(mo + 1))
                if e is None:
                    return None
                tot += e["k"] * cell(r, "modis", y, mo)
            else:
                tot += cell(r, "viirs", y, mo)
        out[y] = tot
    return out


def step_p(series, y, before=4, after=4):
    a = [math.log(series[t] + 1) for t in range(y - before, y) if t in series]
    b = [math.log(series[t] + 1) for t in range(y, y + after) if t in series]
    if len(a) < 3 or len(b) < 3 or np.std(a + b) == 0:
        return None
    return float(stats.ttest_ind(a, b, equal_var=False).pvalue)


def g4_g5(cal):
    series = {}
    for rid, r in cal.items():
        h = harmonised(r)
        if h is not None and sum(h.values()) >= 25 * 100:
            series[rid] = h
    cands = [y for y in range(2005, 2009)] + [y for y in range(2016, 2023)]
    random.seed(SEED)
    placebo_years = cands
    flags, total = 0, 0
    for h in series.values():
        for y in placebo_years:
            p = step_p(h, y)
            if p is None:
                continue
            total += 1
            if p < 0.05:
                flags += 1
    fpr = flags / total
    raw_flags, raw_total = 0, 0
    for rid in series:
        r = cal[rid]
        raw = {y: sum(cell(r, "modis" if y < 2012 else "viirs", y, mo) for mo in range(12)) for y in range(2008, 2016)}
        p = step_p(raw, 2012)
        if p is not None:
            raw_total += 1
            if p < 0.05:
                raw_flags += 1
    g4 = {"value": round(fpr, 4), "placebo_years": placebo_years, "tests": total, "regions": len(series),
          "power_check_raw_2012": round(raw_flags / max(raw_total, 1), 4),
          "method": "Welch t-test on log annual harmonised totals, 4 years before vs 4 after each placebo year (all 11 years whose window avoids 2012; the plan said 20, only 11 exist)",
          "rule": "false-positive rate ≤ 10 %", "pass": fpr <= 0.10}
    res = {}
    for y, after in [(2018, 4), (2023, 3)]:
        f, n = 0, 0
        for h in series.values():
            p = step_p(h, y, 4, after)
            if p is None:
                continue
            n += 1
            if p < 0.05:
                f += 1
        res[str(y)] = {"flag_rate": round(f / n, 4), "tests": n, "excess_vs_placebo": bool(stats.binomtest(f, n, max(fpr, 0.05), alternative="greater").pvalue < 0.05)}
    g5 = {"value": res, "rule": "no break after harmonisation at 2018 and 2023 (α = 0.05): flag rate not above the placebo rate", "pass": not any(v["excess_vs_placebo"] for v in res.values())}
    return g4, g5


def g7(cal):
    d = []
    for y in OV:
        train = [t for t in OV if t != y]
        for rid, r in cal.items():
            if rid == "world":
                continue
            for mo in range(12):
                m, v = cell(r, "modis", y, mo), cell(r, "viirs", y, mo)
                if m < 10 or v < 10:
                    continue
                k = k_month([r], [mo], train)
                if k is None:
                    continue
                d.append(math.log((k * m + 0.5) / (v + 0.5)))
    d = np.array(d)
    bias = float(d.mean())
    return {"value": round(bias, 4), "median": round(float(np.median(d)), 4), "limits_of_agreement": [round(bias - 1.96 * float(d.std()), 3), round(bias + 1.96 * float(d.std()), 3)], "n": int(len(d)),
            "method": "Bland–Altman on ln((k·MODIS + 0.5) / (VIIRS + 0.5)), k learned without the held-out year, region-months with ≥ 10 cell-days each",
            "rule": "|bias| ≤ 0.1", "pass": abs(bias) <= 0.1}


def g8():
    from app import main
    bad, regions, cells = [], 0, 0
    for rid in json.load(open(GLOBAL / "calendar_global.json"))["regions"]:
        try:
            data = main.calendar_from_global(rid)
        except Exception as error:
            bad.append(rid + ": " + type(error).__name__)
            continue
        if data is None:
            continue
        data = data["data"]
        regions += 1
        for key, skey in [("modis", "status_modis"), ("viirs", "status_viirs")]:
            for yi, row in enumerate(data[key]):
                st = data.get(skey)
                for mi, v in enumerate(row):
                    cells += 1
                    s = None
                    if st:
                        s = st[yi][mi]
                    if v is not None and s is None:
                        bad.append("%s %s %d-%d value without status" % (rid, key, data["years"][yi], mi + 1))
                    if v == 0 and s not in ("ok", "none", "nrt"):
                        bad.append("%s %s %d-%d zero without status" % (rid, key, data["years"][yi], mi + 1))
    return {"value": len(bad), "regions": regions, "cells": cells, "examples": bad[:5],
            "method": "every region through the API calendar builder: no crash; every value carries a status; a 0 appears only where the month was processed and had no fire",
            "rule": "no crash; a status, never 0", "pass": len(bad) == 0}


def arrays(csv):
    """Colab region-month table (World, countries, states, boxes) -> MODIS and VIIRS arrays [region, year 2009-2025, month]."""
    import pandas as pd
    rm = pd.read_csv(csv, usecols=["region_id", "family", "year", "month", "fire_cell_days"])
    rm = rm[(rm.year >= 2009) & (rm.year <= 2025) & ~rm.region_id.str.endswith("-99")]
    ids = sorted(rm.region_id.unique())
    ix = {r: i for i, r in enumerate(ids)}
    M = np.zeros((len(ids), 17, 12))
    V = np.zeros((len(ids), 17, 12))
    for fam, A in [("modis", M), ("viirs", V)]:
        f = rm[rm.family == fam]
        A[f.region_id.map(ix).values, f.year.values - 2009, f.month.values - 1] = f.fire_cell_days.values
    return ids, M, V


def g1_all(ids, M, V):
    """G1 over every region (as in Colab validate) plus the B1 comparison: one global k from World."""
    w = ids.index("world")
    oy = np.arange(3, 17)
    own, b1 = [], []
    for y in oy:
        tr = [t for t in oy if t != y]
        km = V[:, tr, :].sum(1) / np.where(M[:, tr, :].sum(1) > 0, M[:, tr, :].sum(1), np.nan)
        kg = V[w, tr, :].sum() / M[w, tr, :].sum()
        vt = V[:, y, :].sum(1)
        pred = np.nansum(km * M[:, y, :], 1)
        predg = kg * M[:, y, :].sum(1)
        ok = vt >= 100
        own.append(float(np.median(np.abs(pred[ok] - vt[ok]) / vt[ok])))
        b1.append(float(np.median(np.abs(predg[ok] - vt[ok]) / vt[ok])))
    a, b = float(np.median(own)), float(np.median(b1))
    return {"value": round(a, 4), "b1_one_global_k": round(b, 4), "regions": "world, countries, states and boxes", "rule": "median relative error ≤ 0.15 and better than B1 (one global k)", "pass": a <= 0.15 and a < b}


def g3_all(M, V):
    am, av = M.sum(2), V.sum(2)
    kk = av[:, 3:6].sum(1) / np.maximum(am[:, 3:6].sum(1), 1)
    before_raw = np.log(am[:, 0:3].mean(1) + 1)
    after_raw = np.log(av[:, 3:6].mean(1) + 1)
    before_h = np.log(kk * am[:, 0:3].mean(1) + 1)
    present = ((am[:, 0:6] + av[:, 0:6]) > 0).all(1)
    keep = present & (np.abs(after_raw - before_raw) > 0.1)
    s = np.abs(after_raw - before_h)[keep] / np.abs(after_raw - before_raw)[keep]
    rng = np.random.default_rng(SEED)
    boots = np.median(s[rng.integers(0, len(s), (2000, len(s)))], axis=1)
    hi = float(np.percentile(boots, 97.5))
    return {"value": round(float(np.median(s)), 4), "upper_ci95": round(hi, 4), "regions": int(len(s)), "rule": "seam ratio upper 95 % CI ≤ 0.25", "pass": hi <= 0.25}


def main():
    cal = load()
    ids, M, V = arrays(sys.argv[1])
    out = {"generated_at_utc": datetime.now(timezone.utc).isoformat(), "rules_fixed": "2026-10-27", "gates": {}}
    out["gates"]["G1"] = g1_all(ids, M, V)
    print("G1", out["gates"]["G1"])
    out["gates"]["G2"] = g2(cal)
    print("G2", out["gates"]["G2"])
    out["gates"]["G3"] = g3_all(M, V)
    print("G3", out["gates"]["G3"])
    g4, g5 = g4_g5(cal)
    out["gates"]["G4"], out["gates"]["G5"] = g4, g5
    print("G4", g4)
    print("G5", g5)
    out["gates"]["G7"] = g7(cal)
    print("G7", out["gates"]["G7"])
    out["gates"]["G8"] = g8()
    print("G8", {k: v for k, v in out["gates"]["G8"].items() if k != "examples"}, out["gates"]["G8"]["examples"][:2])
    for g in out["gates"].values():
        g["status"] = "passed" if g["pass"] else "failed"
    (GLOBAL / "gates.json").write_text(json.dumps(out, indent=1, ensure_ascii=False))
    shutil.copy(GLOBAL / "gates.json", ROOT / "frontend" / "public" / "data" / "gates.json")


if __name__ == "__main__":
    main()
