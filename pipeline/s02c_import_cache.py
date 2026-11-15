"""Step 2c (optional, no network) — import FIRMS chunks already downloaded by backend/pipeline/build_calendar.py.

python s02c_import_cache.py

Those files live in data/raw/firms/<SOURCE>/<W_S_E_N>/<start>_<days>.csv (same FIRMS Area API, untouched).
Each file whose bbox matches a region in regions.json is copied to the step-2 layout
data/raw/firms/<region>/<source>/<year>/<start>.csv and gets a manifest row, so s05 knows exactly which days are covered.
Nothing is changed inside the files; chunks already in the manifest are skipped.
"""
import io
import shutil
from datetime import date, timedelta

import pandas as pd

from lib.common import RAW_DIR, ROOT_DIR, load_regions, now_utc, sha256_file

LEGACY = ROOT_DIR / "data" / "raw" / "firms"
MANIFEST = RAW_DIR / "firms" / "manifest.csv"


def bbox_key(bbox: list) -> str:
    """Folder name build_calendar.py used for a bbox."""
    return "_".join(str(v) for v in bbox)


def main() -> None:
    """Copy each legacy chunk into the step-2 layout and append a manifest row."""
    if not LEGACY.exists():
        print("no legacy cache at", LEGACY)
        return
    by_key = {bbox_key(r["bbox"]): r["id"] for r in load_regions()}
    done = set()
    if MANIFEST.exists():
        m = pd.read_csv(MANIFEST, dtype=str)
        done = set(zip(m["region"], m["source"], m["start"]))
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    added = 0
    for path in sorted(LEGACY.glob("*/*/*.csv")):
        source = path.parts[-3]
        rid = by_key.get(path.parts[-2])
        if rid is None:
            continue
        start_text, days_text = path.stem.split("_")
        start = date.fromisoformat(start_text)
        days = int(days_text)
        if (rid, source, start.isoformat()) in done:
            continue
        folder = RAW_DIR / "firms" / rid / source / str(start.year)
        folder.mkdir(parents=True, exist_ok=True)
        target = folder / (start.isoformat() + ".csv")
        shutil.copyfile(path, target)
        text = target.read_text(encoding="utf-8")
        df = pd.read_csv(io.StringIO(text)) if text.strip() else pd.DataFrame()
        mn = mx = ""
        check = "OK imported from build_calendar cache"
        if len(df):
            mn = str(df["acq_date"].min())
            mx = str(df["acq_date"].max())
            hi = (start + timedelta(days=days - 1)).isoformat()
            if mn < start.isoformat() or mx > hi:
                check = "WARN dates %s..%s outside %s..%s" % (mn, mx, start.isoformat(), hi)
        entry = {"region": rid, "source": source, "start": start.isoformat(), "days": str(days), "rows": str(len(df)), "min_date": mn, "max_date": mx,
                 "sha256": sha256_file(target), "file": str(target.relative_to(RAW_DIR)), "fetched_at_utc": now_utc(), "check": check}
        pd.DataFrame([entry]).to_csv(MANIFEST, mode="a", header=not MANIFEST.exists(), index=False)
        added = added + 1
    print("imported", added, "chunks; manifest:", MANIFEST)


if __name__ == "__main__":
    main()
