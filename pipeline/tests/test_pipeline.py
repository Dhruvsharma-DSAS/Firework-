import importlib
import json
import os
import subprocess
import sys
from datetime import date
from pathlib import Path

import pandas as pd

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))


def test_cell_index_rounds_and_wraps():
    from lib.common import cell_index
    assert cell_index([28.1], [75.0])[0] == cell_index([28.1000000001], [75.0])[0]
    assert cell_index([0.05], [180.0])[0] == cell_index([0.05], [-180.0])[0]


def test_mask_hides_key():
    from lib.common import mask
    assert "abc123" not in mask("https://x/api/area/csv/abc123/MODIS_SP", "abc123")


def test_plan_sp_then_nrt():
    s02 = importlib.import_module("s02_firms_download")
    region = {"id": "t", "bbox": [0, 0, 1, 1]}
    avail = {"MODIS_SP": ("2000-11-01", "2025-06-30"), "VIIRS_SNPP_SP": ("2012-01-20", "2025-06-30"), "VIIRS_NOAA20_SP": ("2018-04-01", "2025-06-30"), "MODIS_NRT": ("2025-05-01", "2025-07-20"), "VIIRS_SNPP_NRT": ("2025-05-01", "2025-07-20"), "VIIRS_NOAA20_NRT": ("2025-05-01", "2025-07-20"), "VIIRS_NOAA21_NRT": ("2025-05-01", "2025-07-20")}
    jobs = s02.plan(region, avail, "2025-06-01", "2025-07-20")
    sp = [j for j in jobs if j[0].endswith("_SP")]
    nrt = [j for j in jobs if j[0].endswith("_NRT")]
    assert all(j[2] <= 5 for j in jobs)
    assert max(j[1] for j in sp) <= date(2025, 6, 30)
    assert min(j[1] for j in nrt) == date(2025, 7, 1)


def test_build_and_harmonise_end_to_end(tmp_path):
    env = dict(os.environ, DATA_DIR=str(tmp_path))
    subprocess.check_call([sys.executable, "tests/make_fake_raw.py", str(tmp_path)], cwd=HERE, env=env)
    subprocess.check_call([sys.executable, "s05_build_tables.py", "--regions", "punjab"], cwd=HERE, env=env)
    subprocess.check_call([sys.executable, "s06_harmonise.py", "--regions", "punjab"], cwd=HERE, env=env)
    rm = pd.read_csv(tmp_path / "processed" / "punjab" / "region_month.csv")
    assert set(rm["family"]) == {"MODIS", "VIIRS_SNPP"}
    assert set(rm["status"]) <= {"ok", "partial", "not_downloaded", "no_detection"}
    cal = json.load(open(tmp_path / "processed" / "punjab" / "calendar_punjab.json"))
    assert cal["meta"]["demo"] is False and len(cal["data"]["hotspots"]["harmonised"]) == len(cal["data"]["years"])
    years = cal["data"]["years"]
    if 2017 in years:
        assert cal["data"]["hotspots"]["harmonised"][years.index(2017)][0] is None
    calib = pd.read_csv(tmp_path / "processed" / "punjab" / "calibration.csv")
    nov = calib[(calib.metric == "hotspots") & (calib.calendar_month == 11)].iloc[0]
    assert 1.5 < nov["k"] < 6 and nov["k_lo95"] <= nov["k"] <= nov["k_hi95"]
