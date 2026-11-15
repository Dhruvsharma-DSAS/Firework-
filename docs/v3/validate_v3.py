"""FIREWORK CHRONOS v3 - formula and estimator validation suite.
All inputs here are either tiny hand-made fixtures or SYNTHETIC simulations with a known answer.
Nothing here is a result about real fires. Run: python3 validate_v3.py  -> writes results_v3.json
"""
import json, math
import numpy as np
from decimal import Decimal, ROUND_FLOOR
from scipy import stats

R = {}
rng = np.random.default_rng(20261115)

# ---------- C1. Coverage arithmetic: union numerator vs max-platform exposure ----------
# Two usable days, Terra detects on day 1, Aqua on day 2. Exposure per platform = 1 usable cell-day each.
det = {("T", 1), ("A", 2)}
union_days = len({d for _, d in det})            # 2 cell-days with a detection
exp_max = max(1, 1)                               # archived rule: max of platform totals
exp_union = 2                                     # correct: union of usable cell-days
R["C1_coverage"] = {"archived_rate": union_days / exp_max, "correct_rate": union_days / exp_union}

# ---------- C2. Dropping observed zeros ----------
M = np.array([0, 2, 2, 2]); V = np.array([3, 4, 4, 4])
keep = M > 0
R["C2_zero_drop"] = {"k_drop_zeros": V[keep].sum() / M[keep].sum(), "k_keep_zeros": V.sum() / M.sum()}

# ---------- C3. Float floor grid bug at 0.1 deg ----------
def idx_float(x, origin, res=0.1):
    return math.floor((x - origin) / res)
def idx_decimal(x, origin, res="0.1"):
    return int(((Decimal(repr(x)) - Decimal(origin)) / Decimal(res)).to_integral_value(ROUND_FLOOR))
lat_edges = [round(-90 + 0.1 * i, 1) for i in range(1800)]
lon_edges = [round(-180 + 0.1 * i, 1) for i in range(3600)]
bad_lat = sum(idx_float(x, -90) != idx_decimal(x, "-90") for x in lat_edges)
bad_lon = sum(idx_float(x, -180) != idx_decimal(x, "-180") for x in lon_edges)
R["C3_grid"] = {"lat_edges_misassigned": bad_lat, "lat_edges": 1800,
                "lon_edges_misassigned": bad_lon, "lon_edges": 3600,
                "lon_180_col_float": idx_float(180.0, -180), "valid_max_col": 3599}

# ---------- C4. Interval inversion for score s = |log(y+0.5) - log(H+0.5)| ----------
q = math.log(1.6)
rows = []
for H in [0, 2, 10, 50, 500]:
    naive = (H * math.exp(-q), H * math.exp(q))
    right = (max(0.0, (H + 0.5) * math.exp(-q) - 0.5), (H + 0.5) * math.exp(q) - 0.5)
    rows.append({"H": H, "naive_lo": round(naive[0], 2), "naive_hi": round(naive[1], 2),
                 "correct_lo": round(right[0], 2), "correct_hi": round(right[1], 2)})
R["C4_interval"] = rows

# ---------- C5. F45 overlapping overpass windows on the 24 h circle ----------
hours = np.linspace(0, 24, 24 * 60, endpoint=False)
def burn_curve(peak, sd=1.5):
    d = np.minimum(np.abs(hours - peak), 24 - np.abs(hours - peak))
    w = np.exp(-0.5 * (d / sd) ** 2); return w / w.sum()
wins = [(13.0, 14.5), (13.5, 15.0), (10.0, 11.5)]     # two overlapping afternoon windows + morning
def mask(a, b): return (hours >= a) & (hours < b)
for peak in [13.5, 16.5]:
    c = burn_curve(peak)
    summed = sum(c[mask(a, b)].sum() for a, b in wins)
    union = c[np.any([mask(a, b) for a, b in wins], axis=0)].sum()
    R[f"C5_window_share_peak_{peak}"] = {"summed_windows": round(float(summed), 3), "union": round(float(union), 3)}

# ---------- C6. Mann-Kendall with ties ----------
y = np.array([5, 5, 6, 6, 6, 7, 7, 8, 8, 8, 9, 9], float)
n = len(y); S = sum(np.sign(y[j] - y[i]) for i in range(n) for j in range(i + 1, n))
var_no_ties = n * (n - 1) * (2 * n + 5) / 18
_, counts = np.unique(y, return_counts=True)
var_ties = (n * (n - 1) * (2 * n + 5) - sum(t * (t - 1) * (2 * t + 5) for t in counts)) / 18
def z(S, v): return (S - np.sign(S)) / math.sqrt(v)
R["C6_mann_kendall"] = {"S": int(S), "var_no_ties": var_no_ties, "var_ties": var_ties,
                        "z_no_ties": round(z(S, var_no_ties), 3), "z_ties": round(z(S, var_ties), 3)}

