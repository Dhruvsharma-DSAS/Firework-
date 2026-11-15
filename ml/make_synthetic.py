"""Make SIMULATED FIRMS-like archive CSVs so the whole ML pipeline can run before real data is downloaded.
Every file written here is fake. Models trained on it get provenance SIMULATED_DEMO and must never be shown as results."""
import numpy as np
import pandas as pd

from common import DATA_DIR

SEED = 26

REGIONS = [
    {"name": "crop_belt_asia", "lat": (29.5, 31.5), "lon": (74.0, 77.0), "lc": 40, "rate": 0.020, "peaks": [4, 10], "k": 3.4, "frp": 12},
    {"name": "savanna_africa", "lat": (-14.0, -10.0), "lon": (24.0, 30.0), "lc": 30, "rate": 0.030, "peaks": [6, 7, 8], "k": 2.3, "frp": 25},
    {"name": "forest_amazon", "lat": (-12.0, -8.0), "lon": (-58.0, -53.0), "lc": 10, "rate": 0.015, "peaks": [8, 9], "k": 1.9, "frp": 45},
    {"name": "shrub_australia", "lat": (-20.0, -16.0), "lon": (128.0, 134.0), "lc": 20, "rate": 0.018, "peaks": [9, 10, 11], "k": 2.0, "frp": 30},
    {"name": "boreal_siberia", "lat": (60.0, 63.0), "lon": (110.0, 118.0), "lc": 10, "rate": 0.006, "peaks": [6, 7], "k": 1.6, "frp": 70},
]

STATIC_SITES = 25


def season_weight(month: int, peaks: list) -> float:
    """Seasonal shape: 1 at peak months, 0.35 next to a peak, 0.05 otherwise."""
    if month in peaks:
        return 1.0
    for p in peaks:
        if abs(month - p) == 1:
            return 0.35
    return 0.05


def make_rows(rng: np.random.Generator, sensor: str, platform: str, years: range) -> list:
    """Both sensors share the same cell and year fire intensity (same planet), then draw their own detections. Vegetation fires per region-cell-month and persistent static sources (type 2)."""
    rows = []
    for index, region in enumerate(REGIONS):
        shared = np.random.default_rng(SEED + index)
        lats = np.arange(region["lat"][0], region["lat"][1], 0.1)
        lons = np.arange(region["lon"][0], region["lon"][1], 0.1)
        cell_factor = shared.gamma(0.6, 1.0 / 0.6, size=(len(lats), len(lons)))
        year_factors = {y: shared.lognormal(0.0, 0.35) for y in range(2000, 2027)}
        for year in years:
            year_factor = year_factors[year]
            for month in range(1, 13):
                weight = season_weight(month, region["peaks"])
                lam = region["rate"] * weight * year_factor * cell_factor
                if sensor == "VIIRS":
                    lam = lam * region["k"]
                counts = rng.poisson(lam * 3.0)
                hits = np.argwhere(counts > 0)
                for i, j in hits:
                    for _ in range(int(counts[i, j])):
                        day = int(rng.integers(1, 29))
                        lat = lats[i] + rng.uniform(0, 0.1)
                        lon = lons[j] + rng.uniform(0, 0.1)
                        frp = float(rng.lognormal(np.log(region["frp"]), 0.9))
                        if sensor == "VIIRS":
                            frp = frp * 0.35
                        rows.append(make_row(rng, sensor, platform, lat, lon, year, month, day, frp, 0))
    sites = rng.uniform([-35, -120], [60, 150], size=(STATIC_SITES, 2))
    for site in sites:
        for year in years:
            n_days = int(rng.integers(1, 40))
            for _ in range(n_days):
                month = int(rng.integers(1, 13))
                day = int(rng.integers(1, 29))
                lat = site[0] + rng.normal(0, 0.002)
                lon = site[1] + rng.normal(0, 0.002)
                frp = float(rng.lognormal(np.log(40), 0.5))
                rows.append(make_row(rng, sensor, platform, lat, lon, year, month, day, frp, 2))
    return rows


def make_row(rng, sensor, platform, lat, lon, year, month, day, frp, kind) -> dict:
    """One FIRMS-like row. Static sources burn day and night; vegetation fires peak in the afternoon."""
    if kind == 2:
        night = rng.random() < 0.5
    else:
        night = rng.random() < 0.12
    if night:
        local = rng.uniform(0.5, 3.0)
    else:
        local = rng.uniform(10.0, 14.5)
    utc = (local - lon / 15.0) % 24.0
    hh = int(utc)
    mm = int((utc - hh) * 60)
    dn = "D"
    if night:
        dn = "N"
    row = {
        "latitude": round(float(lat), 4), "longitude": round(float(lon), 4),
        "scan": round(float(rng.uniform(1.0, 2.5)), 2), "track": round(float(rng.uniform(1.0, 1.6)), 2),
        "acq_date": "%04d-%02d-%02d" % (year, month, day), "acq_time": hh * 100 + mm,
        "frp": round(frp, 1), "daynight": dn, "type": kind, "version": "SIMULATED",
    }
    if sensor == "VIIRS":
        row["bright_ti4"] = round(float(rng.uniform(305, 367)), 1)
        row["bright_ti5"] = round(float(rng.uniform(270, 300)), 1)
        row["satellite"] = "N"
        row["instrument"] = "VIIRS"
        row["confidence"] = str(rng.choice(["l", "n", "h"], p=[0.1, 0.75, 0.15]))
    else:
        row["brightness"] = round(float(rng.uniform(305, 360)), 1)
        row["bright_t31"] = round(float(rng.uniform(280, 305)), 1)
        row["satellite"] = platform
        row["instrument"] = "MODIS"
        row["confidence"] = int(rng.integers(30, 100))
    return row


def main() -> None:
    """Write data/synthetic_modis_archive.csv (2005-2026) and data/synthetic_viirs_archive.csv (2012-2026)."""
    rng = np.random.default_rng(SEED)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    modis = pd.DataFrame(make_rows(rng, "MODIS", "Aqua", range(2005, 2027)))
    viirs = pd.DataFrame(make_rows(rng, "VIIRS", "N", range(2012, 2027)))
    modis.to_csv(DATA_DIR / "synthetic_modis_archive.csv", index=False)
    viirs.to_csv(DATA_DIR / "synthetic_viirs_archive.csv", index=False)
    print("SIMULATED rows: MODIS", len(modis), "VIIRS", len(viirs))


if __name__ == "__main__":
    main()
