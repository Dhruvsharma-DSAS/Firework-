# Deploying FIREWORK CHRONOS

Frontend on **Vercel**, backend on **Render** (or **Railway**), data in **Supabase**.
Everything below was tested on 2 Nov 2026: the backend Docker image was built and run with environment variables only
(no local data files), and every route answered — calendar, anomaly and 25-year cell tables from Supabase, Earth Engine
layers, live NASA FIRMS, model cards and the AI assistant.

```
 Browser ──► Vercel (React site, static)            frontend/
    │
    └──► Render / Railway (FastAPI in Docker) ──────  Dockerfile, backend/
            ├─► Supabase (fire calendar, k, cells, model cards)   SUPABASE_URL + SUPABASE_ANON_KEY
            ├─► NASA FIRMS (live hot spots)                       FIRMS_MAP_KEY
            ├─► Google Earth Engine (burned area, land cover, clear sky)  EE_PROJECT + EARTHENGINE_TOKEN
            └─► Groq / Gemini / Hugging Face (assistant words)    GROQ_API_KEY, GEMINI_API_KEY, HF_TOKEN
```

Files that make this work (already in the repo):

| file | for | what it does |
|---|---|---|
| `Dockerfile` | Render + Railway | Python 3.13 image with the backend and the small data it needs; starts uvicorn on `$PORT` |
| `.dockerignore` | Render + Railway | keeps `.env`, raw downloads, videos and node_modules out of the image |
| `render.yaml` | Render | Blueprint: one web service, health check `/api/health`, list of env vars to fill |
| `railway.json` | Railway | build from the Dockerfile, health check, restart on failure |
| `frontend/vercel.json` | Vercel | Vite build, `dist/` output, every page path (`/explore`, `/calendar/...`) served by `index.html` |
| `backend/app/supa.py` | backend | reads the pipeline tables from Supabase when the local files are not there (always the case on a server) |

---

## 0. Before you start (10 minutes)

1. **Rotate the keys that were pasted in chat.** They still work but are no longer secret:
   Groq, Gemini, Hugging Face, the Supabase service key and database password, Earthdata.
   Create new ones, put them in `backend/.env` locally, and use the new ones in the dashboards below.
2. **Get the Supabase anon key** (read-only, safe for a server): Supabase → Project Settings → API → *anon public*.
   The backend only reads; the service key is not needed on the server.
3. **Push the code to GitHub** (Render, Railway and Vercel deploy from the repo):
   ```bash
   cd "Spacecode 3 /FIREWORK" && git add -A && git commit -m "Deploy config" && git push origin main
   ```
   `backend/.env` is git-ignored and is never uploaded.
4. **Copy your Earth Engine sign-in token** (lets the server use Earth Engine as you):
   ```bash
   cat ~/.config/earthengine/credentials
   ```
   Keep the whole JSON text for the `EARTHENGINE_TOKEN` variable. (Cleaner long-term option: a service account, see §5.)

---

## 1. Backend on Render (recommended, free tier)

1. https://dashboard.render.com → **New → Blueprint** → connect GitHub → pick `Dhruvsharma-DSAS/SpaceCode-`.
2. Render reads `render.yaml` and proposes the service **firework-chronos-api** (Docker, free plan, Frankfurt).
3. Fill the variables marked *sync: false*:

| variable | value |
|---|---|
| `FIRMS_MAP_KEY` | your NASA FIRMS key |
| `SUPABASE_URL` | `https://brwgubmqlgivlwsgmkvx.supabase.co` |
| `SUPABASE_ANON_KEY` | anon public key (step 0.2) |
| `ALLOWED_ORIGINS` | your Vercel URL, e.g. `https://firework-chronos.vercel.app` (fill after step 3; comma-separate several) |
| `EE_PROJECT` | `forest-fire-research-512304` |
| `EARTHENGINE_TOKEN` | the JSON from step 0.4 (or leave empty and use `EE_SERVICE_ACCOUNT_JSON`) |
| `EE_SERVICE_ACCOUNT_JSON` | optional, see §5 |
| `GROQ_API_KEY`, `GEMINI_API_KEY`, `HF_TOKEN` | assistant keys (any subset; empty ones are skipped) |

   `FIRMS_DAY_RANGE`, `MAX_POINTS` and `ALLOWED_ORIGIN_REGEX` (all `*.vercel.app` preview URLs) are pre-filled.
4. **Apply**. The first build takes ~3–5 min. When it is live, open `https://<your-service>.onrender.com/api/health` → JSON with `"firms_live": true`.
5. Copy the service URL — the frontend needs it.

Free-tier notes: the service sleeps after 15 min without traffic; the first request after that takes ~30–60 s.
For a demo, open the site a minute early (or use the $7 Starter plan for no sleep). The disk is temporary:
the SQLite cache (`data/cache`) is rebuilt after each deploy, which is fine.

## 1b. Backend on Railway (alternative)

1. https://railway.com → **New Project → Deploy from GitHub repo** → pick the repo. Leave *Root Directory* empty (repo root).
2. Railway finds `railway.json` and builds the `Dockerfile`.
3. Service → **Variables** → add the same variables as the Render table (including `ALLOWED_ORIGIN_REGEX` = `https://.*\.vercel\.app`).
4. Service → **Settings → Networking → Generate Domain** → you get `https://<name>.up.railway.app`.
5. Check `https://<name>.up.railway.app/api/health`.

Railway does not sleep, but the free trial is a one-time credit (then ~$5/month Hobby).

---

## 2. Frontend on Vercel