# ---------- S1. Paired-opportunity world: why cloud-aware pairing matters ----------
def simulate_world(n_cells=4000, n_days=60, p_fire=0.03, frp_mu=1.2, frp_sd=1.1,
                   cloud_A=0.25, cloud_V=0.25, cloud_corr=0.6, rho=0.6, seed=0):
    g = np.random.default_rng(seed)
    N = n_cells * n_days
    fire = g.random(N) < p_fire
    frp = np.where(fire, g.lognormal(frp_mu, frp_sd, N), 0.0)          # MW, latent
    # detection probability vs FRP: MODIS 50% at ~8 MW, VIIRS 375 m at ~2 MW (illustrative shapes)
    pA = 1 / (1 + np.exp(-(np.log(frp + 1e-9) - np.log(8.0)) * 2.2))
    pV = 1 / (1 + np.exp(-(np.log(frp + 1e-9) - np.log(2.0)) * 2.2))
    # correlated cloud: shared weather + sensor-specific component
    shared = g.random(N) < cloud_corr * min(cloud_A, cloud_V)
    cA = shared | (g.random(N) < (cloud_A - cloud_corr * min(cloud_A, cloud_V)))
    cV = shared | (g.random(N) < (cloud_V - cloud_corr * min(cloud_A, cloud_V)))
    # Gaussian copula: rho = how strongly the two sensors' 'luck' is shared on the same fire
    # (same flaming phase, same smoke). rho=0 independent, rho=1 identical.
    z = g.standard_normal(N)
    uA = stats.norm.cdf(rho * z + math.sqrt(1 - rho ** 2) * g.standard_normal(N))
    uV = stats.norm.cdf(rho * z + math.sqrt(1 - rho ** 2) * g.standard_normal(N))
    dA = fire & ~cA & (uA < pA)
    dV = fire & ~cV & (uV < pV)
    return dict(fire=fire, frp=frp, cA=cA, cV=cV, dA=dA, dV=dV, pA=pA, pV=pV, N=N)

def table(w):
    both_usable = ~w["cA"] & ~w["cV"]
    a, v = w["dA"] & both_usable, w["dV"] & both_usable
    return dict(N11=int((a & v).sum()), N10=int((a & ~v).sum()), N01=int((~a & v).sum()),
                N00=int((both_usable & ~a & ~v).sum()), E=int(both_usable.sum()))

w = simulate_world(seed=1)
t = table(w)
# true ratio of detection rates on the same fires (cloud-free) = E[pV]/E[pA] over fires
true_k = w["pV"][w["fire"]].mean() / w["pA"][w["fire"]].mean()
k_paired = (t["N11"] + t["N01"]) / (t["N11"] + t["N10"])
# naive raw-count ratio when VIIRS is cloudier (e.g. different look geometry/season mix)
w2 = simulate_world(seed=2, cloud_A=0.15, cloud_V=0.40)
t2 = table(w2)
k_raw = w2["dV"].sum() / w2["dA"].sum()
k_paired2 = (t2["N11"] + t2["N01"]) / (t2["N11"] + t2["N10"])
true_k2 = w2["pV"][w2["fire"]].mean() / w2["pA"][w2["fire"]].mean()
R["S1_pairing"] = {"table": t, "true_k": round(true_k, 3), "k_paired": round(k_paired, 3),
                   "unequal_cloud_world": {"true_k": round(true_k2, 3), "k_raw_counts": round(k_raw, 3),
                                           "k_paired": round(k_paired2, 3), "table": t2}}

# ---------- S2. Dual-system (Chapman) estimate of detectable fire-windows ----------
def chapman(t):
    nA, nV, m = t["N11"] + t["N10"], t["N11"] + t["N01"], t["N11"]
    Nh = (nA + 1) * (nV + 1) / (m + 1) - 1
    var = (nA + 1) * (nV + 1) * (nA - m) * (nV - m) / ((m + 1) ** 2 * (m + 2))
    return Nh, math.sqrt(var)
both_usable = ~w["cA"] & ~w["cV"]
true_fire_windows = int((w["fire"] & both_usable).sum())
true_detectable_any = int(((w["dA"] | w["dV"]) & both_usable).sum())
Nh, se = chapman(t)
# heterogeneity check: stratify by a true FRP proxy (only possible in simulation) to show direction of bias
strata = np.digitize(w["frp"], [0.5, 2, 8, 30])
Nh_strat = 0.0
for s in np.unique(strata[w["fire"]]):
    sel = both_usable & (strata == s) & w["fire"]
    a, v = w["dA"] & sel, w["dV"] & sel
    ts = dict(N11=int((a & v).sum()), N10=int((a & ~v).sum()), N01=int((~a & v).sum()))
    if ts["N11"] + ts["N10"] + ts["N01"] > 0:
        Nh_strat += chapman(ts)[0]
