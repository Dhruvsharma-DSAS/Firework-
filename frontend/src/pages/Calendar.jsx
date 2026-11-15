import PageGuide, { GuideCue } from "../components/PageGuide.jsx";
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import CalendarHeatmap, { rampColor } from "../components/CalendarHeatmap.jsx";
import StatusChip from "../components/StatusChip.jsx";
import Badge from "../components/Badge.jsx";
import { loadCalendar, loadCalendarRegions } from "../api/data.js";
import { statusOf } from "../api/client.js";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const REGIONS = [["world", "Whole Earth"], ["punjab_haryana", "Punjab + Haryana"]];
const STATUS_TEXT = { ok: "complete month", partial: "partial month (fewer product days)", nrt: "includes near-real-time days", none: "no fire detected · archive processed" };

function statusText(data, fam, yi, mi) {
  const grid = data["status_" + fam];
  if (!grid) {
    return null;
  }
  const s = grid[yi][mi];
  if (!s) {
    return null;
  }
  const now = new Date();
  if (data.years[yi] === now.getUTCFullYear() && mi === now.getUTCMonth()) {
    return "MONTH TO DATE · " + STATUS_TEXT[s];
  }
  return STATUS_TEXT[s];
}

function kFor(data, mi) {
  if (data.k_baseline) {
    const entry = data.k_baseline[String(mi + 1)];
    if (entry) {
      return entry;
    }
    return null;
  }
  if (data.k_demo) {
    return { k: data.k_demo, lo: null, hi: null, demo: true };
  }
  return null;
}

const ZONE_LABEL = { core: "Inside tested data", edge: "Edge of tested data", outside: "Outside tested data" };

function WhyK(props) {
  const w = props.w;
  const max = Math.max.apply(null, w.parts.map((p) => Math.abs(p.ln)).concat([0.01]));
  return (
    <div className="cal-why">
      <div className="caps">Why k is {w.k_model.toFixed(2)} here (model)</div>
      <p className="hint-mono">Starts from a typical k of {w.base.toFixed(2)}. Each bar shows how much one input pushes it up or down.</p>
      {w.parts.map((p) => {
        let cls = "up";
        let sign = "×";
        if (p.ln < 0) {
          cls = "down";
          sign = "÷";
        }
        return (
          <div className="cal-why-row" key={p.f}>
            <span>{p.label}</span>
            <em><i className={cls} style={{ width: (50 * Math.abs(p.ln) / max) + "%" }} /></em>
            <b>{sign}{Math.exp(Math.abs(p.ln)).toFixed(2)}</b>
          </div>
        );
      })}
    </div>
  );
}

function coverageFor(data, mi) {
  if (data.trust && data.trust.coverage && data.trust.coverage[mi]) {
    return data.trust.coverage[mi];
  }
  return null;
}

const COVER_LABEL = { high: "High", medium: "Medium", low: "Low · k withheld" };

function hasExposure(data) {
  let found = false;
  data.exposure_modis.forEach((row) => row.forEach((v) => {
    if (v !== null && v !== undefined) {
      found = true;
    }
  }));
  return found;
}

function cellValue(data, yi, mi, mode, metric) {
  const year = data.years[yi];
  const m = data.modis[yi][mi];
  const v = data.viirs[yi][mi];
  const em = data.exposure_modis[yi][mi];
  const ev = data.exposure_viirs[yi][mi];
  let count = m;
  let exposure = em;
  if (mode === "harmonised") {
    if (year >= 2012) {
      count = v;
      exposure = ev;
    } else {
      const k = kFor(data, mi);
      const cov = coverageFor(data, mi);
      if (!k || m === null) {
        return null;
      }
      if (cov && cov.level === "low") {
        return null;
      }
      count = m * k.k;
    }
  } else if (mode === "viirs") {
    if (year < 2012) {
      return null;
    }
    count = v;
    exposure = ev;
  }
  if (count === null || count === undefined) {
    return null;
  }
  if (metric === "rate") {
    if (!exposure) {
      return null;
    }
    return (1000 * count) / exposure;
  }
  return count;
}

