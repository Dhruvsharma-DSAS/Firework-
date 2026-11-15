# Claude Code prompt: redesign the Formulas section

Paste everything below the line into Claude Code, opened at the root of the `FIREWORK` folder.

---

You are working on FIREWORK CHRONOS (NASA Space Apps 2026, Harmonization of MODIS and VIIRS Hot Spots). Read `CLAUDE.md` first and obey every rule in it. Then rebuild the Formulas section of the website (`/formulas` and `/formulas/:id`) so that each of the 46 formulas reads like a page from a scientific methods handbook. The content is already written. Your job is the data wiring, the layout and the typography.

## 1. Source of truth

- All content is in `docs/formula_pdfs/formulas_content.json` (46 entries, ids F01–F46). Do not write formula text yourself and do not edit any number in it.
- Each entry has these fields:
  - **Identity and status:** `id`, `name`, `family`, `layer`, `status` (`live` | `library` | `awaiting` | `experimental`), `status_label`, `status_text`.
  - **Opening:** `lead`, `equations` (an array of LaTeX strings), `reads` (the formula in plain words).
  - **Symbols:** `symbols` (each has `tex`, `meaning`, `unit`, `source`).
  - **Text sections:** `origin`, `why`, `how` and `example`. Each is an array of paragraphs. An item may be an object `{ "tex": "..." }`, which is a display equation inside the text.
  - **Numbers and figures:** `key_numbers`, `figures` (each has `file`, `title`, `caption`, `data`).
  - **Placement:** `stages`, `pages`, `where`.
  - **Closing:** `limits`, `code`, `related`, `references`, `pdf`.
- The `equations` field is the current formula. It is the only formula shown. The website must show no history: no "V1" or "V2", no "audit", no "verdict", no FIX/REVISE/OK, no "changed", no before/after comparison. Remove every use of `equation_v1`, `equation_v2`, `audit_verdict`, `audit_finding`, `v2_status` and `verdictColor` from the frontend.
- Copy the assets:
  - `docs/formula_pdfs/formulas_content.json` → `frontend/public/data/formulas_content.json`
  - `docs/formula_pdfs/figures/*.svg` → `frontend/public/formulas/figures/`
  - `docs/formula_pdfs/*.pdf` → `frontend/public/formulas/pdf/`
- In `frontend/src/api/data.js`, `loadFormulas()` reads `/data/formulas_content.json` and returns `{ data: json.formulas, meta: { status: "SOURCE_DERIVED" } }`.
- In `backend/app/main.py`, `/api/formulas` reads the same JSON file from `docs/formula_pdfs/` and returns it in the usual `{data, meta}` shape.

## 2. Math rendering

- The pages need KaTeX to render LaTeX. Adding the `katex` npm package needs Dhruv's OK (CLAUDE.md rule), so ask once before installing.
- Render with `katex.renderToString(tex, { displayMode, throwOnError: false })` inside `useEffect` and write the result with `document.getElementById(...).innerHTML`, the same pattern `GlobeView.jsx` uses. Do not use `useRef` and do not write a custom hook.
- Import `katex/dist/katex.min.css` once in `main.jsx`.
- Inline math in text appears as `$...$`. Split the text on `$` and render the odd segments as inline KaTeX.
- Display equations:
  - Centre them at 1.3em.
  - Put the equation number in the right gutter: `(F09)`, or `(F09.1)`, `(F09.2)` when there are several.
  - Draw a 2 px rule above the formula block and a 1 px rule below it.
  - Use no box, no glow and no gradient.

## 3. Index page `/formulas`

- **Header:** a small caps eyebrow "Method reference". The title is "46 formulas behind the fire record". One lead sentence: "Every number on FIREWORK comes from one of these formulas. Each page explains where it comes from, why the project needs it, how it works on real NASA FIRMS data, and where it appears on the site."
- **Controls:** one row, all filters combine.
  - A search box that matches id, name and lead.
  - Family chips: All plus the 8 families.
  - A status filter with the 4 statuses.
- **List:** grouped by family, with the family name as a section heading and its formula count. Each row shows:
  - the id in tabular monospace;
  - the name;
  - the lead, cut to one line with an ellipsis;
  - a small status square with its label;
  - the website pages where it appears, as small route chips.

  Clicking a row navigates to `/formulas/Fxx`.
- **Keyboard:** `/` focuses the search box. The up and down arrows move through rows, and Enter opens the selected one.

## 4. Detail page `/formulas/:id`

Build it in this order, as one readable column (max width 760 px) with a narrow left margin column (180 px) for section numbers on desktop:

1. **Breadcrumb:** `Formulas / {family} / {id}`.
2. **Title block:**
   - The id in large light ember-orange numerals, about 56 px, in a serif display font.
   - The name as h1.
   - The lead below it, at 18 px.
