import { GuideCue } from "../components/PageGuide.jsx";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Badge from "../components/Badge.jsx";
import { loadModelCards } from "../api/data.js";
import "../styles/pagedoc.css";
import "../styles/validation.css";

const GATES = {
  G1: ["Held-out years", "Hide one year, learn the exchange rate from the others, and predict the hidden year’s VIIRS activity from MODIS.", "Leave-one-year-out over 2012–2025", "median relative error ≤ 15% and better than B1"],
  G2: ["Held-out geography", "Learn in one region and test in another — does the method travel?", "Train one region, test another", "error ≤ 1.5 × in-region error"],
  G3: ["The 2012 seam", "VIIRS joined in 2012. Without harmonisation the record jumps that year; after it, the jump should be mostly gone.", "3-year windows either side, log scale, bootstrap CI", "seam ratio upper CI ≤ 0.25"],
  G4: ["Placebo seams", "Run the same break test at 20 random years with no sensor change. It should rarely find a break.", "Pettitt / PELT at 20 random years", "false-positive rate ≤ 10%"],
  G5: ["Platform seams", "NOAA-20 (2018) and NOAA-21 (2023) were added. No new step should appear in the harmonised record.", "Break test at 2018 and 2023", "no break after harmonisation (α = 0.05)"],
  G6: ["Band coverage", "A 95% band should contain the true value about 95% of the time on data it has not seen.", "95% predictive bands, held-out seasons", "achieved coverage 88–99%"],
  G7: ["Agreement", "Harmonised MODIS and VIIRS should not differ systematically in the overlap years.", "Bland–Altman on log scale", "|bias| ≤ 0.1"],
  G8: ["Zero and empty", "Empty months, regions with no clear view, or a single region must give a status — never a made-up 0.", "Empty months, E = 0, one region", "no crash; a status, never 0"],
  G9: ["Negatives", "Open water and city centres should show essentially no vegetation fire.", "Water and urban cells", "≈ 0, with status"],
  G10: ["Persistent heat", "Gas flares and kilns burn all year. They must be kept out of the calibration.", "Known flares and kilns", "excluded from calibration"],
  G11: ["Source classifier", "The crop / wildland / industrial labels must be tested on sites the model never saw, and report how often it abstains.", "Held-out sites (GroupKFold)", "macro-F1 and abstain rate reported"],
  G12: ["API provenance", "Every answer from the API must say where its data came from, its status and its version.", "Every response", "meta.data_source, status and version present"],
};

const STATE_LABEL = { passed: "Passed", partial: "Partial", failed: "Failed", not_tested: "Not tested", inconclusive: "Inconclusive", simulated: "Simulated" };

function gateOf(v3, id) {
  if (!v3) {
    return null;
  }
  const found = v3.gates.find((g) => g.id === id);
  if (!found) {
    return null;
  }
  return found;
}

function stateOf(v3, id) {
  const g = gateOf(v3, id);
  if (!g) {
    return "not_tested";
  }
  return g.state;
}

function clauseNote(v3, id, n) {
  const g = gateOf(v3, id);
  if (!g || !g.clauses[n]) {
    return "";
  }
  const c = g.clauses[n];
  const CLAUSE = { pass: "Passed", fail: "Failed", pending: "Pending" };
  let text = CLAUSE[c.state] || c.state;
  text = text + " — " + c.rule;
  if (c.note) {
    text = text + " (" + c.note + ")";
  }
  return text;
}

const ORDER = ["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12"];

function num(v, digits) {
  if (v === null || v === undefined) {
    return "—";
  }
  return Number(v).toFixed(digits);
}

