"""Step 2b (optional, no key) — FIRMS yearly country files for large or global studies.

python s02b_firms_country_yearly.py --countries India Argentina --years 2001 2025

FIRMS publishes yearly per-country CSVs (standard data, with the `type` column) on its download site.
URL pattern used here (CHECK it on the FIRMS "Yearly Summary by Country" page before a big run):
  https://firms.modaps.eosdis.nasa.gov/data/country/<product>/<year>/<product>_<year>_<Country>.csv
  product = modis | viirs-snpp | viirs-jpss1   (jpss1 = NOAA-20)
Files are saved untouched under data/raw/firms_country/<product>/<year>/.
A 404 is logged and skipped (the product may not exist for that year).
"""
import argparse
import time

import httpx

from lib.common import RAW_DIR, now_utc, sha256_file

BASE = "https://firms.modaps.eosdis.nasa.gov/data/country"
FIRST_YEAR = {"modis": 2000, "viirs-snpp": 2012, "viirs-jpss1": 2018}


def main() -> None:
    """Download each (product, year, country) file once."""
    ap = argparse.ArgumentParser()
    ap.add_argument("--countries", nargs="+", required=True)
    ap.add_argument("--years", nargs=2, type=int, default=[2000, 2025])
    ap.add_argument("--products", nargs="*", default=list(FIRST_YEAR))
    args = ap.parse_args()
    log = RAW_DIR / "firms_country" / "log.csv"
    log.parent.mkdir(parents=True, exist_ok=True)
    if not log.exists():
        log.write_text("product,year,country,status,bytes,sha256,fetched_at_utc\n")
    for product in args.products:
        for year in range(max(args.years[0], FIRST_YEAR[product]), args.years[1] + 1):
            for country in args.countries:
                name = "%s_%d_%s.csv" % (product, year, country.replace(" ", "_"))
                out = RAW_DIR / "firms_country" / product / str(year) / name
                if out.exists():
                    continue
                url = "%s/%s/%d/%s" % (BASE, product, year, name)
                r = httpx.get(url, timeout=300, follow_redirects=True)
                status = str(r.status_code)
                size = 0
                digest = ""
                if r.status_code == 200 and r.text.startswith("latitude"):
                    out.parent.mkdir(parents=True, exist_ok=True)
                    out.write_bytes(r.content)
                    size = len(r.content)
                    digest = sha256_file(out)
                print(product, year, country, status, size)
                with open(log, "a") as handle:
                    handle.write("%s,%d,%s,%s,%d,%s,%s\n" % (product, year, country, status, size, digest, now_utc()))
                time.sleep(1)


if __name__ == "__main__":
    main()