3. **Facts strip:** a 4-column table with hairline borders: Family, Layer, Status (coloured square, label and status_text), Shown on (route chips that link to the pages).
4. **The formula:** the block from section 2, then `reads` in italic.
5. **Symbols table:** columns Symbol (KaTeX), Meaning, Unit, Where the value comes from.
6. **Text sections:** numbered 01–04, with the number in ember and the title in serif.
   - 01 Where the formula comes from (`origin`)
   - 02 Why FIREWORK needs it (`why`)
   - 03 How it works, step by step (`how`). Lines starting with "• " become an ordered list with ember step numbers.
   - 04 Worked example (`example`)
7. **Key numbers:** a 4-column strip with large serif numerals and small labels.
8. **Figures:**
   - Show each SVG on a light paper card (background `#FFFFFF`, 8 px radius, 16 px padding), because the figures are drawn for a light background.
   - Put the caption below the card: bold `Figure n · title.`, then the caption, then a muted line `Data: ...`.
9. **05 Where it lives in FIREWORK:**
   - Write a React component `SystemMap` (props `stages`, `pages`) that draws an SVG with two rows:
     - Row 1: six stage boxes (Observe, Count, Calibrate, Bound, Test, Explain) joined by arrows. Highlight the formula's stages with an ember border and a tinted fill.
     - Row 2: eight page boxes (Explorer, Calendar, Sensor Lab, Validation, Sources, Blind Spot, Brief, Formulas), each with its route in monospace. Highlight the formula's pages with a filled box; these boxes are links.
   - Follow it with the `where` rows as a key/value table.
10. **06 Conditions and limits:** a list.
11. **07 Reference code:** a monospace block with a copy button.
12. **08 Related formulas and sources:** related formulas as links (`F14 Poisson GLM…`), then the numbered references.
13. **Footer bar:**
    - "Download this formula as PDF" (link to `/formulas/pdf/{pdf}`).
    - Previous and next formula links.
    - The standing caveat: "A hot spot is a pixel, not a fire; a cell-day is not burned area; harmonised values are estimates with an interval. Research decision support, not a life-safety alert system."

## 5. Visual design (no "AI look")

- **Feel:** this is a scientific reference, not a product landing page.
  - No gradients, glows, glassmorphism, emoji, oversized rounded cards, drop shadows or animated counters.
  - Separate sections with hairline rules and whitespace, not boxes.
- **Fonts:**
  - Body text: Source Serif 4 (`@fontsource/source-serif-4`, an npm package, so ask Dhruv first), or Georgia as the fallback.
  - UI labels, tables and chips: Inter.
  - Code and ids: JetBrains Mono.
- **Colours:** the existing tokens in `frontend/src/styles/tokens.css`.
  - Ember (`--fire-mark`) for numbers and highlights.
  - `--modis` and `--viirs` only where a sensor is meant.
  - Status colours: live `--good`, library `--viirs`, awaiting `--modis`, experimental `--model`.
- **Text sizes:** body 17 px with line-height 1.6, h1 40 px serif, section titles 22 px serif, table text 14 px Inter.
- **Mobile, below 760 px:**
  - The margin column disappears.
  - Tables scroll horizontally inside their own container.
  - Equations scroll horizontally, never overflow the page.
  - The system map stacks into two rows of chips.
- **Print:** in `@media print`, use a white background and black text, and hide the nav and footer bar.

## 6. Code rules (from CLAUDE.md, obey literally)

- **Allowed React features:** only `useState`, `useEffect`, `useParams`, `useNavigate`, props, `.map()`, `.filter()`, `.find()`, and `if/else` before `return`.
- **Not allowed:**
  - ternaries for branching;
  - custom hooks;
  - comments in frontend code;
  - `useRef`;
  - heavy abstractions;
  - new packages without asking.
- Always output full files.
- New or changed files:
  - `frontend/src/pages/Formulas.jsx` (index and detail; split into `FormulaIndex.jsx` and `FormulaPage.jsx` if clearer)
  - `frontend/src/components/SystemMap.jsx`
  - `frontend/src/components/MathBlock.jsx` (renders display or inline KaTeX via `document.getElementById` in `useEffect`)
  - `frontend/src/styles/formulas.css`
  - `frontend/src/api/data.js`
  - `backend/app/main.py` (the `/api/formulas` change only)
  - one backend test

## 7. Done when

1. All 46 detail pages render with zero KaTeX errors. Add a dev-only check that logs any `.katex-error` element.
2. No formula page contains the strings V1, V2, audit, verdict, FIX, REVISE, "equation_v". Add a test that searches the built `dist/` for them.
3. The Formulas index search finds "F09", "bootstrap" and "exposure".
4. On a 375 px wide phone no page scrolls sideways.
5. Every "Shown on" chip and every system-map page box links to the correct route.
6. Every PDF link opens the matching file in `/formulas/pdf/`.
7. `pytest` and `npm run build` pass.
8. You work on the branch `formulas-redesign`. Commit with a clear message, and do not push to main without Dhruv's OK.

When done, report:

- the files changed;
- screenshots at 1440 px and 375 px of `/formulas`, `/formulas/F12` and `/formulas/F45`;
- anything you could not do.
