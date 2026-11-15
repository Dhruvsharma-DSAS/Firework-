import json
import math
from pathlib import Path

from app.trust import conformal_quantile, coverage_rating, loyo_scores, overlap_pairs, ratio_of_totals, seam_ratio, sha256, similar_seasons

ROOT = Path(__file__).resolve().parents[2]


def region(modis_by_year, viirs_by_year, k=2.0):
    years = sorted(set(modis_by_year) | set(viirs_by_year))
    return {
        "years": years,
        "modis": [[modis_by_year.get(y)] * 12 for y in years],
        "viirs": [[viirs_by_year.get(y)] * 12 for y in years],
        "k_baseline": {str(m): {"k": k, "lo": k * 0.9, "hi": k * 1.1} for m in range(1, 13)},
    }


def test_ratio_of_totals_and_null_is_missing():
    r = region({2011: 50, 2012: 100, 2013: 200}, {2012: 200, 2013: None})
    pairs = overlap_pairs(r, 0)
    assert pairs == [(2012, 100.0, 200.0)]
    assert ratio_of_totals(pairs) == 2.0
    assert ratio_of_totals([]) is None


def test_conformal_quantile_rank():
    scores = [i / 100 for i in range(1, 101)]
    assert conformal_quantile(scores, 0.05) == 0.96
    assert conformal_quantile([0.1, 0.2], 0.05) is None


def test_loyo_never_uses_the_held_out_year():
    r = region({2012: 100, 2013: 100, 2014: 100}, {2012: 200, 2013: 200, 2014: 800})
    rows = [s for s in loyo_scores(r) if s["year"] == 2014 and s["month"] == 0]
    assert len(rows) == 1
    assert abs(rows[0]["score"] - abs(math.log(800.5 / 200.5))) < 1e-9


def test_coverage_gate_levels():
    k = {"k": 2.0, "lo": 1.8, "hi": 2.2}
    assert coverage_rating(14, 1000, k)["level"] == "high"
    assert coverage_rating(7, 60, {"k": 2.0, "lo": 1.5, "hi": 2.6})["level"] == "medium"
    low = coverage_rating(3, 10, k)
    assert low["level"] == "low" and "overlap years" in low["reason"]


def test_seam_ratio_zero_when_k_matches():
    r = region({y: 100 for y in range(2009, 2015)}, {y: 200 for y in range(2012, 2015)}, k=2.0)
    assert seam_ratio(r) < 1e-9


def test_similar_seasons_excludes_self():
    r = region({y: 100 + y for y in range(2005, 2012)}, {}, k=2.0)
    out = similar_seasons(r)
    assert "2008" in out
    assert all(row[0] != 2008 for row in out["2008"])
    assert out["2008"][0][0] in (2007, 2009)


def test_registry_matches_files():
    reg = json.loads((ROOT / "data" / "processed" / "global" / "registry.json").read_text())
    assert reg["files"]
    for f in reg["files"]:
        assert sha256(ROOT / f["file"]) == f["sha256"], f["file"] + " changed since the registry was built"


def test_mondrian_conformal_holds_coverage_on_unseen_years():
    import random
    from app.trust import cross_conformal_coverage
    rng = random.Random(1)
    rows = [{"year": 2012 + (i % 14), "bin": i % 3, "score": abs(rng.gauss(0, 0.2 * (1 + i % 3)))} for i in range(4200)]
    ev = cross_conformal_coverage(rows, 0.05)
    assert 0.93 <= ev["hits"] / ev["total"] <= 0.97


def test_country_exposure_missing_years_are_null_and_join_is_sane():
    data = json.loads((ROOT / "data" / "processed" / "global" / "exposure_countries.json").read_text())
    years = json.loads((ROOT / "data" / "processed" / "global" / "calendar_global.json").read_text())["regions"]["c_ind"]["years"]
    india = data["regions"]["c_ind"]
    for y in (2009, 2015):
        assert all(v is None for v in india["exposure_modis"][years.index(y)])
    assert 0.5 <= india["fire_ratio_ee_to_firms"] <= 2
    assert len(data["regions"]) >= 200


def test_processed_months_without_fire_become_zero_unprocessed_stay_null():
    from app.trust import fill_processed_zeros
    world = {"years": [2000, 2001], "modis": [[None] * 12, [5.0] * 12], "viirs": [[None] * 12, [None] * 12]}
    clear = [[None] * 12, [40.0] * 6 + [None] * 6]
    r = {"years": [2000, 2001], "modis": [[None] * 12, [None] * 11 + [3.0]], "viirs": [[None] * 12, [None] * 12], "status_modis": None, "status_viirs": None, "exposure_modis": clear}
    out = fill_processed_zeros(r, world)
    assert out["modis"][0][0] is None
    assert out["modis"][1][0] == 0 and out["status_modis"][1][0] == "none"
    assert out["modis"][1][7] is None
    assert out["modis"][1][11] == 3.0
    assert out["viirs"][1][0] is None
    assert r["modis"][1][0] is None
    no_looks = dict(r, exposure_modis=None)
    assert fill_processed_zeros(no_looks, world)["modis"][1][0] is None