function SeasonChart(props) {
  const data = props.data;
  const months = props.months;
  const W = 980;
  const H = 300;
  const L = 52;
  const B = 30;
  const T = 24;
  const rows = data.years.map((year, yi) => {
    let mSum = 0;
    let vSum = 0;
    let hSum = 0;
    let hLo = 0;
    let hHi = 0;
    let complete = true;
    let bandOk = true;
    months.forEach((mi) => {
      const m = data.modis[yi][mi];
      const v = data.viirs[yi][mi];
      if (m === null || m === undefined) {
        complete = false;
        return;
      }
      mSum = mSum + m;
      if (v !== null && v !== undefined) {
        vSum = vSum + v;
      }
      if (year >= 2012) {
        hSum = hSum + (v || 0);
        hLo = hLo + (v || 0);
        hHi = hHi + (v || 0);
      } else {
        const k = kFor(data, mi);
        if (!k) {
          complete = false;
          return;
        }
        hSum = hSum + m * k.k;
        if (k.lo === null || k.lo === undefined) {
          bandOk = false;
        } else {
          hLo = hLo + m * k.lo;
          hHi = hHi + m * k.hi;
        }
      }
    });
    let viirs = null;
    if (year >= 2012) {
      viirs = vSum;
    }
    if (!complete) {
      return { year: year, m: null, v: null, h: null, lo: null, hi: null };
    }
    let lo = null;
    let hi = null;
    if (bandOk) {
      lo = hLo;
      hi = hHi;
    }
    return { year: year, m: mSum, v: viirs, h: hSum, lo: lo, hi: hi };
  });
  let max = 1;
  rows.forEach((r) => {
    [r.m, r.v, r.h, r.hi].forEach((x) => {
      if (x !== null && x > max) {
        max = x;
      }
    });
  });
  const n = rows.length;
  const x = (i) => L + (i * (W - L - 20)) / Math.max(1, n - 1);
  const y = (v) => T + (H - T - B) * (1 - v / max);
  function line(key) {
    let d = "";
    rows.forEach((r, i) => {
      if (r[key] === null) {
        return;
      }
      let cmd = "L";
      if (d === "") {
        cmd = "M";
      }
      d = d + cmd + x(i).toFixed(1) + " " + y(r[key]).toFixed(1) + " ";
    });
    return d;
  }
  let band = "";
  const withBand = rows.map((r, i) => [r, i]).filter((p) => p[0].lo !== null && p[0].year < 2012);
  if (withBand.length > 1) {
    band = withBand.map((p, j) => {
      let cmd = "L";
      if (j === 0) {
        cmd = "M";
      }
      return cmd + x(p[1]).toFixed(1) + " " + y(p[0].hi).toFixed(1);
    }).join(" ") + " " + withBand.slice().reverse().map((p) => "L" + x(p[1]).toFixed(1) + " " + y(p[0].lo).toFixed(1)).join(" ") + " Z";
  }
  const seamIndex = data.years.indexOf(2012);
  return (
    <svg viewBox={"0 0 " + W + " " + H} className="chart" role="img" aria-label="Season totals per year: MODIS raw, VIIRS raw and harmonised">
      <g className="grid">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => <line key={f} x1={L} x2={W - 20} y1={y(max * f)} y2={y(max * f)} />)}
      </g>
      {[0, 0.5, 1].map((f) => <text key={"t" + f} x={L - 8} y={y(max * f) + 3} textAnchor="end">{Math.round(max * f).toLocaleString()}</text>)}
      {band && <path d={band} fill="rgba(230,237,243,0.12)" />}
      {seamIndex > 0 && <line x1={x(seamIndex) - 0.5 * (x(1) - x(0))} x2={x(seamIndex) - 0.5 * (x(1) - x(0))} y1={T - 6} y2={H - B} stroke="var(--viirs)" strokeDasharray="4 4" />}
      {seamIndex > 0 && <text x={x(seamIndex) - 0.5 * (x(1) - x(0)) + 6} y={T + 4} className="lab">2012 · VIIRS JOINS</text>}
      <path d={line("m")} fill="none" stroke="#c98418" strokeWidth="2" strokeDasharray="6 4" />
      <path d={line("v")} fill="none" stroke="#1a9dba" strokeWidth="2" />
      <path d={line("h")} fill="none" stroke="var(--text)" strokeWidth="2.4" />
      {rows.map((r, i) => {
        if (r.h === null) {
          return null;
        }
        let tip = r.year + ": harmonised " + Math.round(r.h) + " · MODIS raw " + r.m;
        if (r.v !== null) {
          tip = tip + " · VIIRS raw " + r.v;
        }
        return <circle key={r.year} cx={x(i)} cy={y(r.h)} r="3.2" fill="var(--text)"><title>{tip}</title></circle>;
      })}
      {rows.map((r, i) => {
        if (i % 2 !== 0 && i !== n - 1) {
          return null;
        }
        return <text key={"y" + r.year} x={x(i)} y={H - 8} textAnchor="middle">{r.year}</text>;
      })}
    </svg>
  );
}

