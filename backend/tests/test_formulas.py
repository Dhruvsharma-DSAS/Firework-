import re

from fastapi.testclient import TestClient

from app import main

client = TestClient(main.app)
BANNED = ["V1", "V2", "audit", "verdict", "FIX", "REVISE", "equation_v"]
FIELDS = ["id", "name", "family", "layer", "status", "lead", "equations", "reads", "symbols", "origin", "why", "how", "example", "key_numbers", "figures", "stages", "pages", "where", "limits", "code", "related", "references", "pdf", "pdf_url"]


def test_formulas_endpoint_serves_all_46() -> None:
    """GET /api/formulas returns the 46-formula reference F01–F46 with every field the pages need."""
    body = client.get("/api/formulas").json()
    ids = [f["id"] for f in body["data"]]
    assert ids == ["F%02d" % i for i in range(1, 47)]
    assert body["meta"]["status"] == "SOURCE_DERIVED"
    for f in body["data"]:
        for field in FIELDS:
            assert field in f, (f["id"], field)
        assert f["status"] in ["live", "library", "awaiting", "experimental"]
        assert len(f["equations"]) >= 1
        assert f["pdf_url"].startswith("https://drive.google.com/file/d/")


def test_formulas_show_no_history() -> None:
    """The reference shows only the current formula: no version, audit or verdict words anywhere."""
    text = main.FORMULAS_FILE.read_text(encoding="utf-8")
    for word in BANNED:
        assert not re.search(r"\b" + re.escape(word) + r"\b", text), word
