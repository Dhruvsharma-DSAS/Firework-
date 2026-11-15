# Files to replace in Google Drive (My Drive/FIREWORK_Colab)

Replace (Upload → Replace existing file). Do not delete anything in `data/`, `parquet/`, `manifests/` or `raw/`.

| File on this Mac (`Spacecode 3 /FIREWORK_Colab/`) | Goes to Drive |
|---|---|
| `fireworklib.py` | `FIREWORK_Colab/fireworklib.py` |
| `make_notebooks.py` | `FIREWORK_Colab/make_notebooks.py` |
| `02_build_calendar.ipynb` | `FIREWORK_Colab/02_build_calendar.ipynb` |

`01_collect_to_drive.ipynb` and `03_train_models.ipynb` were regenerated with the same code; replacing them is optional.

Then open `02_build_calendar.ipynb` → Runtime → Restart session and run all, and download the `export` folder again.
What changes in that run: exact grid edges, local day at the cell centre, rejected bad times, and a missing month counts
as 0 only where Earth Engine saw clear looks (countries and World); states and boxes keep unknown months out of k.