const CAL_GUIDE = {
  eyebrow: "Guide · Calendar",
  title: "How to read the calendar",
  intro: "Twenty-five years of fire on one page. Each part below explains one thing you see above, with a link to the lesson, formula or video that goes deeper.",
  accent: "var(--modis)",
  watch: [
    { to: "/guide#ch-3", title: "Watch the Calendar chapter", sub: "Website guide video · narrated walk-through" },
    { to: "/learn#lesson-11", title: "Lesson 11 · Reading the calendar", sub: "Video and PDF · anomalies and seasons" },
    { to: "/learn#lesson-05", title: "Lesson 05 · How harmonisation works", sub: "Video and PDF · one ruler for 25 years" },
  ],
  cards: [
    { title: "What one cell means", text: "One cell is one calendar month of one year. Its number is fire cell-days: how many 0.1° grid cells (about 11 × 11 km) had at least one nominal or high-confidence fire pixel on a local solar day. A cell-day is not burned area.", links: [{ label: "F05 Fire cell-day", to: "/formulas/F05" }, { label: "F06 Monthly count", to: "/formulas/F06" }, { label: "Lesson 08", to: "/learn#lesson-08" }] },
    { title: "Colours, hatching and the 2012 line", text: "Dark to bright means few to many cell-days on one fixed scale. Hatched cells had no product or were not processed: they are empty, never zero. The dashed line marks January 2012, when VIIRS S-NPP joins.", links: [{ label: "Lesson 04 · the 2012 jump", to: "/learn#lesson-04" }] },
    { title: "Raw, Harmonised, VIIRS only", text: "Raw shows each sensor in its own units, so VIIRS years look higher. Harmonised converts pre-2012 MODIS months into VIIRS units with k, so the 25 years sit on one ruler. VIIRS only shows the S-NPP record from 2012.", links: [{ label: "F12 Harmonised value", to: "/formulas/F12" }] },
    { title: "The exchange rate k", text: "k is how many VIIRS fire cell-days match one MODIS cell-day in the same region and calendar month, learned from the 2012–2025 overlap. k = 2.24 means VIIRS sees about 2.2 times as much (124 % more). The bracket is the 95 % interval; \"own data\" is how much of k comes from this region rather than the world value.", links: [{ label: "F10 Overlap ratio", to: "/formulas/F10" }, { label: "F24 Bootstrap", to: "/formulas/F24" }, { label: "F18 Pooling", to: "/formulas/F18" }] },
    { title: "Partial, live and missing months", text: "The current month is month to date and its last days are near-real-time; both are labelled in the month inspector. A month with no product stays empty. Demo data is always marked as simulated.", links: [{ label: "Lesson 14 · live feed", to: "/learn#lesson-14" }, { label: "Lesson 15 · data switch", to: "/learn#data-modes" }] },
    { title: "Exposure rate", text: "Cloud hides fire. The exposure rate divides fire cell-days by the cell-days the satellite actually had a clear look, so a cloudy month is not mistaken for a quiet one. It needs clear-sky days from Earth Engine.", links: [{ label: "F09 Exposure rate", to: "/formulas/F09" }, { label: "Lesson 03", to: "/learn#lesson-03" }] },
  ],
};

function fromQuery() {
  const q = new URLSearchParams(window.location.search);
  const year = Number(q.get("y"));
  const month = Number(q.get("m"));
  if (!year || !month || month < 1 || month > 12) {
    return null;
  }
  return { year: year, month: month - 1 };
}

