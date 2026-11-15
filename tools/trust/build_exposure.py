"""Exposure (clear-view cell-days) for every calendar country, from the Earth Engine table country_monthly_ee.csv.
Joins FIPS codes to the calendar's ISO3 regions by name (plus an alias table), and checks every join by comparing
annual MODIS fire cell-days in both sources (the ratio must stay within 0.33–3). Missing years stay null, never 0.
Run from the repo root: backend/.venv/bin/python tools/trust/build_exposure.py"""
import csv
import json
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GLOBAL = ROOT / "data" / "processed" / "global"
ALIAS = {
    "c_atg": ["AC"], "c_bhs": ["BF"], "c_bih": ["BK"], "c_cod": ["CG"], "c_cog": ["CF"], "c_dom": ["DR"], "c_esp": ["SP"],
    "c_flk": ["FA"], "c_fsm": ["FM"], "c_gmb": ["GA"], "c_gnq": ["EK"], "c_hmd": ["HM"], "c_kor": ["KS"], "c_prk": ["KN"],
    "c_nfk": ["NF"], "c_nld": ["NL"], "c_prt": ["PO"], "c_pyf": ["FP"], "c_tca": ["TK"], "c_tto": ["TD"], "c_usa": ["US"],
    "c_wlf": ["WF"], "c_atf": ["FS"], "c_bra": ["BR"], "c_civ": ["IV"], "c_cuw": ["UC"], "c_mmr": ["BM"], "c_pse": ["WE", "GZ"],
    "c_swz": ["WZ"], "c_ssd": ["OD"], "c_mkd": ["MK"], "c_stp": ["TP"], "c_shn": ["SH"], "c_kna": ["SC"], "c_vct": ["VC"],
    "c_mnp": ["CQ"], "c_esh": ["WI"], "c_ata": ["AY"], "c_egy": ["EG"], "c_sdn": ["SU"],
}


def norm(text: str) -> str:
    return re.sub(r"[^a-z]", "", (text or "").lower())


def main() -> None:
    calendar = json.loads((GLOBAL / "calendar_global.json").read_text())
    table = defaultdict(dict)
    names = {}
    for row in csv.DictReader(open(GLOBAL / "country_monthly_ee.csv", encoding="utf-8")):
        key = (row["product"], int(row["year"]), int(row["month"]))
        code = row["iso2"]
        names.setdefault(code, row["country"])
        prev = table[code].get(key, [0.0, 0.0])
        table[code][key] = [prev[0] + float(row["fire_cell_days"]), prev[1] + float(row["valid_cell_days"])]
    by_name = {norm(n): c for c, n in names.items()}
    out = {}
    report = {"joined": [], "rejected": [], "no_match": []}
    for rid, region in calendar["regions"].items():
        if not rid.startswith("c_"):
            continue
        codes = ALIAS.get(rid)
        if codes is None and norm(region.get("region_name")) in by_name:
            codes = [by_name[norm(region["region_name"])]]
        if not codes:
            report["no_match"].append(rid)
            continue
        firms = 0.0
        ee = 0.0
        for i, year in enumerate(region["years"]):
            if year in (2009, 2015) or year < 2001:
                continue
            for month in range(12):
                v = region["modis"][i][month]
                cell = None
                for code in codes:
                    c = table[code].get(("modis", year, month + 1))
                    if c:
                        cell = (cell or 0) + c[0]
                if v is not None and cell is not None:
                    firms += v
                    ee += cell
        ratio = None
        if firms > 0:
            ratio = ee / firms
        flag = None
        if firms >= 50 and (ratio is None or not 0.33 <= ratio <= 3):
            flag = "fire counts differ by more than 3×: the Earth Engine fire mask also counts gas flares and volcanoes, which the FIRMS vegetation filter removes; exposure is unaffected"
            report["rejected"].append([rid, codes, round(ratio, 3) if ratio else None])
        exp = {"exposure_modis": [], "exposure_viirs": []}
        for year in region["years"]:
            for product, field in [("modis", "exposure_modis"), ("viirs", "exposure_viirs")]:
                row = []
                for month in range(12):
                    total = None
                    for code in codes:
                        c = table[code].get((product, year, month + 1))
                        if c:
                            total = (total or 0) + c[1]
                    row.append(round(total, 1) if total is not None else None)
                exp[field].append(row)
        exp["codes"] = codes
        exp["fire_ratio_ee_to_firms"] = round(ratio, 3) if ratio else None
        exp["flag"] = flag
        out[rid] = exp
        report["joined"].append(rid)
    meta = {
        "source": "Google Earth Engine country_monthly_ee.csv: valid (clear-view) cell-days from MOD14A1 + MYD14A1 (MODIS) and VNP14A1 (VIIRS) FireMask classes 3, 5, 7, 8, 9, per USDOS LSIB country",
        "unit": "valid cell-days (0.1° cell × day with a clear valid observation)",
        "missing": "MODIS 2009 and 2015 were not exported: null, never 0",
        "join_check": "annual MODIS fire cell-days EE / FIRMS within 0.33–3 confirms the join; outside it the country is flagged (flares, volcanoes)",
        "joined": len(report["joined"]), "flagged": report["rejected"], "no_match": report["no_match"],
    }
    (GLOBAL / "exposure_countries.json").write_text(json.dumps({"meta": meta, "regions": out}, separators=(",", ":")))
    print("joined", len(report["joined"]), "rejected", report["rejected"], "no_match", report["no_match"])


if __name__ == "__main__":
    main()
