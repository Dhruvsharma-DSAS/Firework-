# Claude Code prompt — Learn page v2 (FIREWORK CHRONOS)

Copy everything below the line into Claude Code, opened in the `FIREWORK` folder.

---

You are working in the FIREWORK CHRONOS repo. Read `CLAUDE.md` first and obey every rule in it (React style rules, full files, no new packages, truth policy, provenance labels, no push to main).

## Goal
Replace the current 6-card Learn page (`frontend/src/pages/Learn.jsx`) with **Learn v2**: 12 lessons + 2 guides (14 sections), each with a lead paragraph, 4 key points, 4–6 described sub-sections, real NASA satellite images, graphs made from our own FIRMS data, a Hinglish toggle, and a **"Read the detailed lesson (PDF)" link per section**. There's also a live NASA GIBS satellite viewer in section 14.

Everything you need is already in the repo:

| What | Where |
|---|---|
| Lesson content (all text, figure and image paths, `pdf` link field) | `frontend/public/data/lessons.json` |
| Graphs (dark theme, webp) | `frontend/public/learn/fig/*.webp` (19 files) |
| Real NASA satellite images (GIBS, webp) | `frontend/public/learn/sat/*.webp` (9 files) |
| Reference page component | `docs/learn_pack/Learn.jsx` |
| Reference styles | `docs/learn_pack/learn.css` |

## Steps
1. Create branch `feat/learn-v2` from the current branch. Do not push to main.
2. Copy `docs/learn_pack/Learn.jsx` to `frontend/src/pages/Learn.jsx` (full file). Check it follows the code rules: only `useState`, `useEffect`, props, `.map/.filter/.find`, `if/else` before `return`. No ternaries, no comments, no `useRef`, no custom hooks. Fix anything that breaks them.
3. Append the full contents of `docs/learn_pack/learn.css` to the end of `frontend/src/styles/app.css`. All classes start with `learn-`. Use only the existing tokens from `tokens.css`. Check light theme (`data-theme="light"`) still reads well.
4. Keep the route `/learn` in `App.jsx`. Don't change other pages.
5. Data: the page fetches `/data/lessons.json` through `fetchJson` from `src/api/client.js`. Do not inline the JSON in the component.
6. PDF links: do NOT add, host or link any PDF. Every lesson keeps `"pdf": ""`, and the page then shows a disabled "Detailed lesson — link coming soon" card, a disabled download button and a greyed library item. I will fill the `pdf` field for each lesson myself later. Make sure the page works with an empty `pdf` and also with a full URL (opens in a new tab).
7. Live viewer (section 14): images load in the browser straight from `https://gibs.earthdata.nasa.gov` (WMS, no key). Keep the status chip LIVE / LOADING / NO IMAGE FOR THIS DATE. Never show a failed image as "no fire".
8. Provenance: every figure caption already ends with its label (PHYSICS, DIAGRAM, RUN_TESTED_LOCALLY, LIVE, ILLUSTRATIVE, OFFICIAL_DOCUMENTED). Keep them visible. Keep the "not a life-safety alert system" line at the bottom.
9. Delete the temporary files `frontend/public/learn/capture.html` and `learn_bundle_tmp.json` (repo root) if they still exist. Make sure neither is committed.
10. Run `cd frontend && npm run build`. Fix every error and warning. Then run `npm run dev` and open `/learn`:
    - Click through all 14 sections in the left list and with the ← → pager.
    - Toggle EN / Hinglish.
    - Section 14: change layer, region and date. The image should load. Pick a date before 2000-02-24 and confirm the error chip appears.
    - Check at 1440 px and 390 px width: no horizontal scroll, and the nav turns into a grid on mobile.
    - Check the browser console has no errors.
11. Commit on `feat/learn-v2` with the message `Learn v2: 14 sections, real NASA imagery, data graphs, PDF link slots`. Show me the diff summary and screenshots. Don't merge or push until I say so.

## Section list (for reference)
01 How a satellite sees fire · 02 Why pixels differ · 03 Why clouds matter · 04 Why the 2012 jump is not real · 05 How harmonisation works · 06 How to read a band · 07 Meet the satellites · 08 From pixels to cell-days · 09 Crop, forest or industry? · 10 Fire power and smoke · 11 Reading the calendar and anomalies · 12 How we keep the numbers honest · 13 Most misunderstood ideas · 14 Reading the live feed

## Do not
- Do not add npm packages.
- Do not change any number in `lessons.json`. They come from our FIRMS archive, the NRT cache (2026-10-30 → 2026-11-02) and `harmonised_punjab_haryana.json`.
- Do not label the simulated demo files as real anywhere on this page.