R["S2_dual_system"] = {"true_fire_windows": true_fire_windows, "seen_by_either": true_detectable_any,
                       "chapman_pooled": round(Nh), "chapman_se": round(se, 1),
                       "chapman_frp_stratified_oracle": round(Nh_strat),
                       "pooled_as_share_of_truth": round(Nh / true_fire_windows, 3)}

# independent-detection control: same world but separate uniforms -> Chapman should be ~unbiased
g = np.random.default_rng(9); Nn = 200000
fire = g.random(Nn) < 0.05
dA = fire & (g.random(Nn) < 0.35); dV = fire & (g.random(Nn) < 0.70)
ti = dict(N11=int((dA & dV).sum()), N10=int((dA & ~dV).sum()), N01=int((~dA & dV).sum()))
R["S2_independent_control"] = {"truth": int(fire.sum()), "chapman": round(chapman(ti)[0])}

# ---------- S3. Transport: a fixed k breaks when the fire-size mix shifts ----------
rows = []
k_train = None
for yr, mu in [(2013, 1.2), (2014, 1.2), (2015, 1.2), (2016, 1.2), (2023, 0.6), (2025, 0.3)]:
    wy = simulate_world(seed=yr, frp_mu=mu)
    ty = table(wy)
    nA, nV = ty["N11"] + ty["N10"], ty["N11"] + ty["N01"]
    rows.append({"year": yr, "frp_logmean": mu, "n_A": nA, "n_V": nV, "k_year": round(nV / nA, 3)})
k_train = sum(r["n_V"] for r in rows[:4]) / sum(r["n_A"] for r in rows[:4])
for r in rows:
    r["pred_V_from_A"] = round(r["n_A"] * k_train)
    r["rel_err"] = round((r["pred_V_from_A"] - r["n_V"]) / r["n_V"], 3)
R["S3_transport"] = {"k_train_2013_2016": round(k_train, 3), "rows": rows}

# ---------- S4. Drift probe: difference-in-differences on Aqua vs VIIRS timing ----------
def detect_share(peak, t_look, width=0.75, sd=1.4):
    c = burn_curve(peak, sd)
    d = np.minimum(np.abs(hours - t_look), 24 - np.abs(hours - t_look))
    return float(c[d <= width / 2].sum())        # share of daily activity burning at look time
years = list(range(2016, 2027))
aqua_t = {yv: 13.6 if yv <= 2021 else 13.6 + (yv - 2021) * 0.38 for yv in years}   # ~15.5 h by 2026
peak_treat = {yv: 13.5 if yv <= 2021 else min(16.5, 13.5 + (yv - 2021) * 0.75) for yv in years}
rows = []
for yv in years:
    rt = detect_share(peak_treat[yv], aqua_t[yv]) / detect_share(peak_treat[yv], 13.5)
    rc = detect_share(13.5, aqua_t[yv]) / detect_share(13.5, 13.5)
    rows.append({"year": yv, "aqua_h": round(aqua_t[yv], 2), "treat_peak_h": peak_treat[yv],
                 "logR_treat": round(math.log(rt), 3), "logR_control": round(math.log(rc), 3),
                 "DiD": round(math.log(rt) - math.log(rc), 3)})
R["S4_drift_probe"] = rows

# ---------- S5. Block bootstrap vs naive iid for paired ratio with year shocks ----------
yrs = 10; per = 400
shock = rng.lognormal(0, 0.35, yrs)
A = rng.poisson(20 * shock[:, None], (yrs, per)); Vv = rng.poisson(50 * shock[:, None] * rng.lognormal(0, 0.1, (yrs, 1)), (yrs, per))
def ratio(a, v): return v.sum() / a.sum()
iid = [ratio(*(lambda idx: (A.ravel()[idx], Vv.ravel()[idx]))(rng.integers(0, A.size, A.size))) for _ in range(1000)]
blk = [ratio(A[idx], Vv[idx]) for idx in (rng.integers(0, yrs, yrs) for _ in range(1000))]
R["S5_bootstrap"] = {"k_hat": round(ratio(A, Vv), 3),
                     "iid_95": [round(np.percentile(iid, 2.5), 3), round(np.percentile(iid, 97.5), 3)],
                     "year_block_95": [round(np.percentile(blk, 2.5), 3), round(np.percentile(blk, 97.5), 3)]}

with open("results_v3.json", "w") as f:
    json.dump(R, f, indent=2, default=int)
print(json.dumps(R, indent=1, default=int))
