"""Step 8 — train the three models on YOUR real data (after steps 2, 3, 5, 6).

python s08_train_models.py --regions punjab_haryana cordoba_ar california

A  source classifier   ml/train_source.py    labels = FIRMS archive `type` (MODIS_SP files)
B  harmoniser          ml/train_harmonise.py MODIS_SP + VIIRS_SNPP_SP detections, overlap 2012 →
C  next-month outlook  ml/train_forecast.py  processed cell_month tables (+ Earth Engine weather if present)
Each writes a model card in ml/models/*.card.json. Read them before showing anything on the site:
a model is shown only if it beats its baseline in every test fold.
"""
import argparse
import subprocess
import sys

import pandas as pd

from lib.common import PIPE_DIR, PROC_DIR, RAW_DIR, cell_index, load_regions, region_cells

ML = PIPE_DIR.parent / "ml"


def combine(source: str, regions: list) -> str:
    """Concatenate raw FIRMS chunk files of one source (same header) into one training CSV, keeping only rows inside the region polygon cells."""
    frames = []
    for r in regions:
        cells = region_cells(r)
        for f in sorted((RAW_DIR / "firms" / r / source).glob("*/*.csv")):
            try:
                d = pd.read_csv(f)
            except pd.errors.EmptyDataError:
                continue
            if len(d) and cells:
                d = d[pd.Series(cell_index(d["latitude"], d["longitude"]), index=d.index).isin(cells)]
            if len(d):
                frames.append(d)
    if not frames:
        return ""
    out = PROC_DIR / "train" / ("%s.csv" % source)
    out.parent.mkdir(parents=True, exist_ok=True)
    pd.concat(frames, ignore_index=True).to_csv(out, index=False)
    return str(out)


def main() -> None:
    """Build training files and run the three trainers."""
    ap = argparse.ArgumentParser()
    ap.add_argument("--regions", nargs="*")
    args = ap.parse_args()
    regions = [r["id"] for r in load_regions(args.regions)]
    modis = combine("MODIS_SP", regions)
    viirs = combine("VIIRS_SNPP_SP", regions)
    if modis:
        subprocess.call([sys.executable, "train_source.py", modis], cwd=ML)
    if modis and viirs:
        name = "_".join(regions)
        subprocess.call([sys.executable, "train_harmonise.py", modis, viirs, name], cwd=ML)
    subprocess.call([sys.executable, "train_forecast.py", "--processed", str(PROC_DIR), "--regions"] + regions, cwd=ML)


if __name__ == "__main__":
    main()
