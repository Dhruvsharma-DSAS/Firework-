from fastapi.testclient import TestClient

from app.main import app
from app.ml import micro_cell

client = TestClient(app)


def test_micro_cell_rounds_before_floor():
    assert micro_cell(0.3, 0.3) == micro_cell(0.30000000001, 0.3)


def test_models_endpoint_lists_cards():
    response = client.get("/api/ml/models")
    assert response.status_code == 200
    assert "data" in response.json()


def test_source_endpoint_returns_probability_or_503():
    body = {"points": [{"id": "x", "lat": 30.5, "lon": 75.5, "date": "2026-10-20", "utc": "08:15", "dn": "D", "frp": 9.5}]}
    response = client.post("/api/ml/source", json=body)
    assert response.status_code in (200, 503)
    if response.status_code == 200:
        row = response.json()["data"][0]
        assert 0.0 <= row["p_static"] <= 1.0


def test_source_endpoint_rejects_bad_body():
    response = client.post("/api/ml/source", json={"points": "nope"})
    assert response.status_code == 422


def test_weak_model_is_not_served(monkeypatch):
    from app import ml
    card = {"model": "source_classifier", "version": "0.1", "provenance": "RUN_TESTED_LOCALLY", "model_test": {"f1": 0.04}}
    monkeypatch.setattr(ml, "read_card", lambda name: card)
    monkeypatch.setattr(ml, "load_source_model", lambda: True)
    body = {"points": [{"id": "x", "lat": 30.5, "lon": 75.5, "date": "2026-10-20", "utc": "08:15", "dn": "D", "frp": 9.5}]}
    response = client.post("/api/ml/source", json=body)
    assert response.status_code == 503
    assert "too weak" in response.json()["detail"]["reason"]