export default function Calendar() {
  const params = useParams();
  const navigate = useNavigate();
  const region = params.region || "punjab_haryana";
  const [data, setData] = useState(null);
  const [meta, setMeta] = useState(null);
  const [mode, setMode] = useState("raw");
  const [metric, setMetric] = useState("count");
  const [selected, setSelected] = useState(null);
  const [regionList, setRegionList] = useState([]);

  useEffect(() => {
    loadCalendarRegions().then((r) => setRegionList(r.data)).catch(() => setRegionList([]));
  }, []);

  useEffect(() => {
    document.title = "Calendar · FIREWORK CHRONOS";
    setData(null);
    setSelected(null);
    loadCalendar(region).then((result) => {
      setData(result.data);
      setMeta(result.meta);
      const want = fromQuery();
      if (want && result.data.years.indexOf(want.year) >= 0) {
        setSelected(want);
        setTimeout(() => {
          const box = document.getElementById("cal-detail");
          if (box) {
            box.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }, 400);
      }
    });
  }, [region]);

  if (!data) {
    return <div className="page"><p className="dim">Loading calendar…</p></div>;
  }

  const demo = Boolean(meta && (meta.demo || meta.fallback_used));
  const firmsPoints = Boolean(meta && meta.provider === "NASA FIRMS (LANCE / MODAPS)");
  const exposureReady = hasExposure(data);
  let activeMetric = metric;
  if (!exposureReady) {
    activeMetric = "count";
  }

  const values = data.years.map((y, yi) => MONTH_NAMES.map((n, mi) => cellValue(data, yi, mi, mode, activeMetric)));
  const fixedScale = data.years.map((y, yi) => MONTH_NAMES.map((n, mi) => cellValue(data, yi, mi, "harmonised", activeMetric)));
  let maxValue = 1;
  fixedScale.concat(data.years.map((y, yi) => MONTH_NAMES.map((n, mi) => cellValue(data, yi, mi, "raw", activeMetric)))).forEach((row) => row.forEach((v) => {
    if (v !== null && v > maxValue) {
      maxValue = v;
    }
  }));

  let seasonMonths = [9, 10];
  if (data.months_processed && data.months_processed.length > 0) {
    seasonMonths = data.months_processed.map((m) => m - 1);
  }
  const seasonLabel = seasonMonths.map((mi) => MONTH_NAMES[mi]).join("–");

  let unit = "fire cell-days";
  if (activeMetric === "rate") {
    unit = "fire cell-days per 1,000 clear-view cell-days";
  }

  let kRows = null;
  if (data.k_baseline) {
    let kMax = 1;
    seasonMonths.forEach((mi) => {
      const k = kFor(data, mi);
      if (k && k.hi > kMax) {
        kMax = k.hi;
      }
    });
    const rows = seasonMonths.map((mi) => {
      const k = kFor(data, mi);
      if (!k) {
        return <div className="kbar" key={mi}><span className="kbar-m">{MONTH_NAMES[mi].slice(0, 3)}</span><span className="kbar-none">no overlap data</span></div>;
      }
      const cov = coverageFor(data, mi);
      if (cov && cov.level === "low") {
        return <div className="kbar low" key={mi} title={cov.reason || "low coverage"}><span className="kbar-m"><i className="kcov low">L</i>{MONTH_NAMES[mi].slice(0, 3)}</span><span className="kbar-none">withheld · {cov.reason || "too little fire evidence"}</span></div>;
      }
      let covChip = null;
      let rowCls = "kbar";
      if (cov) {
        let covTip = cov.level + " coverage · " + cov.n_years + " overlap years · " + cov.modis_sum.toLocaleString() + " MODIS cell-days";
        if (cov.reason) {
          covTip = covTip + " · " + cov.reason;
        }
        covChip = <i className={"kcov " + cov.level} title={covTip}>{cov.level.charAt(0).toUpperCase()}</i>;
        if (cov.level === "low") {
          rowCls = "kbar low";
        }
      }
      return (
        <div className={rowCls} key={mi} title={"k = " + k.k.toFixed(2) + ", 95 % range " + k.lo.toFixed(2) + " to " + k.hi.toFixed(2) + ", from " + k.n_years + " years"}>
          <span className="kbar-m">{covChip}{MONTH_NAMES[mi].slice(0, 3)}</span>
          <span className="kbar-track">
            <i className="kbar-fill" style={{ width: (100 * k.k / kMax).toFixed(1) + "%" }} />
            <i className="kbar-range" style={{ left: (100 * k.lo / kMax).toFixed(1) + "%", width: (100 * (k.hi - k.lo) / kMax).toFixed(1) + "%" }} />
          </span>
          <span className="kbar-t"><b>{k.k.toFixed(1)}×</b> as much<small>likely {k.lo.toFixed(1)}–{k.hi.toFixed(1)}</small></span>
        </div>
      );
    });
    kRows = (
      <div className="kbars">
        <div className="kbar kbar-head"><span>Month</span><span>How many times as much fire VIIRS sees</span><span>k</span></div>
        {rows}
      </div>
    );
  }

  let detail = <p className="dim small">Click a month to inspect it.</p>;
  if (selected) {
    const yi = data.years.indexOf(selected.year);
    const mi = selected.month;
    const history = data.years.map((y, i) => values[i][mi]).filter((v, i) => v !== null && data.years[i] !== selected.year);
    const sorted = history.slice().sort((a, b) => a - b);
    let median = null;
    if (sorted.length > 0) {
      median = sorted[Math.floor(sorted.length / 2)];
    }
    let valueText = "not processed / no coverage";
    if (selected.value !== null && selected.value !== undefined) {
      valueText = selected.value.toFixed(1) + " " + unit;
    }
    let viirsRaw = "—";
    if (selected.year >= 2012 && data.viirs[yi][mi] !== null) {
      viirsRaw = data.viirs[yi][mi];
    }
    let modisRaw = "—";
    if (data.modis[yi][mi] !== null) {
      modisRaw = data.modis[yi][mi];
    }
    let noaa20 = "—";
    if (data.platforms && data.platforms.noaa20 && data.platforms.noaa20[yi][mi] !== null) {
      noaa20 = data.platforms.noaa20[yi][mi];
    }
    let exposureText = "—";
    if (data.exposure_modis[yi][mi] !== null) {
      let viirsExposure = "—";
      if (data.exposure_viirs[yi][mi] !== null) {
        viirsExposure = Math.round(data.exposure_viirs[yi][mi]).toLocaleString();
      }
      exposureText = Math.round(data.exposure_modis[yi][mi]).toLocaleString() + " MODIS · " + viirsExposure + " VIIRS";
    }
    let statusLine = statusText(data, "modis", yi, mi);
    const viirsStatus = statusText(data, "viirs", yi, mi);
    if (viirsStatus && viirsStatus !== statusLine) {
      if (statusLine) {
        statusLine = "MODIS " + statusLine + " · VIIRS " + viirsStatus;
      } else {
        statusLine = "VIIRS " + viirsStatus;
      }
    }
    let medianText = "—";
    if (median !== null) {
      medianText = median.toFixed(1);
    }
    let origin = "MODIS × k (estimate)";
    if (mode === "raw") {
      origin = "observed, each sensor";
    } else if (selected.year >= 2012) {
      origin = "VIIRS S-NPP observed";
    }
    const k = kFor(data, mi);
    const cov = coverageFor(data, mi);
    let coverText = "—";
    let coverCls = "cov-none";
    if (cov) {
      coverCls = "cov-" + cov.level;
      coverText = COVER_LABEL[cov.level] + " · " + cov.n_years + " overlap yrs";
    }
    let confText = "—";
    let confNote = "";
    const hv = cellValue(data, yi, mi, "harmonised", "count");
    let cls = null;
    const mRaw = data.modis[yi][mi];
    if (data.trust_summary && data.trust_summary.conformal && data.trust_summary.conformal.classes && mRaw !== null) {
      data.trust_summary.conformal.classes.forEach((c) => {
        if (mRaw >= c.from && c.factor95) {
          cls = c;
        }
      });
    }
    if (selected.year < 2012 && hv !== null && cls) {
      confText = Math.round(hv / cls.factor95).toLocaleString() + " – " + Math.round(hv * cls.factor95).toLocaleString();
      let classTo = "+";
      if (cls.to) {
        classTo = "–" + cls.to;
      }
      confNote = "Conformal 95 % interval for what VIIRS would have counted: ×÷ " + cls.factor95.toFixed(2) + " for months with " + cls.from + classTo + " MODIS cell-days. On years the method never saw, it held " + (100 * cls.achieved95).toFixed(1) + " % of the time.";
    } else if (selected.year < 2012 && hv !== null) {
      confText = "too few fires";
      confNote = "Fewer than 10 MODIS cell-days: too little signal for a calibrated interval.";
    } else if (cov && cov.level === "low" && selected.year < 2012) {
      confText = "withheld";
      confNote = "Coverage is too low here: " + (cov.reason || "too little overlap evidence") + ". No harmonised value is shown rather than a guess.";
    } else if (selected.year >= 2012) {
      confText = "observed, no model";
    }
    let distRow = null;
    let whyK = null;
    if (data.trust && data.trust.distance && data.trust.distance[mi]) {
      const dz = data.trust.distance[mi];
      distRow = <div className="kv"><span>Distance from tested data</span><b className={"zone-" + dz.zone}>{ZONE_LABEL[dz.zone]} · {Math.round(dz.pct)}th pct</b></div>;
    }
    if (data.trust && data.trust.why_k && data.trust.why_k[mi]) {
      whyK = <WhyK w={data.trust.why_k[mi]} />;
    }
    let similar = null;
    if (data.trust && data.trust.similar && data.trust.similar[String(selected.year)]) {
      const sims = data.trust.similar[String(selected.year)];
      similar = (
        <div className="cal-sim">
          <div className="caps">Seasons most like {selected.year}</div>
          {sims.map((r) => (
            <button type="button" key={r[0]} className="cal-sim-row" onClick={() => setSelected({ year: r[0], month: mi })}>
              <b>{r[0]}</b><span>{r[2].toLocaleString()} cell-days in the year</span><i>distance {r[1].toFixed(2)}</i>
            </button>
          ))}
          <p className="hint-mono">Distance between whole 12-month seasons on a log scale, harmonised values. Click a year to inspect it.</p>
        </div>
      );
    }
    let kText = "—";
    if (k && k.demo) {
      kText = k.k + " (demo)";
    } else if (k) {
      kText = k.k.toFixed(2) + " [" + k.lo.toFixed(2) + ", " + k.hi.toFixed(2) + "]";
      if (k.pool_weight !== undefined && k.pool_weight < 1) {
        kText = kText + " · " + Math.round(k.pool_weight * 100) + "% own data";
      }
    }
    let note = <div className="note small" style={{ marginTop: 10 }}>Real FIRMS standard-processing detections, counted as fire cell-days on local solar days. Clear-sky correction (F09) is pending Earth Engine.</div>;
    if (data.status_modis) {
      note = <div className="note small" style={{ marginTop: 10 }}>Counted from NASA's daily fire masks (MOD14A1, MYD14A1, VNP14A1) in Google Earth Engine, with FIRMS near-real-time days after the archive ends. A hot pixel is not a fire, and a cell-day is not burned area.</div>;
    }
    if (firmsPoints) {
      note = <div className="note small" style={{ marginTop: 10 }}>Counted from every NASA FIRMS standard-archive fire point (MODIS Terra + Aqua, VIIRS S-NPP 375 m), binned to 0.1° cells on local solar days. A hot pixel is not a fire, and a cell-day is not burned area.</div>;
    }
    if (demo) {
      note = <div className="note warn small" style={{ marginTop: 10 }}>Simulated world from the atlas baseline ladder — not real fires.</div>;
    }
    detail = (
      <div>
        <h3 style={{ fontSize: 22, fontWeight: 300, fontFamily: "var(--font-display)" }}>{MONTH_NAMES[mi]} {selected.year}</h3>
        <div className="kv"><span>Value</span><b>{valueText}</b></div>
        <div className="kv"><span>Origin</span><b>{origin}</b></div>
        <div className="kv"><span>MODIS (Terra + Aqua)</span><b>{modisRaw}</b></div>
        <div className="kv"><span>VIIRS S-NPP</span><b>{viirsRaw}</b></div>
        <div className="kv"><span>VIIRS NOAA-20 (separate)</span><b>{noaa20}</b></div>
        <div className="kv"><span>Exposure (valid cell-days)</span><b>{exposureText}</b></div>
        {statusLine && <div className="kv"><span>Status</span><b>{statusLine}</b></div>}
        <div className="kv"><span>Median, same month other years</span><b>{medianText}</b></div>
        <div className="kv"><span>k used</span><b>{kText}</b></div>
        <div className="kv"><span>Coverage of k</span><b className={coverCls}>{coverText}</b></div>
        <div className="kv"><span>95 % interval</span><b>{confText}</b></div>
        {confNote && <p className="hint-mono" style={{ marginTop: 6 }}>{confNote}</p>}
        {distRow}
        {whyK}
        {similar}
        {note}
      </div>
    );
  }

  let dataNote = null;
  if (data.trust && data.trust.note) {
    const n = data.trust.note;
    const lowMonths = (data.trust.coverage || []).filter((c) => c.level === "low").length;
    let problem = null;
    if (n.fire_cell_days < 50) {
      problem = "Very few fires: " + n.fire_cell_days.toLocaleString() + " fire cell-days in 26 years of NASA FIRMS data, in " + n.months_with_fire + " months. Dark cells are real zeros — the archive was processed and no fire was detected.";
    } else if (lowMonths > 0) {
      problem = n.fire_cell_days.toLocaleString() + " fire cell-days in 26 years. In " + lowMonths + " of 12 calendar months there is too little overlap evidence to learn this region's own exchange rate, so harmonised values for those months are withheld (hatched in the Harmonised view).";
    }
    if (n.months_with_own_k === 0) {
      problem = (problem || "") + " No month has enough fires in 2012–2025 for its own k: the k values come entirely from the whole-Earth pool and are not used here.";
    }
    if (problem) {
      dataNote = <div className="cal-datanote"><b>Data note</b><span>{problem}</span></div>;
    }
  }
  let lede = "Real NASA FIRMS standard-processing archive: each cell is the number of fire cell-days (0.1° cell × local solar day) in that month. Switch to harmonised and the 2012 step, where VIIRS joins, is converted to one ruler. Hatched = not processed or no coverage, never zero.";
  if (data.status_modis) {
    lede = "Every country on Earth, 2000 to this month: each cell is the number of fire cell-days (0.1° cell × day with a nominal or high-confidence fire) counted from NASA's daily MODIS and VIIRS fire masks. The current month is month to date and its last days are near-real-time. Hatched = no product, never zero.";
  }
  if (firmsPoints) {
    lede = "Every country on Earth, 2000 to 2025 plus 2026 so far, from about 658 million NASA FIRMS fire points: each cell is the number of fire cell-days (0.1° cell × local solar day with a nominal or high-confidence fire). VIIRS S-NPP starts in 2012. Hatched = no product, never zero.";
  }
  if (demo) {
    lede = "Simulated world from the atlas method test. Switch from raw to harmonised: the step at 2012 fades while the seasons stay. Hatched cells mean no valid observation — never zero.";
  }

  let countCls = "";
  let rateCls = "";
  if (activeMetric === "rate") {
    rateCls = "on";
  } else {
    countCls = "on";
  }
  let rateTitle = "Exposure is counted per country in Earth Engine: choose Whole Earth or a country (F09)";
  if (exposureReady) {
    rateTitle = "Fire cell-days per 1,000 cell-days the satellite had a clear view (F09): a cloudy month is not a quiet month";
  }

  let countryValue = "";
  if (region.indexOf("c_") === 0) {
    countryValue = region;
  }

  let provenanceBadge = <Badge kind="SOURCE_DERIVED" />;
  if (demo) {
    provenanceBadge = <Badge kind="SIMULATED_DEMO" />;
  }

  return (
    <div className="page">
      <div className="ex-head" style={{ paddingBottom: 18 }}>
        <div className="ph" style={{ "--ph": "var(--modis)" }}>
          <div className="eyebrow">Historical fire calendar · {data.region_name || region}</div>
          <h1 className="ph-title">Fire <em>calendar</em></h1>
          <p className="ph-q">Twenty-five years of fire on one page</p>
          <GuideCue target="guide-calendar" />
        </div>
        <div>
          <p className="ex-lede">{lede}</p>
          <div className="ex-tags">
            <StatusChip status={statusOf(meta)} />
            {provenanceBadge}
            {data.cells_in_region && <span className="chip"><span className="dot" />{data.cells_in_region} cells · 0.1°</span>}
          </div>
        </div>
      </div>

      <div className="ex-bar">
        <div className="grp">
          <span className="lbl">Region</span>
          <div className="seg">
            {REGIONS.map((r) => {
              let cls = "";
              if (region === r[0]) {
                cls = "on";
              }
              return <button key={r[0]} className={cls} onClick={() => navigate("/calendar/" + r[0])}>{r[1]}</button>;
            })}
          </div>
          {regionList.length > 0 && (
            <select className="cal-country" value={countryValue} onChange={(e) => { if (e.target.value) { navigate("/calendar/" + e.target.value); } }} aria-label="Choose a country">
              <option value="">Any country…</option>
              {regionList.filter((r) => r.id !== "world").slice().sort((a, b) => a.name.localeCompare(b.name)).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          )}
        </div>
        <div className="grp">
          <span className="lbl">View</span>
          <div className="seg">
            {[["raw", "Raw (each sensor)"], ["harmonised", "Harmonised"], ["viirs", "VIIRS only"]].map((opt) => {
              let cls = "";
              if (mode === opt[0]) {
                cls = "on";
              }
              return <button key={opt[0]} className={cls} onClick={() => setMode(opt[0])}>{opt[1]}</button>;
            })}
          </div>
        </div>
        <div className="grp">
          <span className="lbl">Metric</span>
          <div className="seg">
            <button className={countCls} onClick={() => setMetric("count")}>Cell-days</button>
            <button className={rateCls} disabled={!exposureReady} title={rateTitle} onClick={() => setMetric("rate")}>Exposure rate</button>
          </div>
          {!exposureReady && <span className="hint-mono" style={{ marginTop: 0 }}>exposure is counted per country — pick Whole Earth or a country</span>}
        </div>
        <button className="btn small" onClick={() => navigate("/explore")}>Open on the globe</button>
      </div>

      <div className="split3" style={{ marginTop: 20 }}>
        <div className="panel" data-film="cal-grid" style={{ padding: 20 }}>
          {dataNote}
          <CalendarHeatmap years={data.years} values={values} maxValue={maxValue} unit={unit} onSelect={setSelected} selected={selected} seamYear={2012} cell={44} />
          <div className="row small dim" style={{ marginTop: 12 }}>
            <span>low</span>
            <span style={{ width: 160, height: 8, borderRadius: 4, background: "linear-gradient(90deg," + rampColor(0) + "," + rampColor(0.5) + "," + rampColor(1) + ")" }} />
            <span>high · one fixed scale for raw and harmonised</span>
            <span style={{ width: 14, height: 10, background: "repeating-linear-gradient(45deg,#141b2b 0 3px,#5b6780 3px 5px)", marginLeft: 12 }} />
            <span>not processed, no coverage, or k withheld (low coverage)</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="panel" data-film="cal-inspector" style={{ padding: 20 }}>
            <div className="caps">Month inspector</div>
            <div id="cal-detail" style={{ marginTop: 10 }}>{detail}</div>
          </div>
          {kRows && (
            <div className="panel" data-film="cal-k" style={{ padding: 20 }}>
              <div className="caps">Exchange rate k · S-NPP / MODIS</div>
              <p className="k-explain">VIIRS has sharper eyes than MODIS, so it counts more fire. <b>k</b> says how many times more, for each month. To put old MODIS years on today's ruler, FIREWORK multiplies them by k. The thin line on each bar is the likely range.</p>
              <div className="k-links">
                <a href="/formulas/F12" onClick={(e) => { e.preventDefault(); navigate("/formulas/F12"); }}>What k does · F12</a>
                <a href="/formulas/F24" onClick={(e) => { e.preventDefault(); navigate("/formulas/F24"); }}>The 95 % range · F24</a>
                <a href="/learn#lesson-05" onClick={(e) => { e.preventDefault(); navigate("/learn#lesson-05"); }}>Video lesson</a>
              </div>
              <div style={{ marginTop: 10 }}>{kRows}</div>
              <p className="hint-mono">{meta && meta.k_method}</p>
              {data.trust && data.trust.physics && (
                <div className="cal-checks">
                  <div className="caps">Automatic checks for this region</div>
                  {data.trust.physics.checks.map((c) => {
                    let cls = "cal-check flag";
                    let mark = "!";
                    if (c.pass) {
                      cls = "cal-check ok";
                      mark = "✓";
                    }
                    return (
                      <div key={c.id} className={cls} title={c.detail}>
                        <b>{mark}</b><span>{c.id} · {c.name}</span><i>{c.detail}</i>
                      </div>
                    );
                  })}
                  <p className="hint-mono">Coverage letters: H high, M medium, L low (k withheld). Rules and results for all 237 regions are in the method card on the Validation page.</p>
                </div>
              )}
              <div className="row" style={{ marginTop: 10 }}><Badge kind="RUN_TESTED_LOCALLY" /></div>
            </div>
          )}
        </div>
      </div>

      <section className="chart-card" style={{ marginTop: 20 }}>
        <h3>The record, season by season · {seasonLabel}</h3>
        <p className="sub">Total fire cell-days per {seasonLabel} season. Dashed amber = MODIS raw; cyan = VIIRS S-NPP raw; white = harmonised (MODIS × k before 2012, VIIRS after) with its 95% band.</p>
        <div className="legend-row"><span><i style={{ background: "#c98418" }} />MODIS raw</span><span><i style={{ background: "#1a9dba" }} />VIIRS raw</span><span><i style={{ background: "var(--text)" }} />Harmonised</span><span><i style={{ background: "rgba(230,237,243,0.25)" }} />95% band (from k)</span></div>
        <SeasonChart data={data} months={seasonMonths} />
      </section>
      <PageGuide id="guide-calendar" {...CAL_GUIDE} />
    </div>
  );
}
