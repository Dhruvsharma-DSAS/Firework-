"""Core formulas shared by the pipeline, the trust build and the API.
Each function matches one fixture in docs/v3/results_v3.json and has a test in tests/v3/."""
import hashlib
import json
import math
from datetime import date, timedelta
from decimal import ROUND_FLOOR, Decimal

import numpy as np

GRID = "0.1"
EPS_RATE = 0.5
RATE_MAX = 1000.0


class AOIMismatch(ValueError):
    pass


def cell_index(lat: float, lon: float, res: str = GRID) -> tuple:
    """Eq. 1 with exact decimals: row from -90, column from -180; lon 180 wraps to column 0, lat 90 is the last row."""
    step = Decimal(res)
    nrows = int(Decimal(180) / step)
    ncols = int(Decimal(360) / step)
    lo = Decimal(repr(float(lon)))
    if lo >= 180:
        lo = lo - 360
    if lo < -180:
        lo = lo + 360
    row = int(((Decimal(repr(float(lat))) + 90) / step).to_integral_value(ROUND_FLOOR))
    col = int(((lo + 180) / step).to_integral_value(ROUND_FLOOR))
    row = min(max(row, 0), nrows - 1)
    col = min(max(col, 0), ncols - 1)
    return row, col


def cell_centre(row: int, col: int, res: str = GRID) -> tuple:
    step = float(res)
    return -90 + (row + 0.5) * step, -180 + (col + 0.5) * step


def lmst(acq_date: date, hhmm: int, lon_centre: float) -> tuple:
    """Local mean solar time at the cell centre: (local date, hours). 2400 means 00:00 next day; minutes must be < 60."""
    hh, mm = divmod(int(hhmm), 100)
    if mm >= 60 or hh > 24 or (hh == 24 and mm > 0):
        raise ValueError("bad acq_time %s" % hhmm)
    lon = float(lon_centre)
    if lon > 180 or lon < -180:
        raise ValueError("bad longitude %s" % lon)
    t = hh + mm / 60.0 + lon / 15.0
    shift = math.floor(t / 24.0)
    return acq_date + timedelta(days=shift), t - 24.0 * shift


def interval(h: float, q: float) -> tuple:
    """Band for the score |log(y+0.5) - log(H+0.5)| <= q: [max(0,(H+.5)e^-q-.5), (H+.5)e^q-.5]."""
    return max(0.0, (h + 0.5) * math.exp(-q) - 0.5), (h + 0.5) * math.exp(q) - 0.5


def window_union_share(curve: np.ndarray, hours: np.ndarray, windows: list) -> float:
    """F45: share of a diurnal curve inside the union of overpass windows on the 24 h circle (overlaps counted once)."""
    inside = np.zeros(len(hours), dtype=bool)
    for a, b in windows:
        a = a % 24.0
        b = b % 24.0
        if a <= b:
            inside |= (hours >= a) & (hours < b)
        else:
            inside |= (hours >= a) | (hours < b)
    return float(curve[inside].sum() / curve.sum())


def mk_var_ties(y) -> float:
    """Mann–Kendall Var(S) with the tie correction."""
    y = np.asarray(y, float)
    n = len(y)
    _, counts = np.unique(y, return_counts=True)
    return (n * (n - 1) * (2 * n + 5) - sum(t * (t - 1) * (2 * t + 5) for t in counts)) / 18.0


def mk_test(y, hamed_rao: bool = True) -> dict:
    """Mann–Kendall S, tie-corrected variance, optional Hamed–Rao autocorrelation correction, z and two-sided p."""
    from scipy import stats
    y = np.asarray(y, float)
    n = len(y)
    s = sum(np.sign(y[j] - y[i]) for i in range(n) for j in range(i + 1, n))
    var = mk_var_ties(y)
    factor = 1.0
    if hamed_rao and n > 3:
        slope = np.median([(y[j] - y[i]) / (j - i) for i in range(n) for j in range(i + 1, n)])
        r = stats.rankdata(y - slope * np.arange(n))
        r = r - r.mean()
        acc = 0.0
        for k in range(1, n - 1):
            rho = float(np.sum(r[:-k] * r[k:]) / np.sum(r * r))
            if abs(rho) > 1.96 / math.sqrt(n):
                acc += (n - k) * (n - k - 1) * (n - k - 2) * rho
        factor = 1 + 2 / (n * (n - 1) * (n - 2)) * acc
        var = var * max(factor, 1e-9)
    z = 0.0
    if s != 0:
        z = (s - np.sign(s)) / math.sqrt(var)
    return {"S": int(s), "var": float(var), "z": float(z), "p": float(2 * (1 - stats.norm.cdf(abs(z)))), "hamed_rao_factor": float(factor)}


def log_rate(count: float, exposure: float, eps: float = EPS_RATE) -> float:
    """log of the rate per 1,000 clear looks with eps added, so a zero count never gives -inf."""
    return math.log(1000.0 * count / exposure + eps)


def rate_or_withheld(count, exposure, floor: float = 30.0) -> dict:
    """Rate per 1,000 clear looks, or withheld with a reason. Never clipped."""
    if count is None or exposure is None:
        return {"state": "withheld", "value": None, "reason": "missing"}
    if exposure < floor:
        return {"state": "withheld", "value": None, "reason": "exposure below floor"}
    rate = 1000.0 * count / exposure
    if rate > RATE_MAX:
        return {"state": "withheld", "value": None, "reason": "impossible rate > 1000 per 1,000"}
    return {"state": "observed", "value": rate, "reason": ""}


def k_ratio(m, v) -> float:
    """Ratio of totals over usable rows, zeros kept: sum V / sum M."""
    m = np.asarray(m, float)
    v = np.asarray(v, float)
    keep = ~(np.isnan(m) | np.isnan(v))
    if m[keep].sum() <= 0:
        return float("nan")
    return float(v[keep].sum() / m[keep].sum())


def coverage_rate(detections: set, usable: set) -> float:
    """Detected cell-days over usable cell-days, both as unions of (cell, day) from the same rows."""
    det = set((c, d) for _, c, d in detections)
    use = set((c, d) for _, c, d in usable)
    if not use:
        return float("nan")
    return len(det & use) / len(use)


def block_bootstrap(a, v, boots: int = 1000, seed: int = 20261115) -> tuple:
    """95 % interval of sum V / sum A, resampling whole years (rows of the 2-D arrays)."""
    a = np.asarray(a, float)
    v = np.asarray(v, float)
    rng = np.random.default_rng(seed)
    n = a.shape[0]
    out = []
    for _ in range(boots):
        idx = rng.integers(0, n, n)
        out.append(v[idx].sum() / a[idx].sum())
    return float(np.percentile(out, 2.5)), float(np.percentile(out, 97.5))


def aoi_hash(aoi) -> str:
    """sha256 of the AOI definition (bbox list or GeoJSON dict), canonical JSON."""
    return "sha256:" + hashlib.sha256(json.dumps(aoi, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def same_aoi(a: dict, b: dict) -> None:
    """Refuse to compare two results built on different AOIs."""
    if a.get("aoi_hash") != b.get("aoi_hash"):
        raise AOIMismatch("results come from different AOIs: %s vs %s" % (a.get("aoi_hash"), b.get("aoi_hash")))
