"""Ask Chronos: a text and explanation assistant over several free AI models.

The model only writes words around numbers the site already computed (truth policy). Every answer is checked:
a number in the answer that does not appear in the facts or the question is "unverified"; the next model is tried,
and if none passes the answer is returned with the unverified numbers listed so the UI can warn.
Keys are read from backend/.env only and never returned.
"""
import csv
import json
import os
import re
import time

import httpx

from app import config, retrieve, supa

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
HF_URL = "https://router.huggingface.co/v1/chat/completions"
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent"

MODELS = [
    {"id": "groq-gpt-oss-120b", "label": "GPT-OSS 120B · Groq", "provider": "groq", "model": "openai/gpt-oss-120b", "env": "GROQ_API_KEY"},
    {"id": "gemini-3.5-flash-lite", "label": "Gemini 3.5 Flash-Lite · Google", "provider": "gemini", "model": "gemini-3.5-flash-lite", "env": "GEMINI_API_KEY"},
    {"id": "groq-gpt-oss-20b", "label": "GPT-OSS 20B · Groq", "provider": "groq", "model": "openai/gpt-oss-20b", "env": "GROQ_API_KEY"},
    {"id": "hf-llama-3.3-70b", "label": "Llama 3.3 70B · Hugging Face", "provider": "hf", "model": "meta-llama/Llama-3.3-70B-Instruct", "env": "HF_TOKEN"},
    {"id": "hf-qwen3-32b", "label": "Qwen3 32B · Hugging Face", "provider": "hf", "model": "Qwen/Qwen3-32B", "env": "HF_TOKEN"},
]

SYSTEM = (
    "You are Chronos, the guide inside FIREWORK CHRONOS, a NASA Space Apps 2026 site that joins 25 years of MODIS (2000→) and VIIRS (2012→) "
    "satellite fire detections into one comparable record for the whole Earth. Answer in plain English for a non-expert, short paragraphs, "
    "at most 160 words unless asked for more. Rules: use ONLY numbers that appear in FACTS or in the question — never invent, estimate or round "
    "a number into a new one; if the facts do not contain the answer, say what the site can show instead and which page to open. "
    "A hot spot is a satellite pixel, not a fire; a fire cell-day is not burned area; harmonised values are estimates with a band. "
    "This is research decision support, not a life-safety alert. When useful, point to a page: Explore (globe), Calendar, Trust → Validation, "
    "Trust → Formulas, Your data → Brief, Learn."
)

STATIC_FACTS = [
    "MODIS flies on Terra (launched 1999, record from 2000-11-01) and Aqua (from 2002-07-04); fire pixel 1,000 m at nadir; swath 2,330 km; overpass ~10:30 (Terra) and ~13:30 (Aqua) local time.",
    "VIIRS flies on Suomi NPP (from 2012-01-20), NOAA-20 (from 2018-04-01) and NOAA-21 (from 2023-03-01); fire pixel 375 m; swath 3,040 km; overpass ~13:30 local time.",
    "Suomi NPP new data delivery ends 2 Nov 2026; Terra end of science Feb 2027 and Aqua Sep 2027 (NASA plans).",
    "Grid: 0.1° cells (F03). Local solar time = UTC + lon/15 (F01). A fire cell-day = one cell with at least one confident detection on one local day (F05).",
    "Confidence rule F07: MODIS confidence ≥ 30, VIIRS nominal or high; MODIS static/volcano/offshore sources left out.",
    "Exchange rate k = VIIRS S-NPP fire cell-days ÷ MODIS fire cell-days over the overlap years, per calendar month, with a 95 % year-block bootstrap band.",
]


def key_of(entry: dict) -> str:
    """API key for a model entry, from the environment loaded out of backend/.env."""
    return os.environ.get(entry["env"], "").strip()


NO_CREDIT = {}
NO_CREDIT_HOLD_S = 6 * 3600


def usable(m: dict) -> bool:
    """A model is usable when its key is set and its provider has not answered 'no credit' (HTTP 402) in the last 6 h."""
    if not key_of(m):
        return False
    since = NO_CREDIT.get(m["provider"])
    return since is None or time.time() - since > NO_CREDIT_HOLD_S


def available() -> list:
    """Models whose key is configured and whose provider still has credit (keys themselves are never returned)."""
    return [{"id": m["id"], "label": m["label"], "provider": m["provider"]} for m in MODELS if usable(m)]


MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def remote_region_facts() -> list:
    """Same facts read from Supabase (deployed backend without pipeline files)."""
    out = []
    try:
        calib = supa.select("calibration", {"select": "region_id,calendar_month,k,k_lo95,k_hi95", "metric": "eq.cell_days", "order": "region_id,calendar_month"})
        anomalies = supa.select("anomaly", {"select": "region_id,month,value,median_ref,pct_vs_median,status", "status": "in.(ok,indicative)", "order": "region_id,month"})
    except Exception:
        return out
    by_region = {}
    for r in calib or []:
        if r["k"] is not None:
            by_region.setdefault(r["region_id"], []).append("%s %.2f [%.2f–%.2f]" % (MONTHS[int(r["calendar_month"])], r["k"], r["k_lo95"], r["k_hi95"]))
    for rid, parts in by_region.items():
        out.append("Region %s: k per month (fire cell-days, 95 %% band): %s." % (rid, "; ".join(parts)))
    latest = {}
    for r in anomalies or []:
        latest[r["region_id"]] = r
    for rid, r in latest.items():
        out.append("Region %s latest month %s: %s hot spots (harmonised) vs median %s of the same month in other years (%s %% vs median)." % (rid, r["month"], fmt(str(r["value"])), fmt(str(r["median_ref"])), fmt(str(r["pct_vs_median"]))))
    return out


