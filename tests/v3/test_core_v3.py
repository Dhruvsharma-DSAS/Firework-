"""One test per v3 fix, with the expected values from docs/v3/results_v3.json."""
import json
import math
from datetime import date
from decimal import Decimal, ROUND_FLOOR
from pathlib import Path

import numpy as np
import pytest

from app import core

FIX = json.load(open(Path(__file__).resolve().parents[2] / "docs" / "v3" / "results_v3.json"))


def test_coverage_union():
    det = {("terra", "c1", 1), ("aqua", "c1", 2)}
    usable = {("terra", "c1", 1), ("terra", "c1", 2), ("aqua", "c1", 1), ("aqua", "c1", 2)}
    assert core.coverage_rate(det, usable) == FIX["C1_coverage"]["correct_rate"]
    assert len({d for _, _, d in det}) / max(1, 1) == FIX["C1_coverage"]["archived_rate"]


def test_keep_usable_zero():
    assert core.k_ratio([0, 2, 2, 2], [3, 4, 4, 4]) == FIX["C2_zero_drop"]["k_keep_zeros"]


def test_keep_usable_zero_in_s06():
    import pandas as pd
    from s06_harmonise import k_for
    df = pd.DataFrame({"x_m": [0, 2, 2, 2], "x_v": [3, 4, 4, 4]})
    assert k_for(df, "x", b=50)[0] == pytest.approx(2.5)


def test_missing_not_zero():
    from app.trust import fill_processed_zeros
    world = {"years": [2020], "modis": [[5.0] * 12], "viirs": [[5.0] * 12]}
    region = {"years": [2020], "modis": [[None] * 12], "viirs": [[None] * 12], "exposure_modis": [[None] * 12], "exposure_viirs": [[10.0] + [None] * 11]}
    out = fill_processed_zeros(region, world)
    assert all(v is None for v in out["modis"][0])
    assert out["viirs"][0][0] == 0 and out["viirs"][0][1] is None


def test_missing_not_zero_in_api_json():
    from fastapi.testclient import TestClient
    from app.main import app
    data = TestClient(app).get("/api/calendar/b_punjab_haryana").json()["data"]
    expo = data.get("exposure_modis") or []
    for yi, row in enumerate(data["modis"]):
        for mi, v in enumerate(row):
            if v == 0:
                e = None
                if yi < len(expo) and expo[yi]:
                    e = expo[yi][mi]
                assert e is not None and e > 0


def test_grid_decimal():
    def truth(x, origin):
        return int(((Decimal(repr(x)) - Decimal(origin)) / Decimal("0.1")).to_integral_value(ROUND_FLOOR))
    bad_lat = sum(core.cell_index(round(-90 + 0.1 * i, 1), 0.05)[0] != truth(round(-90 + 0.1 * i, 1), "-90") for i in range(1800))
    bad_lon = sum(core.cell_index(0.05, round(-180 + 0.1 * i, 1))[1] != truth(round(-180 + 0.1 * i, 1), "-180") for i in range(3600))
    assert bad_lat == 0 and bad_lon == 0
    assert FIX["C3_grid"]["lat_edges_misassigned"] == 643 and FIX["C3_grid"]["lon_edges_misassigned"] == 1287
    assert core.cell_index(10.0, 180.0)[1] == 0
    assert core.cell_index(90.0, 0.0)[0] == 1799


def test_lmst_rollover():
    d, h = core.lmst(date(2026, 11, 1), 2350, 82.5)
    assert d == date(2026, 11, 2) and h == pytest.approx(5.3333, abs=1e-3)
    assert core.lmst(date(2026, 11, 1), 2400, 0.0)[0] == date(2026, 11, 2)
    with pytest.raises(ValueError):
        core.lmst(date(2026, 11, 1), 1260, 0.0)
    with pytest.raises(ValueError):
        core.lmst(date(2026, 11, 1), 1200, 181.0)


def test_conformal_nested():
    from app.trust import nested_rows
    years = list(range(2012, 2026))
    region = {"years": years, "modis": [[50.0 + i] * 12 for i in range(len(years))], "viirs": [[120.0 + 3 * i] * 12 for i in range(len(years))]}
    rows = nested_rows(region)
    cal = [r for r in rows if r["role"] == "cal"]
    assert cal and all(r["outer"] not in r["fit_years"] for r in cal)
    assert all(r["year"] not in r["fit_years"] for r in rows)


def test_interval_inversion():
    q = math.log(1.6)
    for row in FIX["C4_interval"]:
        lo, hi = core.interval(row["H"], q)
        assert round(lo, 2) == row["correct_lo"] and round(hi, 2) == row["correct_hi"]


def test_window_union():
    hours = np.linspace(0, 24, 24 * 60, endpoint=False)
    for peak, key in [(13.5, "C5_window_share_peak_13.5"), (16.5, "C5_window_share_peak_16.5")]:
        d = np.minimum(np.abs(hours - peak), 24 - np.abs(hours - peak))
        curve = np.exp(-0.5 * (d / 1.5) ** 2)
        share = core.window_union_share(curve, hours, [(13.0, 14.5), (13.5, 15.0), (10.0, 11.5)])
        assert round(share, 3) == FIX[key]["union"]


def test_mk_ties():
    y = [5, 5, 6, 6, 6, 7, 7, 8, 8, 8, 9, 9]
    assert core.mk_var_ties(y) == pytest.approx(FIX["C6_mann_kendall"]["var_ties"])
    r = core.mk_test(y, hamed_rao=False)
    assert r["S"] == FIX["C6_mann_kendall"]["S"] and round(r["z"], 3) == FIX["C6_mann_kendall"]["z_ties"]


def test_log_rate_zero():
    assert math.isfinite(core.log_rate(0, 400))


def test_bootstrap_block():
    rng = np.random.default_rng(20261115)
    shock = rng.lognormal(0, 0.35, 10)
    a = rng.poisson(20 * shock[:, None], (10, 400))
    v = rng.poisson(50 * shock[:, None] * rng.lognormal(0, 0.1, (10, 1)), (10, 400))
    lo, hi = core.block_bootstrap(a, v)
    flat_a, flat_v = a.reshape(-1, 1), v.reshape(-1, 1)
    ilo, ihi = core.block_bootstrap(flat_a, flat_v, boots=300)
    assert (hi - lo) > (ihi - ilo)


def test_aoi_hash():
    a = {"aoi_hash": core.aoi_hash([73.84, 27.67, 77.59, 32.52])}
    b = {"aoi_hash": core.aoi_hash({"type": "admin1", "ids": ["IN-PB", "IN-HR", "IN-CH"]})}
    core.same_aoi(a, dict(a))
    with pytest.raises(core.AOIMismatch):
        core.same_aoi(a, b)


def test_no_clip():
    assert core.rate_or_withheld(2000, 1000)["state"] == "withheld"
    assert core.rate_or_withheld(5, 10)["reason"] == "exposure below floor"
    r = core.rate_or_withheld(50, 1000)
    assert r["state"] == "observed" and r["value"] == 50.0


def test_year_count_per_month():
    cal = json.load(open(Path(__file__).resolve().parents[2] / "data" / "processed" / "global" / "calendar_global.json"))["regions"]
    over = [(rid, m, e["n_years"]) for rid, r in cal.items() for m, e in (r.get("k_baseline") or {}).items() if e["n_years"] > 14]
    assert over == []
