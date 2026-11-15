"""Write SIMULATED FIRMS-shaped raw chunks + manifest + GEE monthly files for tests (never real data)."""
import sys
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd


def make(data_dir: Path, region: str = "punjab", bbox=(73.8423, 29.5598, 76.9104, 32.5167), years=(2008, 2016)) -> None:
    """Fake chunks for MODIS_SP (2008–2016) and VIIRS_SNPP_SP (2012–2016), 10-day windows, Oct–Nov peak."""
    rng = np.random.default_rng(1)
    raw = data_dir / "raw" / "firms" / region
    man = []
    for source, y0, k in [("MODIS_SP", years[0], 1.0), ("VIIRS_SNPP_SP", 2012, 3.0)]:
        d = date(y0, 1, 1)
        while d <= date(years[1], 12, 31):
            peak = 1.0 if d.month in (10, 11) else 0.05
            n = rng.poisson(30 * peak * k)
            rows = []
            for _ in range(n):
                day = d + timedelta(days=int(rng.integers(0, 10)))
                lat = rng.uniform(bbox[1], bbox[3]); lon = rng.uniform(bbox[0], bbox[2])
                base = {"latitude": round(lat, 4), "longitude": round(lon, 4), "scan": 1.0, "track": 1.0, "acq_date": day.isoformat(), "acq_time": int(rng.choice([520, 805, 2040])), "frp": round(float(rng.lognormal(2, 1)), 1), "daynight": "D", "version": "SIM", "type": 0}
                if source.startswith("MODIS"):
                    base.update({"brightness": 320.0, "bright_t31": 295.0, "satellite": "Aqua", "instrument": "MODIS", "confidence": int(rng.integers(20, 100))})
                else:
                    base.update({"bright_ti4": 330.0, "bright_ti5": 290.0, "satellite": "N", "instrument": "VIIRS", "confidence": str(rng.choice(["l", "n", "h"]))})
                rows.append(base)
            folder = raw / source / str(d.year)
            folder.mkdir(parents=True, exist_ok=True)
            p = folder / (d.isoformat() + ".csv")
            cols = ["latitude", "longitude", "brightness", "scan", "track", "acq_date", "acq_time", "satellite", "instrument", "confidence", "version", "bright_t31", "frp", "daynight", "type"]
            if source.startswith("VIIRS"):
                cols = ["latitude", "longitude", "bright_ti4", "scan", "track", "acq_date", "acq_time", "satellite", "instrument", "confidence", "version", "bright_ti5", "frp", "daynight", "type"]
            pd.DataFrame(rows, columns=cols).to_csv(p, index=False)
            man.append({"region": region, "source": source, "start": d.isoformat(), "days": 10, "rows": n, "min_date": "", "max_date": "", "sha256": "x", "file": str(p), "fetched_at_utc": "2026-11-01T00:00:00+00:00", "check": "OK"})
            d += timedelta(days=10)
    pd.DataFrame(man).to_csv(data_dir / "raw" / "firms" / "manifest.csv", index=False)
    gee = data_dir / "raw" / "gee" / region
    gee.mkdir(parents=True, exist_ok=True)
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from lib.common import cells_in_bbox
    cells = cells_in_bbox(list(bbox))
    for y in range(years[0], years[1] + 1):
        rows = []
        for m in range(1, 13):
            g = pd.DataFrame({"cell_id": cells["cell_id"], "month": "%d-%02d" % (y, m)})
            g["valid_terra"] = rng.uniform(10, 25, len(g)); g["valid_aqua"] = rng.uniform(10, 25, len(g))
            if y >= 2012:
                g["valid_viirs"] = rng.uniform(10, 25, len(g))
            g["t2m_max_c"] = 25 + rng.normal(0, 2, len(g)); g["precip_mm"] = rng.gamma(1, 20, len(g)); g["ndvi"] = rng.uniform(0.2, 0.7, len(g))
            rows.append(g)
        pd.concat(rows).to_csv(gee / ("monthly_%d.csv" % y), index=False)


if __name__ == "__main__":
    make(Path(sys.argv[1]))