def region_facts() -> list:
    """Real numbers the pipeline computed: k per month with band, and the latest anomaly, for each processed region."""
    out = []
    base = config.PIPELINE_DIR
    if not base.exists() or not any(p.is_dir() and p.name != "train" for p in base.iterdir()):
        if supa.enabled():
            return remote_region_facts()
        return out
    months = MONTHS
    for folder in sorted(p for p in base.iterdir() if p.is_dir() and p.name != "train"):
        calib = folder / "calibration.csv"
        if calib.exists():
            parts = []
            with open(calib, encoding="utf-8") as handle:
                for r in csv.DictReader(handle):
                    if r["metric"] == "cell_days" and r["k"] not in ("", "nan"):
                        parts.append("%s %.2f [%.2f–%.2f]" % (months[int(r["calendar_month"])], float(r["k"]), float(r["k_lo95"]), float(r["k_hi95"])))
            if parts:
                out.append("Region %s: k per month (fire cell-days, 95 %% band): %s." % (folder.name, "; ".join(parts)))
        anomaly = folder / "anomaly.csv"
        if anomaly.exists():
            with open(anomaly, encoding="utf-8") as handle:
                rows = [r for r in csv.DictReader(handle) if r["status"] in ("ok", "indicative")]
            if rows:
                r = rows[-1]
                out.append("Region %s latest month %s: %s hot spots (harmonised) vs median %s of the same month in other years (%s %% vs median)." % (
                    folder.name, r["month"], fmt(r["value"]), fmt(r["median_ref"]), fmt(r["pct_vs_median"])))
    return out


def model_facts() -> list:
    """Held-out test results from the model cards."""
    out = []
    folder = config.ROOT / "ml" / "models"
    for name in ["harmonise", "forecast", "source_classifier"]:
        path = folder / (name + ".card.json")
        if not path.exists():
            continue
        card = json.load(open(path, encoding="utf-8"))
        if "cell_month_test" in card:
            c = card["cell_month_test"]
            out.append("Harmoniser model (MODIS→VIIRS): test MAE %.3f vs constant-k MAE %.3f; 90 %% band covered %.0f %% of test values." % (c["mae_model"], c["mae_constant_k"], 100 * c["interval_coverage"]))
        elif "folds" in card:
            skills = ", ".join("%d: %.2f" % (f["test_year"], f["skill_vs_climatology"]) for f in card["folds"] if f.get("skill_vs_climatology") is not None)
            out.append("Next-month forecast model: skill vs climatology by test year %s (above 0 = better than the seasonal average)." % skills)
        elif "model_test" in card:
            out.append("Source classifier (crop fire vs static source): test F1 %.3f vs rule F1 %.3f — too weak, hidden on the site." % (card["model_test"]["f1"], card["baseline_rule_test"]["f1"]))
    return out


def fmt(v: str) -> str:
    """Format a CSV number without inventing precision."""
    try:
        f = float(v)
    except ValueError:
        return v
    if abs(f) >= 100:
        return "{:,.0f}".format(f)
    return "%.1f" % f


def build_facts(page_context: dict) -> str:
    """FACTS block: static facts, real pipeline numbers, model results, and what the user is looking at."""
    lines = STATIC_FACTS + region_facts() + model_facts()
    if page_context:
        lines.append("The user is on page %s. What they see: %s" % (page_context.get("page", "?"), json.dumps(page_context.get("context", {}), ensure_ascii=False)[:1500]))
    return "FACTS:\n- " + "\n- ".join(lines)


NUM = re.compile(r"(?<![\w.])\d+(?:[.,]\d+)*(?:\.\d+)?")


def numbers_in(text: str) -> set:
    """Numbers in a text, normalised (thousand separators removed)."""
    return set(n.replace(",", "") for n in NUM.findall(text))


def unverified(answer: str, allowed_text: str) -> list:
    """Numbers in the answer that do not appear in facts/question (small counting words like 1–3 are allowed)."""
    allowed = numbers_in(allowed_text)
    bad = []
    for n in numbers_in(answer):
        if n in allowed or n in ("0", "1", "2", "3"):
            continue
        bad.append(n)
    return sorted(bad)


