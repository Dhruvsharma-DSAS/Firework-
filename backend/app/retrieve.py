"""BM25 retrieval over the Chronos corpus (data/processed/global/chronos_corpus.json, built by tools/chronos/build_corpus.py).
Pure Python, no model download: exact words such as MODIS, VIIRS, F09 or k score directly."""
import json
import math
import re
from collections import Counter

from app import config

STOP = set("a an the of and or to in on for is are was were be by with as at from that this it its what why how which who does do can i you we our your about".split())
K1 = 1.4
B = 0.75
_index = {}


def tokens(text: str) -> list:
    return [t for t in re.findall(r"[a-z0-9]+", text.lower()) if t not in STOP and (len(t) > 1 or t == "k")]


def index() -> dict:
    if _index:
        return _index
    path = config.PROCESSED_DIR / "global" / "chronos_corpus.json"
    passages = []
    if path.exists():
        passages = json.loads(path.read_text(encoding="utf-8"))["passages"]
    docs = [Counter(tokens(p["source"] + " " + p["text"])) for p in passages]
    df = Counter()
    for d in docs:
        df.update(d.keys())
    n = max(1, len(docs))
    _index.update({"passages": passages, "docs": docs, "lens": [sum(d.values()) for d in docs], "avg": sum(sum(d.values()) for d in docs) / n, "idf": {t: math.log(1 + (n - c + 0.5) / (c + 0.5)) for t, c in df.items()}})
    return _index


def search(question: str, top: int = 4) -> list:
    """Top passages with their BM25 score; an empty list when nothing in the corpus shares a word with the question."""
    ix = index()
    q = set(tokens(question))
    scored = []
    for i, d in enumerate(ix["docs"]):
        s = 0.0
        for t in q:
            f = d.get(t)
            if f:
                s += ix["idf"][t] * f * (K1 + 1) / (f + K1 * (1 - B + B * ix["lens"][i] / ix["avg"]))
        if s > 0:
            scored.append((s, i))
    scored.sort(reverse=True)
    out = []
    for s, i in scored[:top]:
        p = ix["passages"][i]
        out.append({"score": round(s, 2), "source": p["source"], "page": p["page"], "text": p["text"]})
    return out


_places = set()


def places() -> set:
    if not _places:
        path = config.PROCESSED_DIR / "global" / "calendar_global.json"
        if path.exists():
            for r in json.loads(path.read_text(encoding="utf-8"))["regions"].values():
                for t in tokens(r.get("region_name") or ""):
                    _places.add(t)
        _places.add("fire")
    return _places


def relevance(question: str, hits: list) -> float:
    """Share of the question's idf weight that the best passage (or a place name) covers: 0 = off topic, 1 = fully covered."""
    q = set(tokens(question))
    if not q:
        return 1.0
    ix = index()
    top = Counter()
    if hits:
        top = Counter(tokens(hits[0]["source"] + " " + hits[0]["text"]))
    worst = max(ix["idf"].values() or [1.0])
    total = 0.0
    got = 0.0
    for t in q:
        w = ix["idf"].get(t, worst)
        total += w
        if t in top or t in places():
            got += w
    return got / total