1. https://vercel.com/new → import the GitHub repo.
2. **Root Directory: `frontend`** (the GitHub repo root is the FIREWORK folder). Framework preset: **Vite** (read from `frontend/vercel.json`).
3. **Environment Variables** → `VITE_API_URL` = the backend URL from §1 (no trailing slash), for Production and Preview.
4. **Deploy**. You get `https://<project>.vercel.app`.
5. Go back to Render / Railway and set `ALLOWED_ORIGINS` to that URL, then redeploy the backend (Render: *Manual Deploy → Deploy latest commit*).

`VITE_API_URL` is baked in at build time — after changing it, redeploy the frontend.

---

## 3. Check it works

| open | expect |
|---|---|
| `<backend>/api/health` | 200, `firms_live: true` |
| `<backend>/api/calendar/punjab_haryana` | years 2000–2026, `k_baseline["11"].k ≈ 2.10` |
| `<backend>/api/ml/models` | 3 model cards |
| `<backend>/api/context/landcover?bbox=73.8,27.6,77.6,32.6` | ~1,950 cells, mostly Cropland (Earth Engine works) |
| `<backend>/api/chat/models` | the assistant models you gave keys for |
| `<site>/` | live hot-pixel count in the hero tag, satellites docking on scroll |
| `<site>/explore` | dots on the globe, chip LIVE NRT; Context switches load (first time 5–40 s) |
| `<site>/calendar/punjab_haryana` | real calendar, Raw ↔ Harmonised |
| `<site>/validation` | Trained models table |
| Ask Chronos (bottom right) | answers in a few seconds, says which model wrote it |

---

## 4. Updating the data later

The deployed backend reads the pipeline tables from Supabase, so new data never needs a redeploy:
```bash
cd "Spacecode 3 /FIREWORK/pipeline"
../backend/.venv/bin/python run_all.py --regions punjab_haryana --steps 2 5 6     # download + rebuild
../backend/.venv/bin/python s08_train_models.py --regions punjab_haryana           # retrain (cards in ml/models)
../backend/.venv/bin/python s07b_load_supabase_rest.py --regions punjab_haryana    # upload (needs SUPABASE_SERVICE_KEY locally)
```
The backend picks the new rows up within 10 minutes (its Supabase cache). New model cards need a commit + redeploy.
New regions: add them to `pipeline/regions.json`, run the same three commands with `--regions <id>`.

---

## 5. Earth Engine on a server — service account (optional, cleaner than the token)

1. Google Cloud console → project `forest-fire-research-512304` → IAM & Admin → **Service Accounts** → Create
   (name e.g. `firework-ee`), role **Earth Engine Resource Viewer** + **Service Usage Consumer**.
2. Service account → Keys → **Add key → JSON** → download.
3. https://code.earthengine.google.com/register is already done for the project; make sure the Earth Engine API is enabled
   (APIs & Services → Library → *Google Earth Engine API*).
4. Put the whole JSON (or its base64) in `EE_SERVICE_ACCOUNT_JSON` on Render/Railway and leave `EARTHENGINE_TOKEN` empty.

The token method works immediately but is tied to your Google account; if you revoke it, the layers stop.

---

## 6. Limits worth knowing

| item | limit | effect on the site |
|---|---|---|
| NASA FIRMS | 5,000 transactions / 10 min per key | live globe is cached 10 min; on-demand cell tables limited to 31 days / ~2 months per call |
| Earth Engine (Community tier) | 150 EECU-hours / month | Context layers ≤ 30° × 30° (land cover any size), cached a day |
| Supabase free | 500 MB, project pauses after 7 days without activity | loaded data ≈ 150 MB; open the dashboard weekly or upgrade before judging |
| Render free | sleeps after 15 min, 512 MB RAM | first request slow after idle |
| Hugging Face free | small monthly credit | when used up, the assistant falls back to Groq / Gemini automatically |
| Raw `fire_detection` (2.4 M rows) | not in Supabase (free tier size) | `/api/export/hotspots.csv` returns live-cache rows only on the server |

## 7. Troubleshooting

| symptom | cause | fix |
|---|---|---|
| site loads but every panel says *UNAVAILABLE* / demo | `VITE_API_URL` missing or wrong, or backend asleep | set it in Vercel and redeploy; open `<backend>/api/health` once |
| browser console: *blocked by CORS policy* | `ALLOWED_ORIGINS` does not contain the exact Vercel URL | add it (no trailing slash), redeploy backend |
| `/explore` works but reloading `/calendar/...` gives 404 on Vercel | `vercel.json` not used | Root Directory must be the `frontend` folder |
| calendar 404 on the server | Supabase variables missing | set `SUPABASE_URL` + `SUPABASE_ANON_KEY` |
| Context switches: *Earth Engine not ready* | no EE credentials on the server | set `EARTHENGINE_TOKEN` or `EE_SERVICE_ACCOUNT_JSON` |
| Context: *Caller does not have required permission* | the signed-in Google account cannot use the project | sign in with the project owner, or give the account *Service Usage Consumer* |
| Ask Chronos: *No AI model answered* | no assistant keys on the server or all quotas used | add `GROQ_API_KEY` (free, fastest) |
| live globe empty right after midnight UTC | FIRMS 1-day window is empty then | the site already asks for 2 days; wait or pick 2D/3D |

Run the backend image locally exactly as the cloud does:
```bash
cd "Spacecode 3 /FIREWORK"
docker build -t firework-api .
docker run --rm -p 8001:8000 --env-file backend/.env -e "EARTHENGINE_TOKEN=$(cat ~/.config/earthengine/credentials)" firework-api
```
