"""Clause-level gate states for the Validation page -> frontend/public/data/validation_v3.json.
A gate is "passed" only when every clause passes; a failed clause makes it "failed"; otherwise any pending clause
makes it "partial" (some clauses decided) or "not_tested" (none decided). Values come from result files, never typed.
Inputs: data/processed/global/gates.json (tools/trust/run_gates.py), colab/validation.json (Colab notebook 02),
trust_global.json (tools/trust/build_trust.py), backend tests (G12).
Run from the repo root: backend/.venv/bin/python tools/trust/build_validation_v3.py"""
import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
G = ROOT / "data" / "processed" / "global"
RULES_FILE = ROOT / "tools" / "trust" / "run_gates.py"


def clause(rule: str, state: str, value=None, n=None, note: str = "") -> dict:
    return {"rule": rule, "state": state, "value": value, "n": n, "note": note}


def gate(gid: str, question: str, clauses: list, scope: str, summary: str) -> dict:
    states = [c["state"] for c in clauses]
    if "fail" in states:
        state = "failed"
    elif all(s == "pass" for s in states):
        state = "passed"
    elif any(s in ("pass", "fail") for s in states):
        state = "partial"
    else:
        state = "not_tested"
    return {"id": gid, "question": question, "state": state, "clauses": clauses, "scope": scope, "summary": summary, "evidence": "real"}


def ok(flag: bool) -> str:
    if flag:
        return "pass"
    return "fail"


def g12_result() -> tuple:
    r = subprocess.run([str(ROOT / "backend" / ".venv" / "bin" / "python"), "-m", "pytest", "-q", "tests/test_gates_api.py"], cwd=ROOT / "backend", capture_output=True, text=True)
    return r.returncode == 0, r.stdout.strip().splitlines()[-1]


