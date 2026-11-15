"""Corpus for Chronos retrieval: formulas, method card (with the advanced trust layer), lessons and the research paper,
cut into short passages. Writes data/processed/global/chronos_corpus.json. Run: python3 tools/chronos/build_corpus.py"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PUB = ROOT / "frontend" / "public"
OUT = ROOT / "data" / "processed" / "global" / "chronos_corpus.json"


def flat(v) -> str:
    if isinstance(v, str):
        return v
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, list):
        return " ".join(flat(x) for x in v)
    if isinstance(v, dict):
        return " ".join(str(k).replace("_", " ") + ": " + flat(x) for k, x in v.items())
    return ""


def chunks(text: str, size: int = 90) -> list:
    words = re.sub(r"\s+", " ", text).strip().split(" ")
    return [" ".join(words[i:i + size]) for i in range(0, len(words), size - 15) if len(words[i:i + size]) > 12]


def main() -> None:
    out = []
    for f in json.loads((PUB / "data" / "formulas_content.json").read_text())["formulas"]:
        body = " ".join(flat(f.get(k)) for k in ["lead", "why", "how", "example", "key_numbers", "limits", "where"])
        for c in chunks(body):
            out.append({"source": f["id"] + " · " + f["name"], "page": "/formulas", "text": c})
    card = json.loads((ROOT / "data" / "processed" / "global" / "method_card.json").read_text())
    for key in ["harmonisation", "coverage_gate", "conformal", "physics_checks", "gates", "model_choice", "limits", "advanced"]:
        for c in chunks(key.replace("_", " ") + ". " + flat(card.get(key))):
            out.append({"source": "Method card · " + key.replace("_", " "), "page": "/validation", "text": c})
    lessons = json.loads((PUB / "data" / "lessons.json").read_text())["data"]
    for item in (lessons if isinstance(lessons, list) else lessons.values()):
        title = flat(item.get("title", "")) if isinstance(item, dict) else ""
        for c in chunks(flat(item)):
            out.append({"source": "Lesson · " + title[:60], "page": "/learn", "text": c})
    paper = PUB / "learn" / "pdf" / "FIREWORK_CHRONOS_Research_Paper.pdf"
    if paper.exists():
        import fitz
        doc = fitz.open(str(paper))
        for i, page in enumerate(doc):
            for c in chunks(page.get_text()):
                out.append({"source": "Research paper · p. " + str(i + 1), "page": "/validation", "text": c})
    OUT.write_text(json.dumps({"passages": out}, ensure_ascii=False))
    print(len(out), "passages")


if __name__ == "__main__":
    main()
