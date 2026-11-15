# AGENTS.md — handoff for any AI coding agent (Codex, Cursor, Claude, …)

FIREWORK CHRONOS · NASA Space Apps 2026 · "Harmonization of MODIS and VIIRS Hot Spots".
25 years of NASA FIRMS fire detections (MODIS 2000→, VIIRS 2012→) put on one scale and shown as a
3D globe + month × year burning calendar. Read this file first, then `CLAUDE.md` (code style and truth
policy — they apply to every agent, not only Claude).

## 1. Where things are

| Path | What |
|---|---|
| `frontend/` | React 19 + Vite 7 + three/globe.gl. Pages in `src/pages/`, shared UI in `src/components/`, helpers in `src/lib/` |
| `frontend/src/lib/sourceMode.js` | Demo / Archive / Live switch (localStorage `fc-source`), `LIVE_SOURCES`, `ARCHIVE_SOURCES`, `ARCHIVE_DATE` |
| `frontend/src/lib/satModels.js`, `earth3d.js` | Procedural 3D models of Terra, Aqua, S-NPP, NOAA-20, NOAA-21 and the home-page Earth |
| `frontend/public/data/` | Static JSON the site reads (calendar, formulas_content.json, regions, demo fixtures) |
| `frontend/public/formulas/video/` | One narrated video per formula (`Fxx.mp4`, `Fxx.jpg`, `videos.json`) |
| `frontend/public/learn/video/` | Lesson videos + `site-tour.mp4` (Home "How it works" plays `TOUR_SEGMENTS` from it, `src/pages/Home.jsx`) |
| `backend/app/main.py` | FastAPI. Every response is `{data, meta}`. `/api/detections`, `/api/calendar…`, `/api/formulas`, `/api/satellites` |
| `backend/app/firms.py` | NASA FIRMS client: fetch, reservoir-sample to `MAX_POINTS` (20,000), per-source `rows` + `latest_date` from FIRMS data_availability |
| `data/processed/global/calendar_global.json` | THE harmonised calendar: 230 regions × 2000–2025 × 12 months, MODIS/VIIRS cell-days, `k_baseline` per month with 95 % band |
| `../FIREWORK_Colab/` | Google Colab pipeline (`fireworklib.py`, notebooks 01 collect → 02 build calendar → 03 train models) |
| `docs/formula_pdfs/formulas_content.json` | Source of the 46 formulas (F01–F46); copied to `frontend/public/data/` |
| `tools/formula_film/` | Formula video renderer v2 (`render2.mjs`, `film2.html`, `scripts/Fxx.json`) — Sarvam TTS voice `kalpit_en_edtech` |
| `tools/lesson_film/` | Lesson + site-tour renderer (`tour_cut.mjs`) |
| `../NASA_Submission_Decks/` (outside repo) | Presentations: `v2/build_story.js` (15-slide main deck), `v2/build_v2.js` (5 themed decks), `v2/gen_art.js`, `v2/hero_render.html` (renders satellite images with the site's 3D models) |

## 2. Run, test, deploy

```
cd backend && .venv/bin/python -m uvicorn app.main:app --reload --port 8000
cd frontend && npm run dev          # http://localhost:5173, proxies /api to :8000
cd backend && .venv/bin/python -m pytest -q          # 39 tests
cd frontend && npx oxlint src                        # lint
```
- Live: frontend on Vercel (`firework-chronos.vercel.app`, also `firework-nasa.vercel.app`), backend on Render (`firework-chronos-api.onrender.com`, `render.yaml`). Push to `main` deploys both.
- GitHub: `Dhruvsharma-DSAS/SpaceCode-`, branch `main`. The user approves each push.
- Secrets only in `backend/.env` (FIRMS_MAP_KEY, SARVAM_API_KEY, Supabase, LLM). Never print, commit or paste them.

## 3. Numbers that must stay consistent everywhere (from the live calendar file)
- ~407 million FIRMS points; 230 regions; 2000–2025; 14 overlap years (2012–2025).
- Punjab + Haryana November k = 2.24 [2.15, 2.35]; October 2.64 [2.47, 2.82]. Whole-Earth VIIRS ≈ 2.6× MODIS cell-days.
- Raw join jumps ×2.7 at 2012 (Oct+Nov, Punjab + Haryana). Nov 2005: 2,920 MODIS → 6,553 VIIRS-equivalent [6,271–6,848].
- Validation: 12 gates fixed 27 Oct 2026. G1 held-out median error 0.097 (bar ≤ 0.15) PASSED; G3 seam ratio 0.19 (bar ≤ 0.25) PASSED; G6 conformal 95 % bands held 95.0 % on unseen years (bar 0.88–0.99) PASSED; 9 pending. ML harmoniser + outlook = NOT READY.
- Trust layer (`backend/app/trust.py`, rebuild with `backend/.venv/bin/python tools/trust/build_exposure.py` then `tools/trust/build_trust.py` after any calendar change; exposure for 220 countries comes from the Earth Engine CSV, joined FIPS→ISO3 by name and checked by fire-count ratio; sub-national boxes have no exposure): coverage gate H/M/L per region-month (932/726/1102; Low = k withheld in the calendar), Mondrian conformal intervals by MODIS size class (×÷ 2.65 … 1.28), physics checks P1–P4, 3 analog seasons per year, `registry.json` (SHA-256, checked by a test), `method_card.json` (served at `/api/method_card` and `/data/method_card.json`).
- Older PDFs show k = 2.096 / 2.10 — that was an earlier run; the live file wins.

## 4. Gotchas learned the hard way
- FIRMS: DAY_RANGE 1–5 only; ~10 transactions per request (5000 / 10 min). `VIIRS_SNPP_NRT` has had no new data since 2 Nov 2026 (Sensor Lab says so); NOAA-20 and NOAA-21 NRT continue.
- 4 live sources ≈ 237k rows; the reservoir sampler keeps backend RAM ≈ 200 MB (Render free tier is 512 MB). Do not go back to "parse all, then sample".
- Missing data is `null` + status, never 0. Demo data always carries the SIMULATED chip.
- Keynote on this Mac blanks native PowerPoint charts → decks draw charts with shapes. Keynote AppleScript target is "Keynote Creator Studio".
- Floating UI inside transformed parents must use `createPortal` (see `PageGuide.jsx`).
- TTS pronunciation map `SAY_AS` in the film renderers: "FIREWORK CHRONOS" → "Fire Work Kronos".

## 5. Current state (update this section at the end of every session)
_Last update: 8 Nov 2026._
- Done: harmonised calendar (230 regions), live explorer with NOAA-20 + NOAA-21 + MODIS, archive mode with all 5 satellites (5 Nov 2025), 46 formula pages, 15 lessons, guided tour, Sensor Lab, Blind Spot, Validation, Data Studio (CSV in/out), region Brief, Workspace.
- In progress: formula videos v2 — F01–F29 pushed; F30–F46 rendering (`node tools/formula_film/render2.mjs` with `FILM_SITE=http://localhost:5173 FILM_SKIP_DONE=1`, log `.film_work/formulas_v2.log`). When done: commit `frontend/public/formulas/video/` and push.
- Pending: gates G2, G4–G12 on real data; k by day/night (F13) and per platform; clear-sky exposure (F09) at scale; polygon drawing + custom date range on the calendar (challenge "nice to have").
- Not committed on purpose: `.deck_snapshot.tgz`, `.github/` workflow, `Claude outputs/`, `Presentations_SpaceApps_2026/`, `supabase data enter/`.

## 6. Working cheaply
- Read only the file you need; the docs above say where. `docs/spec/*.pdf` is large — open one chapter at a time.
- For a whole-repo map, the `graphify` skill (`/graphify`) builds a knowledge graph (`graphify-out/`), but it is expensive; use this file first.

## Advanced trust layer (2026-11-09)
- `tools/trust/build_trust.py` now also runs `tools/trust/build_advanced.py` (needs numpy + scikit-learn, local venv only; Render just serves the JSON).
  Adds per region-month `distance` (k-NN distance to High-coverage months, zone core/edge/outside) and `why_k` (GBM on ln k + exact interventional Shapley, 5 inputs) to `trust_global.json`; `summary.advanced` + `method_card.advanced` hold T1 (leave-continent-and-year-out transfer: PASS, ×1.342 vs ×1.396 global k, 5/6 continents) and T2.
- T2 burned-area (MCD64A1) = `tools/trust/build_burned_area.py`, PENDING: Earth Engine project is in restricted (quota) mode and reduceRegions hit an "Unable to transform edge" projection error. Then rerun build_trust.py.
- Chronos: `backend/app/retrieve.py` BM25 over `data/processed/global/chronos_corpus.json` (build: `python3 tools/chronos/build_corpus.py`, needs PyMuPDF). `llm.ask` refuses off-topic (relevance < 0.4, ≥3 words, no history) and removes sentences with unverified numbers; returns `sources`.
- UI: Calendar month detail shows distance zone + "Why k" bars; Validation Trust layer shows guards 05–06 and tests T1–T2; chat shows source chips.

## Fire Clock, T2 and Home interactions (2026-11-14)
- Fire Clock page `/fire-clock` (`pipeline/s12_fire_clock.py` → `frontend/public/data/fire_clock_punjab_haryana.json`, `pages/FireClock.jsx`, `styles/fireclock.css`). Last section "Where it fits" compares ideas across public entries WITHOUT naming teams (our reading on 14 Nov, not verified claims about others).
- T2 burned-area test DONE and PASSED: median Spearman ρ = 0.687 over 114 countries, 97.4 % positive (`data/processed/global/burned_area_countries.json`, EE project `gmp-demo-project-793150412`, MCD64A1 2001–2025).
- Home: heatmap cells open `/calendar/punjab_haryana?y=YYYY&m=M` (Calendar reads `y`/`m`); service cards navigate; satellite HUD tabs jump via `jumpSat`; App scrolls to top on every path change.
- Formula videos F41–F46 NOT made (user cancelled; Sarvam has no credit). `render2.mjs` has a Gemini TTS fallback (10 clips/day/model on free tier).
- Corrected 16-slide deck: `NASA_Submission_Decks/v2/build_corrected.js` → `FIREWORK_CHRONOS_Corrected.pptx/.pdf`.

## Full 5-satellite rebuild (2026-11-15)
- Colab archive now 657,972,250 FIRMS points (MODIS 114.5 M, S-NPP 296.6 M, NOAA-20 173.0 M, NOAA-21 73.9 M), 2000–2026 YTD.
- New `calendar_global.json` from Colab notebook 02: 237 regions, years 2000–2026 (2026 Aug+ status "nrt"), new fields day_/night_ modis/viirs, platforms.noaa21, k_noaa20. Colab validation/model cards in `data/processed/global/colab/`.
- Results unchanged: G1 0.0965, G3 0.190, G6 95.0 %, T1 pass, T2 ρ 0.689. Trust build ignores years > 2025 (`OVERLAP_END` in trust.py).
- Colab notebook 03 models: harmoniser NOT READY (1/14 years), outlook NOT READY (6/25).
- `tools/models/train_harmoniser_v2.py` (correction to k with latitude, season, night share, Terra share, FRP): 13/14 years, 6/6 continents, lost 2022 by 1.5 % → NOT READY under the fixed rule; card in `model_card_harmoniser_v2.json`, shown on Validation.
