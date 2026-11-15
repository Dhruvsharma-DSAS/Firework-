# P0 — stop overclaiming (15 Nov 2026)

Copy and data-binding changes only. Site layout, components and palette unchanged; the only style additions are amber/ember variants of the existing gate-state classes.

## Acceptance
- `npm run build`: passes.
- `grep -rn "19924\|19,924\|how much fire" frontend/src`: no matches.
- Backend tests: 42 passed (includes the new G12 provenance test).
- Gate states read only from `frontend/public/data/validation_v3.json`; switching Live → Demo leaves every state unchanged (checked in the browser).

## Gate states now shown (from `tools/trust/build_validation_v3.py`)
| Gate | Before (site) | Now | Why |
|---|---|---|---|
| G1 | Passed | Partial | 9.7 % ≤ 15 % passes; "better than B1 on identical rows" pending |
| G2 | Pending | Failed | borrowed k 3.44× in-region error (limit 1.5×, local scope) |
| G3 | Passed | Partial | median 0.19 passes; held-out, blocked upper bound pending (in-sample unblocked bound 0.20) |
| G4 | Pending | Partial | 8.1 % false positives (limit 10 %), but the written method (Pettitt/PELT, 20 years) not yet run |
| G5 | Pending | Passed | break rate at 2018 / 2023 not above the no-change rate |
| G6 | Passed | Partial | 95.00 % of 19,984 pooled checks; nested outer-year removal pending (E04) |
| G7 | Pending | Passed | Bland–Altman bias −0.012 (limit ±0.1), 19,725 region-months |
| G8 | Pending | Failed | zeros inferred from Whole-Earth processing, not the region's own looks (E20) |
| G9 | Pending | Not tested | needs per-cell land-cover masks |
| G10 | Pending | Partial | FIRMS type filter applied; known-site list check pending |
| G11 | Pending | Not tested | no source label shown |
| G12 | Pending | Passed | every API answer has data_source, status, version (backend test) |

Counts: 3 passed · 5 partial · 2 failed · 2 not tested.

## Changes by register item
- E01, E02, E03: Validation reads every state, count and figure from `validation_v3.json`; "tested guarantee" replaced by "pooled … not a per-month guarantee"; 19,924 replaced by the data value 19,984.
- E05: Calendar interval now `[max(0,(H+0.5)/f−0.5), (H+0.5)·f−0.5]`.
- E17: Calendar labels each band: "k used · parameter band (k)", "95 % interval · predictive (conformal)", chart legend "95% band · parameter (k)".
- E39: Explorer archive mode shows "Archive points: 5–6 Nov 2025 only" (a picked day still shows that day).
- README: "reported 9.7% median held-out error and 0.19 median seam ratio on the stated sample; baseline comparison and seam upper bound pending."
- "how much fire VIIRS sees": not present in `frontend/src`; nothing to replace.
- E30 synthetic `seed/evaluation_metrics.json`: not present anywhere; nothing to remove.

## Not done in P0
- The hosted research paper PDF abstract still carries the old wording; a PDF edit is needed.
- Local screenshots of the Calendar use the demo fixture (backend not running locally); labels are the same in live data.

## Screenshots (after)
- `p0/validation_board_after.jpg` — gate strip and counts
- `p0/validation_results_after.jpg` — G1, G3, G6 cards with Partial and pending clauses
- `p0/validation_gates_after.jpg` — gate list with state pills and results
- `p0/calendar_inspector_after.jpg` — band kind labels in the month inspector

No "before" screenshots were taken; the before state is the live site at commit `c2464bf`.
