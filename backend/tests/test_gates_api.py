"""G12 API provenance, checked on the real app (no network: live sources may answer with a status)."""
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
ROOT = Path(__file__).resolve().parents[2]
PATHS = ["/api/health", "/api/satellites", "/api/regions", "/api/formulas", "/api/method_card", "/api/calendar_regions",
         "/api/calendar/world", "/api/calendar/b_punjab_haryana", "/api/calendar/c_ind", "/api/anomaly/punjab_haryana",
         "/api/ml/models", "/api/ml/harmonised/punjab_haryana", "/api/chat/models"]


def missing(path):
    r = client.get(path)
    if r.status_code != 200:
        return path + " HTTP %d" % r.status_code
    meta = r.json().get("meta") or {}
    gone = [k for k in ("data_source", "status", "version") if not meta.get(k)]
    if gone:
        return path + " missing " + ",".join(gone)
    return None


def test_g12_every_answer_has_provenance():
    problems = [m for m in (missing(p) for p in PATHS) if m]
    assert problems == []

