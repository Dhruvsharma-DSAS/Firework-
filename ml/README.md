# ml/ — FIREWORK CHRONOS machine learning

Two trained models + one statistics check. All classical ML on tables (scikit-learn), no GPU, no deep learning.

| | model | question it answers | label (the "right answer") | file |
|---|---|---|---|---|
| A | source classifier | Is this hotspot a vegetation fire or a static/industrial/volcano source? | FIRMS archive `type` column | `train_source.py` |
| B | harmoniser | How many VIIRS cell-days would this MODIS month have had? (with a band) | VIIRS cell-days in the overlap years 2012→ | `train_harmonise.py` |
| C | unusual-month flag | Is this month far above its normal season? | none needed (robust z-score) | see docs/ML_GUIDE.md §6 |

## Run (works today on SIMULATED data)
```bash
cd ml
pip install -r requirements.txt          # ask before adding to the main backend
python make_synthetic.py                 # fake FIRMS-like archive CSVs -> data/
python train_source.py                   # -> models/source_classifier.joblib + .card.json + persistence_table.csv
python train_harmonise.py                # -> models/harmonise.joblib + .card.json + ../data/processed/harmonised_world.json
python -m pytest -q tests
```
Everything trained on synthetic files is stamped `SIMULATED_DEMO`. Those scores mean nothing.

## Run on real data
1. Download FIRMS archive CSVs (https://firms.modaps.eosdis.nasa.gov/download/ — Earthdata login or email code). MODIS C6.1 + VIIRS S-NPP 375 m, same area, 2012→now (MODIS also 2001→2011 for the back-cast). Start with 3–6 regions in different biomes.
2. Put them in `ml/data/` (git-ignored).
3. `python train_source.py data/modis_2012_2025.csv`
4. `python train_harmonise.py data/modis_a.csv,data/modis_b.csv data/viirs_a.csv,data/viirs_b.csv`
5. Read the `.card.json`: the model is only worth showing if it beats its baseline on the test years/tiles. Provenance becomes `RUN_TESTED_LOCALLY`.

## Backend
`backend/app/ml.py` loads `ml/models/*`. Endpoints: `GET /api/ml/models`, `POST /api/ml/source`, `GET /api/ml/harmonised/{region}`. If scikit-learn or a model file is missing → 503/404, never a guess.
