import csv
import io
import json

from fastapi.testclient import TestClient

from app import config, main, store

client = TestClient(main.app)


def setup_tmp(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CACHE_DB", tmp_path / "cache.sqlite")
    monkeypatch.setattr(config, "PIPELINE_DIR", tmp_path / "processed")
    region = tmp_path / "processed" / "testland"
    region.mkdir(parents=True)
    cal = {"data": {"region": "testland", "years": [2011, 2012], "months": list(range(1, 13)), "hotspots": {"raw": [[1] * 12, [3] * 12], "harmonised": [[2.5] * 12, [3] * 12], "lo95": [[2] * 12, [3] * 12], "hi95": [[3] * 12, [3] * 12], "status": [["harmonised_modis"] * 12, ["observed_viirs"] * 12]}}, "meta": {"status": "ARCHIVE_STANDARD", "demo": False}}
    (region / "calendar_testland.json").write_text(json.dumps(cal))
    (region / "region_month.csv").write_text("month,family,covered_days,days_in_month,hotspots,night_hotspots,frp_median,fire_cell_days,status,region_id,boundary\n2011-11,MODIS,30,30,40,2,9.1,25,ok,testland,bbox\n2012-11,MODIS,30,30,50,3,9.0,30,ok,testland,bbox\n2012-11,VIIRS_SNPP,30,30,150,9,4.2,90,ok,testland,bbox\n2012-10,MODIS,12,31,,,,,partial,testland,bbox\n")
    (region / "calibration.csv").write_text("region_id,metric,calendar_month,k,k_lo95,k_hi95,n_overlap_years,method,fitted_at_utc\ntestland,cell_days,11,3.0,2.5,3.5,3,ratio of totals,2026-11-02\n")
    (region / "anomaly.csv").write_text("region_id,month,value,median_ref,mean_ref,pct_vs_median,robust_z,n_ref,status\ntestland,2012-11,30,20,21,50,1.2,9,ok\n")
    (region / "fire_detection.csv").write_text("lat,lon,acq_date,acq_time,lmst,sensor,platform,frp,confidence_raw,daynight,firms_type,processing,firms_source\n30.5,75.5,2012-11-02,805,13.1,VIIRS,snpp,5.1,n,D,0,SP,VIIRS_SNPP_SP\n10,10,2012-11-02,805,13.1,VIIRS,snpp,5.1,n,D,0,SP,VIIRS_SNPP_SP\n")


def test_calendar_comes_from_pipeline_and_is_cached(tmp_path, monkeypatch):
    setup_tmp(tmp_path, monkeypatch)
    r = client.get("/api/calendar/testland")
    d = r.json()["data"]
    assert r.status_code == 200 and r.json()["meta"]["demo"] is False
    assert d["years"] == [2011, 2012]
    assert d["modis"][1][10] == 30 and d["viirs"][1][10] == 90 and d["viirs"][0][10] is None
    assert d["modis"][1][9] is None
    assert d["k_baseline"]["11"]["k"] == 3.0 and d["k_baseline"]["11"]["lo"] == 2.5
    (tmp_path / "processed" / "testland" / "region_month.csv").unlink()
    (tmp_path / "processed" / "testland" / "calendar_testland.json").unlink()
    r2 = client.get("/api/calendar/testland")
    assert r2.status_code == 200 and r2.json()["meta"]["status"] == "CACHED"


def test_calendar_missing_is_404_not_demo(tmp_path, monkeypatch):
    setup_tmp(tmp_path, monkeypatch)
    assert client.get("/api/calendar/nowhere").status_code == 404


def test_anomaly_latest(tmp_path, monkeypatch):
    setup_tmp(tmp_path, monkeypatch)
    d = client.get("/api/anomaly/testland").json()["data"]
    assert d["month"] == "2012-11" and d["pct_vs_median"] == 50.0


def test_export_filters_bbox_and_dates(tmp_path, monkeypatch):
    setup_tmp(tmp_path, monkeypatch)
    r = client.get("/api/export/hotspots.csv?region=testland&bbox=73,29,77,33&start=2012-11-01&end=2012-11-30")
    rows = list(csv.reader(io.StringIO(r.text)))
    assert r.status_code == 200 and len(rows) == 2 and rows[1][0] == "30.5"


def test_detections_fall_back_to_last_good_copy(tmp_path, monkeypatch):
    setup_tmp(tmp_path, monkeypatch)
    monkeypatch.setattr(config, "FIRMS_MAP_KEY", "dummy")
    good = {"data": [{"lat": 1.0, "lon": 2.0, "date": "2026-11-01", "utc": "0805", "firms_source": "MODIS_NRT"}], "meta": {"status": "LIVE_NRT"}}
    monkeypatch.setattr(main, "get_detections", lambda *a, **k: json.loads(json.dumps(good)))
    assert client.get("/api/detections?source=ALL").json()["meta"]["status"] == "LIVE_NRT"

    def boom(*a, **k):
        raise RuntimeError("FIRMS down")
    monkeypatch.setattr(main, "get_detections", boom)
    r = client.get("/api/detections?source=ALL")
    assert r.status_code == 200 and r.json()["meta"]["status"] == "CACHED" and r.json()["data"][0]["lat"] == 1.0
    assert len(store.history(0, 0, 5, 5, "2026-11-01", "2026-11-01")) == 1


def test_detections_without_key_or_cache_is_503(tmp_path, monkeypatch):
    setup_tmp(tmp_path, monkeypatch)
    monkeypatch.setattr(config, "FIRMS_MAP_KEY", "")
    assert client.get("/api/detections?source=ALL").status_code == 503