def call(entry: dict, messages: list) -> str:
    """One model call. messages = [{"role": "system"|"user"|"assistant", "content": ...}]."""
    key = key_of(entry)
    if entry["provider"] in ("groq", "hf"):
        url = GROQ_URL
        if entry["provider"] == "hf":
            url = HF_URL
        r = httpx.post(url, headers={"Authorization": "Bearer " + key}, json={"model": entry["model"], "messages": messages, "max_tokens": 1500, "temperature": 0.3}, timeout=45)
        r.raise_for_status()
        text = r.json()["choices"][0]["message"]["content"] or ""
    else:
        system = "\n".join(m["content"] for m in messages if m["role"] == "system")
        contents = []
        for m in messages:
            if m["role"] == "system":
                continue
            role = "user"
            if m["role"] == "assistant":
                role = "model"
            contents.append({"role": role, "parts": [{"text": m["content"]}]})
        r = httpx.post(GEMINI_URL % entry["model"], headers={"x-goog-api-key": key}, json={"systemInstruction": {"parts": [{"text": system}]}, "contents": contents, "generationConfig": {"maxOutputTokens": 1500, "temperature": 0.3}}, timeout=45)
        r.raise_for_status()
        text = "".join(p.get("text", "") for p in r.json()["candidates"][0]["content"]["parts"])
    return re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()


REFUSE_BELOW = 0.4
OUT_OF_SCOPE = ("That is outside what FIREWORK CHRONOS covers, so I won't guess. I can answer questions about satellite fire detections "
                "(MODIS and VIIRS), the exchange rate k, any country's fire calendar, the trust checks, and the formulas. "
                "Try the Calendar page for a country, or Trust → Validation for how far each number can be trusted.")


def strip_unverified(text: str, bad: list) -> tuple:
    """Remove every sentence that carries a number not found in the facts or sources; returns (text, removed count)."""
    parts = re.split(r"(?<=[.!?])\s+|\n+", text)
    keep = []
    removed = 0
    for part in parts:
        if any(n in numbers_in(part) for n in bad):
            removed += 1
            continue
        keep.append(part)
    return " ".join(k for k in keep if k.strip()).strip(), removed


def ask(question: str, history: list, page_context: dict, model_id: str) -> dict:
    """Answer a question from FACTS plus retrieved passages. Off-topic questions are refused without calling a model;
    sentences with numbers that are not in the facts or passages are removed, never shown."""
    hits = retrieve.search(question)
    rel = retrieve.relevance(question, hits)
    sources = [{"source": h["source"], "page": h["page"]} for h in hits[:3]]
    if len(retrieve.tokens(question)) >= 3 and rel < REFUSE_BELOW and not history:
        return {"data": {"answer": OUT_OF_SCOPE, "model": "rule", "label": "Chronos · outside our sources", "unverified_numbers": [], "sources": [], "relevance": round(rel, 2)}, "meta": {"status": "OUT_OF_SCOPE"}}
    facts = build_facts(page_context)
    if hits:
        facts += "\nSOURCES (from the site's method card, formulas, lessons and research paper; quote numbers only from here or FACTS):\n- " + "\n- ".join("[" + h["source"] + "] " + h["text"] for h in hits)
    messages = [{"role": "system", "content": SYSTEM + "\n\n" + facts}]
    for h in history[-6:]:
        if h.get("role") in ("user", "assistant") and isinstance(h.get("content"), str):
            messages.append({"role": h["role"], "content": h["content"][:2000]})
    messages.append({"role": "user", "content": question[:2000]})
    allowed_text = SYSTEM + " " + facts + " " + question + " " + " ".join(h.get("content", "") for h in history[-6:] if h.get("role") == "user")
    order = [m for m in MODELS if usable(m)]
    if model_id != "auto":
        order = [m for m in MODELS if key_of(m) and m["id"] == model_id]
    tried = []
    best = None
    for entry in order:
        t0 = time.time()
        try:
            text = call(entry, messages)
        except Exception as error:
            msg = str(error)
            for m in MODELS:
                if key_of(m):
                    msg = msg.replace(key_of(m), "***")
            status = msg[:120]
            if "402" in msg:
                status = "no free credit left on this account (HTTP 402)"
                NO_CREDIT[entry["provider"]] = time.time()
            tried.append({"model": entry["id"], "ok": False, "error": status})
            continue
        bad = unverified(text, allowed_text)
        tried.append({"model": entry["id"], "ok": True, "seconds": round(time.time() - t0, 1), "unverified_numbers": bad})
        result = {"answer": text, "model": entry["id"], "label": entry["label"], "unverified_numbers": bad, "sources": sources, "relevance": round(rel, 2)}
        if not bad:
            return {"data": result, "meta": {"status": "OK", "tried": tried, "rule": "numbers come only from FACTS (site data); others are flagged"}}
        if best is None:
            best = result
        if model_id != "auto":
            break
    if best is not None:
        clean, removed = strip_unverified(best["answer"], best["unverified_numbers"])
        if len(clean) < 40:
            clean = "I could not give a fully checked answer to that, so I am not showing one. The numbers you need are on the Calendar page (per country and month) and on Trust → Validation."
        best = dict(best, answer=clean, removed_statements=removed, unverified_numbers=[])
        return {"data": best, "meta": {"status": "UNVERIFIED_REMOVED", "tried": tried, "rule": "numbers come only from FACTS (site data); others are flagged"}}
    return {"data": None, "meta": {"status": "UNAVAILABLE", "tried": tried}}