function cardSummary(card) {
  let metric = "—";
  let baseline = "—";
  let beats = "—";
  if (card.model_test) {
    metric = "F1 " + num(card.model_test.f1, 3) + " · PR-AUC " + num(card.model_test.pr_auc, 3);
    baseline = "rule F1 " + num(card.baseline_rule_test.f1, 3);
    if (card.model_test.f1 > card.baseline_rule_test.f1 && card.model_test.f1 >= 0.5) {
      beats = "Beats baseline";
    } else if (card.model_test.f1 > card.baseline_rule_test.f1) {
      beats = "Beats rule but F1 < 0.5 — hidden";
    } else {
      beats = "Baseline kept";
    }
  } else if (card.cell_month_test) {
    const c = card.cell_month_test;
    metric = "MAE " + num(c.mae_model, 3) + " · band coverage " + num(100 * c.interval_coverage, 1) + "%";
    baseline = "constant k, MAE " + num(c.mae_constant_k, 3);
    if (c.mae_model < c.mae_constant_k) {
      beats = "Beats baseline";
    } else {
      beats = "Baseline kept";
    }
  } else if (card.folds) {
    const skills = card.folds.map((f) => f.skill_vs_climatology).filter((v) => v !== null && v !== undefined);
    metric = "skill vs climatology " + skills.map((v) => num(v, 2)).join(" · ");
    baseline = "climatology";
    if (skills.length > 0 && skills.every((v) => v > 0)) {
      beats = "Beats baseline every fold";
    } else {
      beats = "Baseline kept";
    }
  }
  return [metric, baseline, beats];
}

function Gauge(props) {
  const at = Math.min(100, (100 * props.value) / props.max);
  const limit = (100 * props.limit) / props.max;
  return (
    <div className="va-gauge" role="img" aria-label={props.label}>
      <div className="va-gauge-track">
        <i className="va-gauge-ok" style={{ width: limit + "%" }} />
        <i className="va-gauge-limit" style={{ left: limit + "%" }} />
        <i className="va-gauge-val" style={{ left: at + "%" }} />
      </div>
      <div className="va-gauge-scale">
        <span>0</span>
        <span style={{ left: limit + "%" }}>{props.limitText}</span>
        <span className="end">{props.maxText}</span>
      </div>
    </div>
  );
}

function spot(event) {
  const box = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty("--mx", (event.clientX - box.left) + "px");
  event.currentTarget.style.setProperty("--my", (event.clientY - box.top) + "px");
}

