import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

ROOT = Path(__file__).resolve().parents[2]
STATIC_DIR = ROOT / "frontend" / "public" / "data"
PROCESSED_DIR = ROOT / "data" / "processed"

FIRMS_MAP_KEY = os.environ.get("FIRMS_MAP_KEY", "")
FIRMS_DAY_RANGE = int(os.environ.get("FIRMS_DAY_RANGE", "1"))
MAX_POINTS = int(os.environ.get("MAX_POINTS", "20000"))
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173").split(",") if o.strip()]
ALLOWED_ORIGIN_REGEX = os.environ.get("ALLOWED_ORIGIN_REGEX", "").strip() or None
CACHE_SECONDS = 600
PIPELINE_DIR = Path(os.environ.get("PIPELINE_PROCESSED_DIR", str(ROOT / "pipeline" / "data" / "processed")))
PIPELINE_REGIONS = ROOT / "pipeline" / "regions.json"
CACHE_DB = Path(os.environ.get("CACHE_DB", str(ROOT / "data" / "cache" / "fc_cache.sqlite")))