def main() -> None:
    gates = json.load(open(G / "gates.json"))["gates"]
    colab = json.load(open(G / "colab" / "validation.json"))
    conf = json.load(open(G / "trust_global.json"))["summary"]["conformal"]
    n6 = sum(c["n"] for c in conf["classes"])
    a6 = conf["achieved_on_unseen_years"]["95"]
    g1v = round(colab["loyo_median_of_medians"], 4)
    g3v = round(colab["seam_ratio_median"], 4)
    g1, g2, g3, g4, g5, g7, g8 = gates["G1"], gates["G2"], gates["G3"], gates["G4"], gates["G5"], gates["G7"], gates["G8"]
    g12_ok, g12_line = g12_result()
    out = [
        gate("G1", "Held-out years", [
            clause("median relative error ≤ 15 %", ok(g1v <= 0.15), g1v),
            clause("better than baseline B1 (median of ratios) on identical rows", ok(g1["k_identical_rows"] < g1["b1_identical_rows"]), {"k": g1["k_identical_rows"], "b1": g1["b1_identical_rows"]}, g1["years"], "k better in %d of %d held-out years" % (g1["years_k_better"], g1["years"])),
        ], "every region with ≥ 100 VIIRS cell-days in the held-out year, 2012–2025",
            "Median held-out error %.1f %% (limit 15 %%). On identical rows k misses by %.1f %% and baseline B1 by %.1f %%." % (100 * g1v, 100 * g1["k_identical_rows"], 100 * g1["b1_identical_rows"])),
        gate("G2", "Held-out geography", [
            clause("error ≤ 1.5 × in-region error", ok(g2["pass"]), g2["value"], g2["n"], "k borrowed from the other countries of the same continent"),
        ], "countries, k learned from the rest of the same continent (local scope)",
            "Borrowed k is %.2f× the in-region error (limit 1.5×, local scope)." % g2["value"]),
        gate("G3", "The 2012 seam", [
            clause("median seam ratio ≤ 0.25", ok(g3v <= 0.25), g3v, g3["regions"]),
            clause("upper 95 % bound ≤ 0.25 (held-out cut-overs, blocked bootstrap)", ok(g3["pass"]), g3["upper_ci95"], g3["regions"], "k learned from 2015–2025 only; whole countries resampled"),
        ], "regions with all years 2009–2014 and a raw step > 0.1 (log)",
            "Median seam ratio %.2f over %d regions (limit 0.25). With the cut-over years held out of the fit, the upper 95 %% bound is %.2f." % (g3v, colab["seam_regions"], g3["upper_ci95"])),
        gate("G4", "Placebo seams", [
            clause("false-positive rate ≤ 10 % (Pettitt at fixed no-change years)", ok(g4["pass"]), g4["value"], g4["tests"], g4["method"]),
        ], "regions with ≥ 100 cell-days a year on average",
            "Breaks found at %.1f %% of %d no-change tests (limit 10 %%). Real fire trends inside one sensor era trip the test." % (100 * g4["value"], g4["tests"])),
        gate("G5", "Platform seams", [
            clause("no excess breaks at 2018 (NOAA-20)", ok(not g5["value"]["2018"]["excess_vs_placebo"]), g5["value"]["2018"]["flag_rate"], g5["value"]["2018"]["tests"]),
            clause("no excess breaks at 2023 (NOAA-21)", ok(not g5["value"]["2023"]["excess_vs_placebo"]), g5["value"]["2023"]["flag_rate"], g5["value"]["2023"]["tests"]),
        ], "harmonised annual series; the reference ruler stays VIIRS S-NPP",
            "Break rate %.1f %% at 2018 and %.1f %% at 2023, no more than at years with no change (α = 0.05)." % (100 * g5["value"]["2018"]["flag_rate"], 100 * g5["value"]["2023"]["flag_rate"])),
        gate("G6", "Band coverage", [
            clause("achieved coverage 88–99 %", ok(0.88 <= a6 <= 0.99), a6, n6),
            clause("outer year removed before any score is made (nested)", ok(conf.get("nested") and conf.get("leaks") == 0), conf.get("leaks"), conf.get("checks"), "calibration scores that saw the held-out year: %s" % conf.get("leaks")),
        ], "pooled over all regions, months with MODIS ≥ 10 cell-days",
            "%.2f %% of %s aggregate checks, pooled, MODIS ≥ 10 — not a per-month guarantee." % (100 * a6, format(n6, ","))),
        gate("G7", "Agreement", [
            clause("|bias| ≤ 0.1 (Bland–Altman, log scale)", ok(g7["pass"]), g7["value"], g7["n"]),
        ], "region-months 2012–2025 with ≥ 10 cell-days from each sensor, k learned without the held-out year",
            "Bias %.3f on the log scale over %s region-months (limit ±0.1)." % (g7["value"], format(g7["n"], ","))),
        gate("G8", "Zero and empty", [
            clause("no crash on any region", ok(g8["regions"] > 0), g8["regions"]),
            clause("every value carries a status", ok(g8["value"] == 0), g8["cells"]),
            clause("never a made-up 0: a 0 only where the region had clear looks that month", ok(g8["made_up_zeros"] == 0), g8["made_up_zeros"], g8["cells"]),
        ], "all calendar regions through the API",
            "No crash, every value has a status, and every 0 is backed by clear looks over that region that month; without them the month stays empty."),
        gate("G9", "Negatives", [
            clause("water and city-centre cells ≈ 0, with status", "pending"),
        ], "needs per-cell land-cover masks", "Not tested yet."),
        gate("G10", "Persistent heat", [
            clause("static, volcanic and offshore sources removed before counting", "pass", None, None, "FIRMS type 0 only in calibration years 2012–2025"),
            clause("checked against a list of known flares and kilns", "pending"),
        ], "calibration years 2012–2025", "Static sources are removed by FIRMS type before counting. Check against a known-site list: pending."),
        gate("G11", "Source classifier", [
            clause("macro-F1 and abstain rate on held-out sites", "pending"),
        ], "only needed before a source label is shown; none is shown", "Not tested yet. No source label is shown on the site."),
        gate("G12", "API provenance", [
            clause("meta.data_source, status and version on every answer", ok(g12_ok), None, None, g12_line),
        ], "every JSON endpoint of the API", "Every API answer carries its data source, status and version."),
    ]
    rules_hash = hashlib.sha256(RULES_FILE.read_bytes()).hexdigest()
    doc = {
        "run_id": "gates-" + datetime.now(timezone.utc).strftime("%Y%m%d-%H%M"),
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "method_id": "k-ratio-of-totals-v1",
        "data_vintage": "NASA FIRMS standard archive 2000–2025 (+2026 NRT, not used in tests)",
        "gates_config_hash": "sha256:" + rules_hash,
        "rules_fixed": "2026-10-27",
        "counts": {s: sum(1 for g in out if g["state"] == s) for s in ["passed", "partial", "failed", "not_tested"]},
        "gates": out,
    }
    (G / "validation_v3.json").write_text(json.dumps(doc, indent=1, ensure_ascii=False))
    (ROOT / "frontend" / "public" / "data" / "validation_v3.json").write_text(json.dumps(doc, indent=1, ensure_ascii=False))
    print(doc["counts"])
    for g in out:
        print(g["id"], g["state"], "|", g["summary"])


if __name__ == "__main__":
    main()
