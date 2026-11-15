# ERROR_STATUS — v3 register E01–E40 against the code (15 Nov 2026)

Checked against the working tree at commit `c2464bf` plus uncommitted work in progress (`tools/trust/run_gates.py`, API version middleware).
Colab code was checked in the newest `fireworklib.py` that runs in Drive (the copy in `../FIREWORK_Colab/` is older; see "Path notes").

`validate_v3.py` was run in a clean folder: its output matches `results_v3.json` exactly (13 of 13 sections, 0 differences).

## Summary

| Severity | Total | Present | Partly | Not present / n/a |
|---|---|---|---|---|
| Critical | 8 | 7 | 0 | 1 (E30) |
| High | 16 | 7 | 7 | 2 (E22, E24: not built yet) |
| Medium | 15 | 6 | 6 | 3 (E29, E31, E38) |
| Low | 1 | 0 | 0 | 1 (E40) |
| **All** | **40** | **20** | **13** | **7** |

## Register

| id | sev | file:line | still present? | evidence | planned fix (phase) |
|---|---|---|---|---|---|
| E01 | C | frontend/src/pages/Validation.jsx:31, :254 | yes | `const PASSED = ["G1", "G3", "G6"];` · `3 of 12 gates` | gate states read from validation_v3.json, clause by clause; G1, G3 Partial (P0) |
| E02 | H | frontend/src/pages/Validation.jsx:36 | yes | `…held 95.0 % … (19,924 checks)` | render n from data (19,984); no typed counts (P0) |
| E03 | H | frontend/src/pages/Validation.jsx:365 | yes | `A range with a tested guarantee on every harmonised month` | "pooled 95.00 % of 19,984 aggregate checks, MODIS ≥ 10, tested scope" (P0) |
| E04 | C | backend/app/trust.py:106–154, :284–290 | yes | `all_scores.extend(loyo_scores(region))` then `cross_conformal_coverage(all_scores…)` drops only the test year's rows | nested: drop outer year before any score; track fit_years (P1) |
| E05 | H | frontend/src/pages/Calendar.jsx:483 | yes | `Math.round(hv / cls.factor95) … Math.round(hv * cls.factor95)` | band = [max(0,(H+.5)e^-q−.5), (H+.5)e^q−.5] (P1) |
| E06 | C | pipeline/s05_build_tables.py:162 | yes | `…sum(min_count=1).max(axis=1, skipna=True).rename("valid_cell_days")` | Y and E from the same ledger rows (P1/P2) |
| E07 | C | pipeline/s06_harmonise.py:29 | yes | `d = d[d[value + "_m"] > 0]` | keep usable zeros (P1) |
| E08 | C | fireworklib.py (Drive) `calibrate` and `validate` | yes | `w = w[(w.year >= overlap[0]) & …].fillna(0)` · `pivot_table(…).reset_index().fillna(0)` | no fillna(0) on sensor columns; NO_PASS → null end to end (P1) |
| E09 | H | fireworklib.py (Drive) `build_cell_days` SQL; frontend/src/lib/geo.js | partly | Colab: `floor((lat_e5 / 1e5 + 90) / {g})`, no wrap/clamp; pipeline/lib/common.py:93–94 already rounds to 9 dp and clamps | decimal index, wrap 180°, clamp lat 90 in Colab and JS (P1) |
| E10 | M | pipeline/lib/common.py:154–156; Colab `local_date` | yes | `hh = (acq_time // 100) + (acq_time % 100) / 60` at detection lon; no 2400 / minute ≥ 60 guard | cell-centre LMST with roll-over and guards (P1) |
| E11 | H | frontend/public/data/formulas_content.json F45; BlindSpot scenario code | partly | F45 equation already uses a union; scenario numbers (47 % / 6 %) come from summed windows | compute F45 on the 24 h circle (P1) |
| E12 | M | no Mann–Kendall code in pipeline; used in paper/deck (p = 0.007) | partly | trend only reported, not reproducible in repo | tie-corrected Var(S) helper + test (P1) |
| E13 | M | paper / deck Punjab trend | yes | post-2016 slope, n = 10, no Hamed–Rao | Hamed–Rao; label exploratory (P1) |
| E14 | M | backend/app/main.py anomaly (F27) | partly | z-score on counts; log-rate path has no ε | ε = 0.5 per 1,000 (P1) |
| E15 | M | backend/app/trust.py `ALPHAS = {"90": 0.10, "95": 0.05}` | partly | both 90 % and 95 % computed; site shows 95 % | 95 % everywhere (P1) |
| E16 | H | pipeline/s06_harmonise.py:33–40; trust.py conformal | partly | s06 resamples year rows per month (block-like); conformal scores treated iid | year-block bootstrap everywhere (P1) |
| E17 | H | frontend/src/pages/Calendar.jsx "k used" + "95 % interval" rows | yes | parameter band `[lo, hi]` and predictive band shown without a kind | show `parameter (k)` / `predictive (conformal 95%)` (P0) |
| E18 | H | fireworklib.py `validate` seam; tools/trust/run_gates.py `g3_all` | yes | `kk = …2012:2014 viirs / …2012:2014 modis` scored on the same years; bootstrap resamples regions | held-out pseudo-cutovers, blocked bootstrap (P3) |
| E19 | M | tools/trust/run_gates.py `g1_all` (uncommitted) | yes | `kg = V[w, tr, :].sum() / M[w, tr, :].sum()` = one global k, not B1 median of ratios | name each baseline; identical rows (P3) |
| E20 | C | backend/app/trust.py:31–47 `fill_processed_zeros` | yes | `if values[i][m] is None and world[kind][i][m] is not None: values[i][m] = 0` | only ledger usable looks are exposure (P2) |
| E21 | H | pipeline/s03_gee_monthly.py:9–11 | yes | `valid_terra … MOD14A1 FireMask … VNP14A1 (1 km daily …)` used as denominator | label "daily composite proxy" (B2); pass ledger for P1 (P2) |
| E22 | H | no pairing/matching module exists | n/a now | k is a ratio of unpaired totals | candidate pixel links in s07_pairs.py (P2) |
| E23 | C | k everywhere = ratio of unpaired totals 2012–2025 | yes | `k = Σ VIIRS S-NPP / Σ MODIS over overlap years` (fireworklib `calibrate`) | fit k on measured pairs; pair counts per year (P2) |
| E24 | H | not yet built | n/a now | no 2025 paired stress case exists in code | 2025 as unpaired transport test (P3) |
| E25 | H | single k per region-month | yes | Colab `calibrate` and trust.py | transport tests; S3 −25 % / −40 % fixture (P3) |
| E26 | M | pipeline/s12_fire_clock.py FC2 | yes | night share = VIIRS night ÷ all VIIRS | rate ratio ρ with both denominators (P2) |
| E27 | M | pipeline/s12_fire_clock.py FC1 | partly | Terra/Aqua ratio already labelled "supporting only" on the page | drift probe with controls (P2) |
| E28 | H | data/processed/global/calendar_global.json 2026 months | partly | 2026 Aug+ flagged `nrt`, but SP and NRT summed in the same series | separate streams; NOAA-20/21 links versioned (P2) |
| E29 | M | backend/app/firms.py | no | no 0.25/0.6/0.9 mapping found; native l/n/h classes used | none |
| E30 | C | seed/evaluation_metrics.json | no | file and references not found in repo or site | none (verify on live site) |
| E31 | M | old deck only | n/a | not in site code | none in code |
| E32 | H | frontend/src/pages/BlindSpot.jsx:298 | partly | badge "Scenario, not a measurement" exists; 47 % / 6 % also quoted in decks | keep label; check decks (P0) |
| E33 | H | docs/spec/docs_v2/CLAIM_LEDGER.csv, docs/claude_project | partly | "no physical change" wording in docs | "the step is mainly instrumental" (P0 copy) |
| E34 | H | formulas_content.json F46 | partly | F46 listed "Waiting for input data", not applied | review flag only (P1) |
| E35 | M | formulas_content.json F38 | partly | Kalman listed "Experimental" | park (P1) |
| E36 | M | Explorer / Inspector FRP | partly | FRP shown per sensor but also pooled in hexes | FRP separate layer in MW (P4) |
| E37 | M | Colab custom_regions.csv `b_punjab_haryana` bbox vs paper admin-1 | yes | bbox `73.84,27.67,77.59,32.52` | aoi_hash on every row; refuse mixed comparisons (P1) |
| E38 | M | calendar_global.json k_baseline n_years | no | Punjab + Haryana: 14 years in every month | per-month year-count check (P1 test) |
| E39 | M | frontend/src/pages/Explorer.jsx archive mode | yes | no scope label on archive points | "Archive points: 5–6 Nov 2025 only" (P0) |
| E40 | L | Fire Clock "Where it fits" | no | no competitor names or numbers on the site | none |


