from datetime import date

from fastapi.testclient import TestClient

from app import cells, config, main

client = TestClient(main.app)

VIIRS = "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight\n-15.04,34.04,330,0.4,0.4,2026-10-25,1100,N20,VIIRS,n,2.0NRT,290,5.0,D\n-15.04,34.04,331,0.4,0.4,2026-10-25,1101,N20,VIIRS,h,2.0NRT,290,7.0,D\n-15.04,34.04,331,0.4,0.4,2026-10-26,2300,N20,VIIRS,n,2.0NRT,290,3.0,N\n-15.04,34.04,320,0.4,0.4,2026-10-25,1100,N20,VIIRS,l,2.0NRT,290,9.0,D\n"
MODIS = "latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight,type\n-15.04,34.04,320,1,1,2026-10-25,1100,Aqua,MODIS,80,6.1,300,12.0,D,0\n-15.04,34.04,320,1,1,2026-10-25,1100,Aqua,MODIS,20,6.1,300,12.0,D,0\n-15.04,34.04,320,1,1,2026-10-25,1100,Aqua,MODIS,90,6.1,300,12.0,D,2\n"


def fake(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "CACHE_DB", tmp_path / "c.sqlite")
    monkeypatch.setattr(config, "FIRMS_MAP_KEY", "dummy")
    monkeypatch.setattr(cells, "availability", lambda key: {"VIIRS_NOAA20_NRT": (date(2026, 8, 1), date(2026, 11, 1)), "MODIS_NRT": (date(2026, 9, 1), date(2026, 11, 1))})

    def fetch(key, job, bbox):
        text = ""
        if job["source"] == "VIIRS_NOAA20_NRT":
            text = VIIRS
        if job["source"] == "MODIS_NRT":
            text = MODIS
        return {"job": job, "text": text, "cached": False, "error": None}
    monkeypatch.setattr(cells, "fetch_chunk", fetch)


def test_cell_id_rounds_before_floor_and_center_roundtrip():
    assert cells.cell_id(0.3, 0.3) == cells.cell_id(0.1 + 0.2, 0.3)
    lat, lon = cells.cell_center(cells.cell_id(-15.04, 34.04))
    assert abs(lat + 15.05) < 1e-9 and abs(lon - 34.05) < 1e-9


def test_local_solar_date_moves_at_local_midnight():
    assert cells.local_date("2026-10-26", "2300", 34.0) == date(2026, 10, 27)
    assert cells.local_date("2026-10-26", "0100", -120.0) == date(2026, 10, 25)


def test_plan_uses_sp_then_nrt():
    avail = {"MODIS_SP": (date(2000, 11, 1), date(2026, 8, 31)), "MODIS_NRT": (date(2026, 9, 1), date(2026, 11, 1))}
    jobs = cells.plan(date(2026, 8, 25), date(2026, 9, 9), avail)
    assert [j["source"] for j in jobs] == ["MODIS_SP", "MODIS_SP", "MODIS_NRT", "MODIS_NRT"]
    assert all(j["days"] <= 5 for j in jobs)


def test_cell_day_applies_f07_and_counts(monkeypatch, tmp_path):
    fake(monkeypatch, tmp_path)
    r = client.get("/api/cells/day", params={"bbox": "33,-16,36,-13", "start": "2026-10-24", "end": "2026-10-30"})
    assert r.status_code == 200
    rows = r.json()["data"]
    viirs_day = [x for x in rows if x["platform"] == "noaa20" and x["daynight"] == "D"]
    assert len(viirs_day) == 1 and viirs_day[0]["n_detections"] == 2 and viirs_day[0]["max_frp"] == 7.0
    night = [x for x in rows if x["daynight"] == "N"]
    assert night[0]["local_date"] == "2026-10-27"
    modis = [x for x in rows if x["family"] == "MODIS"]
    assert len(modis) == 1 and modis[0]["n_detections"] == 1


def test_cell_month_counts_distinct_local_days(monkeypatch, tmp_path):
    fake(monkeypatch, tmp_path)
    r = client.get("/api/cells/month", params={"bbox": "33,-16,36,-13", "start": "2026-10", "end": "2026-10"})
    row = [x for x in r.json()["data"] if x["platform"] == "noaa20"][0]
    assert row["hotspots"] == 3 and row["fire_cell_days"] == 2 and row["night_hotspots"] == 1 and row["area_km2"] > 100


def test_csv_format_and_limits(monkeypatch, tmp_path):
    fake(monkeypatch, tmp_path)
    r = client.get("/api/cells/day", params={"bbox": "33,-16,36,-13", "start": "2026-10-24", "end": "2026-10-30", "format": "csv"})
    assert r.status_code == 200 and r.text.startswith("cell_id,lat,lon,local_date")
    assert client.get("/api/cells/day", params={"bbox": "-180,-90,180,90", "start": "2026-10-24", "end": "2026-10-30"}).status_code == 422
    assert client.get("/api/cells/day", params={"bbox": "33,-16,36,-13", "start": "2026-08-01", "end": "2026-10-30"}).status_code == 422
    assert client.get("/api/cells/day", params={"start": "2026-10-24", "end": "2026-10-30"}).status_code == 422
