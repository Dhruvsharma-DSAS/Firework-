"""Build the trust layer (coverage gate, conformal intervals, physics checks, similar seasons, registry, method card).
Run from the repo root: backend/.venv/bin/python tools/trust/build_trust.py"""
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.trust import run

GLOBAL = ROOT / "data" / "processed" / "global"
FILES = [GLOBAL / "calendar_global.json", GLOBAL / "exposure_countries.json", GLOBAL / "calendar_global_ee.json", GLOBAL / "country_monthly_ee.csv", ROOT / "frontend" / "public" / "data" / "formulas_content.json", ROOT / "frontend" / "public" / "data" / "studio_sample_firms.csv"]

card = run(GLOBAL / "calendar_global.json", GLOBAL, FILES, ROOT)
for name in ["method_card.json", "registry.json"]:
    shutil.copy(GLOBAL / name, ROOT / "frontend" / "public" / "data" / name)
print(card["coverage_gate"]["counts"], card["conformal"]["results"], card["physics_checks"], card["gates"]["G6"])

try:
    import sklearn
except ImportError:
    sklearn = None
if sklearn is not None:
    import runpy
    runpy.run_path(str(ROOT / "tools" / "trust" / "build_advanced.py"), run_name="__main__")