function Arrow(props) {
  if (props.down) {
    return <svg className="va-arrow down" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 4v13M6 12l6 6 6-6M5 21h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  }
  return <svg className="va-arrow" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function MlCard(props) {
  const m = props.m;
  let cls = "va-test";
  if (m.ready) {
    cls = "va-test pass";
  }
  const lost = m.leave_one_year_out.filter((r) => !r.model_wins).map((r) => r.year + " (" + (100 * (r.mae_model / r.mae_k - 1)).toFixed(1) + " % worse)");
  return (
    <article className={cls}>
      <span className="va-guard-k">ML · Harmoniser v2 · {m.verdict}</span>
      <b>Beat k in {m.years_won} of 14 held-out years and on {m.continents_won} of {m.leave_one_continent_out.length} held-out continents</b>
      <p>A correction to k learned from latitude, season, night share, Terra share and fire power ({m.rows.toLocaleString()} region-months, 2012–2025). The rule is to win every year; it lost {lost.join(", ")}, so the calendar keeps using k.</p>
    </article>
  );
}

function Advanced(props) {
  const a = props.a;
  const t1 = a.tests[0];
  const t2 = a.tests[1];
  const maxImp = Math.max.apply(null, a.why_k.importance.map((x) => x.mean_abs_ln));
  let t2Body = <p>Waiting for an Earth Engine run. Yearly harmonised fire counts will be compared with NASA's MCD64A1 burned-area maps, a different product made by a different algorithm.</p>;
  let t2Head = <b>Pending · not run yet</b>;
  if (t2.status === "done") {
    t2Head = <b>median ρ = {t2.median_rho} over {t2.countries} countries</b>;
    t2Body = <p>{t2.rule}. {Math.round(100 * t2.share_positive)} % of countries move in the same direction as burned area.</p>;
  }
  let t1Cls = "va-test";
  let t1Word = "Not passed";
  if (t1.pass) {
    t1Cls = "va-test pass";
    t1Word = "Passed";
  }
  return (
    <div className="va-adv">
      <h3 className="va-h3">Deeper checks · added 9 Nov 2026, after the gates above</h3>
      <div className="va-guards">
        <article className="va-guard va-spot" onMouseMove={spot}>
          <span className="va-guard-k">05 · Distance from tested data</span>
          <b>{a.coverage_distance.zones.core.toLocaleString()} core · {a.coverage_distance.zones.edge.toLocaleString()} edge · {a.coverage_distance.zones.outside.toLocaleString()} outside</b>
          <p>Every region × month is placed among the {a.coverage_distance.reference} best-tested ones, using latitude, season, amount of fire and how peaked the season is. Past the 95th percentile of normal spacing it is marked <b>outside</b>, and the calendar says so.</p>
        </article>
        <article className="va-guard va-spot" onMouseMove={spot}>
          <span className="va-guard-k">06 · Why is k what it is?</span>
          <b>Exact Shapley values for every month</b>
          <div className="va-imp">
            {a.why_k.importance.map((x) => (
              <div key={x.f}><span>{x.label}</span><i style={{ width: (100 * x.mean_abs_ln / maxImp) + "%" }} /></div>
            ))}
          </div>
          <p>A small model of k, checked on regions it never saw (error {a.why_k.median_abs_ln_error} vs {a.why_k.median_abs_ln_error_constant} for one global k, on a log scale). It explains k; the calendar still uses each region's measured k.</p>
        </article>
        <article className={t1Cls}>
          <span className="va-guard-k">T1 · Transfer to a new continent and year · {t1Word}</span>
          <b>×{t1.typical_factor.model} typical error vs ×{t1.typical_factor.global_k} for one global k</b>
          <p>One continent and one year are hidden at a time ({t1.n.toLocaleString()} held-out months). k predicted from the other continents beats a single global k on {t1.continents_won} of 6 continents. A region's own k does better still (×{t1.typical_factor.own_k}), which is why the calendar uses it.</p>
        </article>
        {props.ml && <MlCard m={props.ml} />}
        <article className="va-test">
          <span className="va-guard-k">T2 · Agreement with burned area</span>
          {t2Head}
          {t2Body}
        </article>
      </div>
    </div>
  );
}

export default function Validation() {
  const navigate = useNavigate();
  const [card, setCard] = useState(null);
  const [ml, setMl] = useState(null);
  const [v3, setV3] = useState(null);
  const [cards, setCards] = useState(null);
  const [cardsState, setCardsState] = useState("loading");

  useEffect(() => {
    fetch("/data/method_card.json").then((r) => r.json()).then((j) => setCard(j)).catch(() => setCard(null));
    fetch("/data/validation_v3.json").then((r) => r.json()).then((j) => setV3(j)).catch(() => setV3(null));
    fetch("/data/model_card_harmoniser_v2.json").then((r) => r.json()).then((j) => setMl(j)).catch(() => setMl(null));
  }, []);

  useEffect(() => {
    document.title = "Validation · FIREWORK CHRONOS";
    loadModelCards()
      .then((r) => {
        setCards(r.data || []);
        setCardsState("ok");
      })
      .catch(() => setCardsState("offline"));
  }, []);

  let registry = <p className="va-registry">Checking the live model registry…</p>;
  if (cardsState === "offline") {
    registry = <p className="va-registry"><i className="va-dot off" />The live model registry is offline right now, so the results above are the ones recorded from notebook 03. Nothing else is shown in their place.</p>;
  } else if (cardsState === "ok" && cards.length === 0) {
    registry = <p className="va-registry"><i className="va-dot" />The backend registry has no trained model yet; the results above come from notebook 03.</p>;
  } else if (cardsState === "ok") {
    registry = (
      <div className="va-registry-table">
        <h3 className="va-proto-h">Earlier prototypes in the backend registry</h3>
        <p className="va-registry"><i className="va-dot on" />These were trained on the regional pipeline at the level of 0.1° cells, a different and smaller test than notebook 03’s region-month models above. They are listed for transparency; the site follows the whole-Earth result above.</p>
        <div className="pd-table-wrap">
          <table className="pd-table">
            <thead><tr><th>Model</th><th>Trained</th><th>Held-out result</th><th>Baseline</th><th>Verdict on its own test</th><th>Provenance</th></tr></thead>
            <tbody>
              {cards.map((card) => {
                const s = cardSummary(card);
                return (
                  <tr key={card.model + card.version}>
                    <td><code>{card.model} v{card.version}</code></td>
                    <td>{String(card.trained_at_utc || "").slice(0, 10)}</td>
                    <td>{s[0]}</td>
                    <td>{s[1]}</td>
                    <td>{s[2]}</td>
                    <td><Badge kind={card.provenance} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  let counts = { passed: 0, partial: 0, failed: 0, not_tested: 12 };
  let g1v = null;
  let g3v = null;
  let g3n = null;
  let g6v = null;
  let g6n = "—";
  if (v3) {
    counts = v3.counts;
    g1v = gateOf(v3, "G1").clauses[0].value;
    g3v = gateOf(v3, "G3").clauses[0].value;
    g3n = gateOf(v3, "G3").clauses[0].n;
    g6v = gateOf(v3, "G6").clauses[0].value;
    g6n = gateOf(v3, "G6").clauses[0].n.toLocaleString();
  }
  let g1Text = "—";
  let g3Text = "—";
  let g6Text = "—";
  if (g1v !== null) {
    g1Text = (100 * g1v).toFixed(1) + "%";
  }
  if (g3v !== null) {
    g3Text = g3v.toFixed(2);
  }
  if (g6v !== null) {
    g6Text = (100 * g6v).toFixed(2) + "%";
  }

  return (
    <div className="pd va">
      <header className="pd-head ph" style={{ "--ph": "var(--good)" }}>
        <div>
          <div className="eyebrow">Trust · Validation</div>
          <h1 className="ph-title">Validation <em>gates</em></h1>
          <p className="ph-q">How far can each result be trusted?</p>
          <GuideCue selector=".pd-sec" />
          <p className="pd-lead">Twelve tests — gates G1 to G12 — were written down on 27 October 2026, before any real-data run, with the score each must reach. Each gate shows Passed, Partial, Failed or Not tested, worked out rule by rule from the run results.</p>
        </div>
      </header>

      <section className="va-board" aria-label="Gate status overview">
        <div className="va-board-text">
          <b><em>{counts.passed}</em> of 12 gates passed</b>
          <span>on real NASA FIRMS data · {counts.partial} partial · {counts.failed} failed · {counts.not_tested} not tested yet</span>
        </div>
        <ol className="va-strip">
          {ORDER.map((g, i) => {
            const st = stateOf(v3, g);
            let cls = "va-cell " + st;
            if (st === "passed") {
              cls = "va-cell pass";
            }
            const state = STATE_LABEL[st];
            return (
              <li key={g} className={cls} style={{ animationDelay: i * 40 + "ms" }} title={g + " · " + GATES[g][0] + " · " + state}>
                <b>{g}</b>
                <span>{GATES[g][0]}</span>
              </li>
            );
          })}
        </ol>
        <div className="va-key"><span><i className="va-dot on" />Passed</span><span><i className="va-dot partial" />Partial</span><span><i className="va-dot failed" />Failed</span><span><i className="va-dot" />Not tested</span></div>
      </section>

      <section className="va-paper va-spot" aria-label="Research paper" onMouseMove={spot}>
        <div className="va-paper-doc" aria-hidden="true"><i /><i /><i /><i /><b>PDF</b></div>
        <div className="va-paper-text">
          <span className="va-paper-tag">Research paper</span>
          <h2>FIREWORK CHRONOS — the full method, tests and results</h2>
          <p>The written paper behind this page: how MODIS and VIIRS are put on one scale, the twelve gates, the trust layer and every number they produced.</p>
        </div>
        <div className="va-paper-acts">
          <a className="va-paper-btn" href="https://drive.google.com/file/d/1dFap59BAyAP0a3Xy0kIKipTwWrvRsctm/view?usp=drive_link" target="_blank" rel="noreferrer">Read paper<Arrow /></a>
          <a className="va-paper-btn ghost" href="https://drive.google.com/uc?export=download&id=1dFap59BAyAP0a3Xy0kIKipTwWrvRsctm" target="_blank" rel="noreferrer">Download PDF<Arrow down={true} /></a>
        </div>
      </section>

      <section className="pd-sec">
        <div className="pd-margin"><b>Results</b><span>Notebook 02 · real data</span></div>
        <div className="pd-col">
          <h2>Results on the 2000–2025 archive</h2>
          <p>Both were computed in Google Colab on the whole-Earth calendar: every MODIS and VIIRS S-NPP fire pixel from the NASA FIRMS standard archive, binned into cell-days, with 2012–2025 as the overlap years.</p>

          <div className="va-results">
            <article className="va-result">
              <div className="va-result-top">
                <span className="va-gate">G1 · Held-out years</span>
                <span className={"va-pass " + stateOf(v3, "G1")}>{STATE_LABEL[stateOf(v3, "G1")]}</span>
              </div>
              <div className="va-figure"><b>{g1Text}</b><span>median error</span></div>
              <p>Each year from 2012 to 2025 was hidden in turn. The exchange rate learned from the other years turned that year’s MODIS cell-days into a VIIRS estimate. Across regions with at least 100 VIIRS cell-days, the typical miss was <b>{g1Text}</b>.</p>
              {g1v !== null && <Gauge value={g1v} limit={0.15} max={0.3} limitText="15% limit" maxText="30%" label={"Median error " + g1Text + " against a 15 percent limit"} />}
              <p className="va-fine">Pass rule: median relative error ≤ 15% and better than baseline B1. {clauseNote(v3, "G1", 1)}.</p>
            </article>

            <article className="va-result">
              <div className="va-result-top">
                <span className="va-gate">G3 · The 2012 seam</span>
                <span className={"va-pass " + stateOf(v3, "G3")}>{STATE_LABEL[stateOf(v3, "G3")]}</span>
              </div>
              <div className="va-figure"><b>{g3Text}</b><span>median seam ratio · {g3n && g3n.toLocaleString()} regions</span></div>
              <p>For each region, the step between 2009–2011 (MODIS only) and 2012–2014 (VIIRS) was measured before and after harmonisation. A ratio of <b>{g3Text}</b> means about <b>four-fifths of the 2012 step is removed</b>; the step is mainly instrumental; 0 would be perfect, 1 would mean no change.</p>
              {g3v !== null && <Gauge value={g3v} limit={0.25} max={0.5} limitText="0.25 limit" maxText="0.5" label={"Median seam ratio " + g3Text + " against a 0.25 limit"} />}
              <p className="va-fine">Pass rule: seam ratio upper bound ≤ 0.25. {clauseNote(v3, "G3", 1)}.</p>
            </article>
          </div>
          <article className="va-result va-wide">
            <div className="va-result-top">
              <span className="va-gate">G6 · Band coverage</span>
              <span className={"va-pass " + stateOf(v3, "G6")}>{STATE_LABEL[stateOf(v3, "G6")]}</span>
            </div>
            <div className="va-figure"><b>{g6Text}</b><span>of {g6n} aggregate checks, pooled, MODIS ≥ 10 — not a per-month guarantee · pass range 88–99 %</span></div>
            <p>Every harmonised MODIS month now carries a <b>conformal interval</b>: a range that should contain what VIIRS would have counted 95 % of the time. Each year from 2012 to 2025 was checked against its interval, and we counted how often what VIIRS counted fell inside. {clauseNote(v3, "G6", 1)}. Small months get wide intervals, busy months narrow ones — and each size class keeps its promise:</p>
            {card && (
              <table className="va-table">
                <thead><tr><th>MODIS cell-days in the month</th><th>Interval</th><th>Held, pooled</th><th>Checks</th></tr></thead>
                <tbody>
                  {card.conformal.results.classes.map((c) => {
                    let range = c.from + "+";
                    if (c.to) {
                      range = c.from + "–" + c.to;
                    }
                    return <tr key={c.from}><td>{range}</td><td>×÷ {c.factor95}</td><td>{(100 * c.achieved95).toFixed(1)} %</td><td>{c.n.toLocaleString()}</td></tr>;
                  })}
                </tbody>
              </table>
            )}
            <p className="va-fine">Method: Mondrian split conformal on leave-one-year-out log-ratio scores, one quantile per size class, pooled over 237 regions (formula F39). Computed by tools/trust/build_trust.py on the archive calendar.</p>
          </article>
          <div className="va-prov"><Badge kind="RUN_TESTED_LOCALLY" text="Run on real data · Colab notebook 02 + trust build" /><button type="button" className="pd-link" onClick={() => navigate("/formulas")}>See the formulas behind k and the seam ratio</button></div>
        </div>
      </section>

      {card && (
        <section className="pd-sec">
          <div className="pd-margin"><b>Trust layer</b><span>Every region · every month</span></div>
          <div className="pd-col">
            <h2>Four automatic guards on every number</h2>
            <p>Before a harmonised value reaches the calendar it passes four guards. They run on all 237 regions each time the calendar is rebuilt, and the results are written to one method card you can download.</p>
            <div className="va-guards">
              <article className="va-guard va-spot" onMouseMove={spot}>
                <span className="va-guard-k">01 · Coverage gate</span>
                <b>{card.coverage_gate.counts.high.toLocaleString()} high · {card.coverage_gate.counts.medium.toLocaleString()} medium · {card.coverage_gate.counts.low.toLocaleString()} low</b>
                <p>Each region × month gets a rating from its overlap years, its fire evidence and the width of its k band. <b>Low means k is withheld</b>: the calendar shows no harmonised value rather than a guess.</p>
                <div className="va-covbar">
                  <i className="h" style={{ flex: card.coverage_gate.counts.high }} />
                  <i className="m" style={{ flex: card.coverage_gate.counts.medium }} />
                  <i className="l" style={{ flex: card.coverage_gate.counts.low }} />
                </div>
              </article>
              <article className="va-guard va-spot" onMouseMove={spot}>
                <span className="va-guard-k">02 · Conformal interval</span>
                <b>{(100 * card.conformal.results.achieved_on_unseen_years["95"]).toFixed(1)} % held at 95 %</b>
                <p>A range on every harmonised month, narrower when there are more fires. Coverage is pooled over all checks, not a per-month guarantee (gate G6 above).</p>
                <div className="va-meter" aria-hidden="true">
                  <i style={{ width: (100 * card.conformal.results.achieved_on_unseen_years["95"]) + "%" }} />
                  <em style={{ left: "95%" }} />
                </div>
                <span className="va-meter-k">pooled coverage · the mark is the 95 % target</span>
              </article>
              <article className="va-guard va-spot" onMouseMove={spot}>
                <span className="va-guard-k">03 · Physics and sanity checks</span>
                <b>{["P1", "P2", "P3", "P4"].map((id) => id + " " + card.physics_checks[id].pass + "/" + card.physics_checks[id].of).join(" · ")}</b>
                <p>P1 no negatives and no 0 for a missing month · P2 k inside its own band · P3 more fires give a tighter band · P4 the 2012 seam is gone in that region (ratio ≤ 0.25). Regions that fail are flagged on their calendar, not hidden.</p>
              </article>
              <article className="va-guard va-spot" onMouseMove={spot}>
                <span className="va-guard-k">04 · Similar past seasons</span>
                <b>3 analog years for every season</b>
                <p>Click any month on the calendar to see the years whose whole season looked most alike, so an unusual month is backed by real past cases.</p>
                <button type="button" className="va-go" onClick={() => navigate("/calendar")}>Open the calendar<Arrow /></button>
              </article>
            </div>
            {card.advanced && <Advanced a={card.advanced} ml={ml} />}
            <h3 className="va-h3">Data registry · SHA-256 of every input</h3>
            <table className="va-table">
              <thead><tr><th>File</th><th>SHA-256</th><th>Size</th></tr></thead>
              <tbody>
                {card.inputs.map((f) => <tr key={f.file}><td>{f.file}</td><td className="va-hash">{f.sha256.slice(0, 16)}…</td><td>{(f.bytes / 1048576).toFixed(2)} MB</td></tr>)}
              </tbody>
            </table>
            <p className="va-fine">A test in the backend recomputes these hashes; if any input changes without a rebuild, the test fails. Model choice follows the simplest-model rule: {card.model_choice}</p>
            <div className="va-dl">
              <a className="pd-btn" href="/data/method_card.json" download="FIREWORK_method_card.json">Download the method card (JSON)</a>
              <a className="pd-btn" href="/data/registry.json" download="FIREWORK_data_registry.json">Download the data registry</a>
            </div>
          </div>
        </section>
      )}

      <section className="pd-sec">
        <div className="pd-margin"><b>Models</b><span>Notebook 03 · real data</span></div>
        <div className="pd-col">
          <h2>Two models trained — neither replaced the simple method</h2>
          <p>A model is marked <b>ready</b> only if it beats its simple baseline in every held-out year. Neither did, so the site keeps using the baselines. That is the gates doing their job, not a failure to hide.</p>
          <div className="va-models">
            <article className="va-model">
              <div className="va-result-top">
                <span className="va-gate">Harmoniser</span>
                <span className="va-notready">Not ready</span>
              </div>
              <p>Gradient-boosted trees predicting VIIRS cell-days from MODIS, month and region, tested leave-one-year-out.</p>
              <div className="va-kept"><span>Kept instead</span><b>Exchange rate k</b><small>VIIRS ÷ MODIS per region and month, with a 95% band</small></div>
            </article>
            <article className="va-model">
              <div className="va-result-top">
                <span className="va-gate">Outlook</span>
                <span className="va-notready">Not ready</span>
              </div>
              <p>Forecast of next month’s harmonised cell-days from the last month and the same month a year ago.</p>
              <div className="va-kept"><span>Kept instead</span><b>Climatology</b><small>the same-month median of past years</small></div>
            </article>
          </div>
          {registry}
        </div>
      </section>

      <section className="pd-sec">
        <div className="pd-margin"><b>Method test</b><span>Simulated, not real</span></div>
        <div className="pd-col">
          <div className="pd-aside amber va-sim">
            <p>In 60 simulated worlds with a known truth, exposure normalisation (B2) gave most of the gain over raw counts, and the B3 95% predictive band covered 94.5% of held-out seasons.</p>
            <p>This shows the method can work when its assumptions hold. It says nothing about real-world accuracy — that is what the gates above are for.</p>
            <Badge kind="SIMULATED_DEMO" text="Simulated test · V2 research atlas" />
          </div>
        </div>
      </section>
    </div>
  );
}
