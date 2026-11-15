"""Run the whole pipeline for some regions, step by step (each step is resumable).

python run_all.py --regions punjab_haryana cordoba_ar            # steps 1–6
python run_all.py --regions punjab_haryana --steps 5 6 7         # rebuild + load
Steps: 1 check · 2 FIRMS · 3 GEE monthly (+ --static once) · 4 daily weather · 5 build · 6 harmonise · 7 load Supabase · 8 train models
"""
import argparse
import subprocess
import sys

STEPS = {
    "1": ["s01_check_access.py"],
    "2": ["s02_firms_download.py"],
    "3": ["s03_gee_monthly.py"],
    "3s": ["s03_gee_monthly.py", "--static"],
    "4": ["s04_weather_daily.py"],
    "5": ["s05_build_tables.py"],
    "6": ["s06_harmonise.py"],
    "7": ["s07_load_supabase.py"],
    "8": ["s08_train_models.py"],
}


def main() -> None:
    """Call each step script with the same --regions."""
    ap = argparse.ArgumentParser()
    ap.add_argument("--regions", nargs="*", default=[])
    ap.add_argument("--steps", nargs="*", default=["1", "2", "3", "3s", "4", "5", "6"])
    args = ap.parse_args()
    for step in args.steps:
        cmd = [sys.executable] + STEPS[step]
        if step != "1" and args.regions:
            cmd += ["--regions"] + args.regions
        print("\n=== step", step, " ".join(cmd[1:]))
        code = subprocess.call(cmd)
        if code != 0:
            sys.exit("step %s failed (exit %d) — fix and rerun; finished work is kept" % (step, code))


if __name__ == "__main__":
    main()