## Path notes
- `../FIREWORK_Colab/fireworklib.py` on this Mac is older than the Drive copy. The Drive copy (downloaded as `~/Downloads/fireworklib (1).py`) is the one that ran; its `calibrate`/`validate` are around lines 559–635, not 570–602.
- There is no `tests/v3/`; existing tests are in `backend/tests/` and `pipeline/tests/`.
- `pipeline/s04_weather_daily.py` and `s07_load_supabase.py` already use the numbers s04 and s07; the new ledger and pairs modules need different numbers.
- Uncommitted work from earlier today (G12 API version middleware, `run_gates.py`, `gates.json`) is still in the tree and not pushed.

## Status after P0 + P1 (15 Nov 2026, evening)

| id | now | how / what is left |
|---|---|---|
| E01 | fixed | gate states clause by clause from `validation_v3.json` |
| E02 | fixed | no typed counts; 19,984 read from data |
| E03 | fixed | "pooled … not a per-month guarantee" |
| E04 | fixed | `trust.nested_rows` / `nested_coverage`: outer year removed before any score; 0 leaks; 94.76 % of 19,984 |
| E05 | fixed | Calendar band `[max(0,(H+.5)/f−.5), (H+.5)·f−.5]`; `core.interval` + test |
| E06 | partly | `core.coverage_rate` (union) + test; s05 exposure labelled `daily_composite_proxy`; true union needs the pass ledger (P2) |
| E07 | fixed | s06 keeps usable zeros; test 2.5 |
| E08 | fixed in code | Colab `paired_table`: a missing month is 0 only with clear looks, else left out; needs a Colab rerun |
| E09 | fixed in code | Colab grid in exact integers, 180° wraps, lat 90 clamped; `core.cell_index` + test; needs a Colab rerun |
| E10 | fixed in code | Colab local day at the cell centre, 2400 and minute guards; `core.lmst` + test; needs a Colab rerun |
| E11 | fixed | Blind Spot share = union of windows on the 24 h circle; `core.window_union_share` + test |
| E12 | fixed | `core.mk_test` with ties and Hamed–Rao; test |
| E13 | open | Punjab post-2016 trend is not on the site; label it exploratory in decks/paper |
| E14 | fixed | `core.log_rate` with ε; anomaly endpoint uses robust z, no log |
| E15 | fixed | 95 % only |
| E16 | partly | s06 and Colab resample year blocks; `core.block_bootstrap` + test; conformal pooled by size class |
| E17 | fixed | every band labelled parameter (k) or predictive (conformal) |
| E18 | fixed | G3: k from 2015–2025 only, bootstrap by country blocks; upper bound 0.18 |
| E19 | fixed | G1 compares with B1 = median of ratios on identical rows (6.9 % vs 7.7 %) |
| E20 | fixed | a 0 needs the region's own clear looks (trust, API, s05); G8 made-up zeros = 0 |
| E21 | partly | proxy label in s05; pass-level ledger is P2 |
| E22 | open (P2) | pair links need L2 granules (LAADS, Earthdata) |
| E23 | open (P2) | paired k needs L2 granules |
| E24 | open (P2) | 2025 unpaired transport test with drift probe |
| E25 | partly | T1 continent transfer and G2 (failed) report the limit; S3 transport test is P3 |
| E26 | partly | Fire Clock copy now "night share of detections"; rate ratio ρ needs day/night exposure (P2) |
| E27 | partly | FC1 shown as supporting only; drift probe is P2 |
| E28 | partly | 2026 months flagged `nrt`; streams not yet stored separately |
| E29 | not present | — |
| E30 | not present | — |
| E31 | n/a | old deck only |
| E32 | ok | Blind Spot carries the "Scenario, not a measurement" badge |
| E33 | fixed | site says the step is mainly instrumental |
| E34 | ok | F46 listed as waiting, never applied |
| E35 | ok | F38 listed as experimental |
| E36 | open | FRP layer split by sensor (P4) |
| E37 | partly | `aoi_hash`, `grid_version`, `interval_kind` on calendar API meta; Colab box vs admin-1 polygon remains |
| E38 | fixed | test: no month has more than 14 overlap years |
| E39 | fixed | Explorer archive scope label |
| E40 | not present | — |

Counts now: fixed (or fixed in code, awaiting a Colab rerun) 20 · partly 8 · open 5 (E13, E22–E24, E36) · not present, n/a or already correct 7.
