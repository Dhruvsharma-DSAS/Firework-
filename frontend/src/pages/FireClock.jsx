import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GuideCue } from "../components/PageGuide.jsx";
import Badge from "../components/Badge.jsx";
import EarthClock from "../components/EarthClock.jsx";
import StatusChip from "../components/StatusChip.jsx";
import { fetchJson } from "../api/client.js";
import "../styles/pagedoc.css";
import "../styles/fireclock.css";

const FLAGS = {
  NORMAL: ["Normal", "Activity and timing look like the 2012–2020 reference."],
  TIMING_SHIFT: ["Timing shift", "More of the detected burning happens at night than before."],
  LOW_ACTIVITY: ["Low activity", "Detections are far below normal and the timing has not changed."],
  HIDDEN_BURNING_LIKELY: ["Hidden burning likely", "Detections are far below normal and burning has moved towards hours the satellites rarely see."],
};

const CLOCKS = [
  ["10:30", "Terra · MODIS", "morning pass", "var(--modis)"],
  ["13:30", "Aqua · MODIS and S-NPP · NOAA-20 · VIIRS", "afternoon passes", "var(--viirs)"],
  ["01:30", "S-NPP · NOAA-20 · VIIRS", "night pass", "var(--model)"],
];

const STEPS = [
  ["Same instrument, two times of day", "Terra and Aqua carry the same MODIS sensor, and VIIRS looks by day and by night. Comparing a sensor with itself cancels the pixel-size difference that harmonisation has to correct."],
  ["Night share", "FC2 = night detections ÷ all VIIRS detections, with a 95% Wilson interval. VIIRS keeps its 01:30 and 13:30 times, so this signal is not affected by orbit drift."],
  ["Morning-to-afternoon ratio", "FC1 = Terra day detections ÷ Aqua day detections. It falls if burning moves later in the day, but after 2021 Terra drifted earlier and Aqua later, so it is shown as supporting evidence only."],
  ["Flag", "Hidden burning is likely when the season's harmonised cell-days are at most half of the 2012–2020 median and the night share is more than twice its reference."],
];

function pct(v, digits) {
  if (v === null || v === undefined) {
    return "—";
  }
  return (100 * v).toFixed(digits) + "%";
}

function change(a, b) {
  if (!a) {
    return "—";
  }
  const c = (100 * (b - a)) / a;
  let sign = "";
  if (c > 0) {
    sign = "+";
  }
  return sign + c.toFixed(0) + "%";
}

function NightChart(props) {
  const rows = props.rows.filter((r) => r.year >= 2012);
  const w = 640;
  const h = 250;
  const left = 44;
  const bottom = 214;
  const top = 16;
  let max = 0;
  rows.forEach((r) => {
    if (r.night_share_hi > max) {
      max = r.night_share_hi;
    }
  });
  max = Math.ceil(max * 100) / 100;
  if (max < 0.01) {
    max = 0.01;
  }
  const step = (w - left - 10) / rows.length;
  const y = (v) => bottom - ((bottom - top) * v) / max;
  const ref = props.base;
  const ticks = [0, max / 2, max];
  return (
    <svg className="fc-chart" viewBox={"0 0 " + w + " " + h} role="img" aria-label="VIIRS night share by year, 2012 to 2025">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={left} x2={w - 10} y1={y(t)} y2={y(t)} className="fc-grid" />
          <text x={left - 6} y={y(t) + 4} className="fc-tick end">{(100 * t).toFixed(1)}%</text>
        </g>
      ))}
      <line x1={left} x2={w - 10} y1={y(2 * ref)} y2={y(2 * ref)} className="fc-ref" />
      <text x={left + 6} y={y(2 * ref) - 6} className="fc-tick">2 × reference</text>
      {rows.map((r, i) => {
        const x = left + i * step + step * 0.18;
        const bw = step * 0.64;
        let cls = "fc-bar";
        if (r.flag === "HIDDEN_BURNING_LIKELY") {
          cls = "fc-bar hot";
        } else if (r.flag === "TIMING_SHIFT") {
          cls = "fc-bar warm";
        }
        return (
          <g key={r.year}>
            <rect className={cls} x={x} y={y(r.night_share)} width={bw} height={Math.max(bottom - y(r.night_share), 0.5)} rx="2" style={{ animationDelay: i * 40 + "ms" }} />
            <line className="fc-whisker" x1={x + bw / 2} x2={x + bw / 2} y1={y(r.night_share_lo)} y2={y(r.night_share_hi)} />
            <text x={x + bw / 2} y={bottom + 16} className="fc-tick mid">{String(r.year).slice(2)}</text>
          </g>
        );
      })}
      <line x1={left} x2={w - 10} y1={bottom + 0.5} y2={bottom + 0.5} className="fc-axis" />
    </svg>
  );
}

function IndexChart(props) {
  const rows = props.rows.filter((r) => r.year >= 2012);
  const base = rows.filter((r) => r.year <= 2016);
  let dayBase = 0;
  let nightBase = 0;
  base.forEach((r) => {
    dayBase = dayBase + r.snpp_day / base.length;
    nightBase = nightBase + r.snpp_night / base.length;
  });
  const w = 640;
  const h = 250;
  const left = 44;
  const bottom = 214;
  const top = 16;
  const lo = Math.log10(3);
  const hi = Math.log10(1000);
  const step = (w - left - 20) / (rows.length - 1);
  const y = (v) => bottom - ((bottom - top) * (Math.log10(Math.max(v, 3)) - lo)) / (hi - lo);
  const x = (i) => left + i * step;
  const dayPts = rows.map((r, i) => x(i).toFixed(1) + "," + y((100 * r.snpp_day) / dayBase).toFixed(1));
  const nightPts = rows.map((r, i) => x(i).toFixed(1) + "," + y((100 * r.snpp_night) / nightBase).toFixed(1));
  return (
    <svg className="fc-chart" viewBox={"0 0 " + w + " " + h} role="img" aria-label="VIIRS day and night detections indexed to 2012 to 2016, logarithmic scale">
      {[5, 10, 25, 50, 100, 250, 500, 1000].map((t) => {
        let cls = "fc-grid";
        if (t === 100) {
          cls = "fc-grid strong";
        }
        return (
          <g key={t}>
            <line x1={left} x2={w - 10} y1={y(t)} y2={y(t)} className={cls} />
            <text x={left - 6} y={y(t) + 4} className="fc-tick end">{t}</text>
          </g>
        );
      })}
      <polyline points={dayPts.join(" ")} className="fc-line day" />
      <polyline points={nightPts.join(" ")} className="fc-line night" />
      {rows.map((r, i) => <text key={r.year} x={x(i)} y={bottom + 16} className="fc-tick mid">{String(r.year).slice(2)}</text>)}
      <text x={x(rows.length - 1) - 4} y={y((100 * rows[rows.length - 1].snpp_day) / dayBase) + 16} className="fc-lab day end">day 13:30</text>
      <text x={x(rows.length - 1) - 4} y={y((100 * rows[rows.length - 1].snpp_night) / nightBase) + 18} className="fc-lab night end">night 01:30</text>
    </svg>
  );
}

function DriftChart(props) {
  const rows = props.rows;
  const w = 640;
  const h = 230;
  const left = 44;
  const bottom = 196;
  const top = 14;
  const step = (w - left - 20) / (rows.length - 1);
  const x = (i) => left + i * step;
  const yr = (v) => bottom - ((bottom - top) * (Math.log10(Math.max(v, 0.004)) - Math.log10(0.004))) / (Math.log10(0.4) - Math.log10(0.004));
  const pts = [];
  rows.forEach((r, i) => {
    if (r.mar !== null) {
      pts.push(x(i).toFixed(1) + "," + yr(r.mar).toFixed(1));
    }
  });
  return (
    <svg className="fc-chart" viewBox={"0 0 " + w + " " + h} role="img" aria-label="Morning-to-afternoon ratio of MODIS detections by year, logarithmic scale">
      {[0.005, 0.01, 0.03, 0.1, 0.3].map((t) => (
        <g key={t}>
          <line x1={left} x2={w - 10} y1={yr(t)} y2={yr(t)} className="fc-grid" />
          <text x={left - 6} y={yr(t) + 4} className="fc-tick end">{t}</text>
        </g>
      ))}
      <polyline points={pts.join(" ")} className="fc-line morning" />
      {rows.map((r, i) => {
        if (r.mar === null) {
          return null;
        }
        return <line key={r.year} className="fc-whisker" x1={x(i)} x2={x(i)} y1={yr(r.mar_lo)} y2={yr(r.mar_hi)} />;
      })}
      {rows.map((r, i) => {
        if (i % 2 === 1) {
          return null;
        }
        return <text key={r.year} x={x(i)} y={bottom + 16} className="fc-tick mid">{String(r.year).slice(2)}</text>;
      })}
    </svg>
  );
}

const FIT_WORD = ["not found", "rare", "some", "common", "common", "very common"];
const FIT = [
  ["One scale for MODIS and VIIRS", "A harmonisation factor with an uncertainty range", 5, "Calendar · k per region and month", false],
  ["Honesty tests", "Held-out years, placebo checks, interval coverage", 3, "Validation · gates and trust layer", false],
  ["Live fire map", "Recent hot spots on a globe or map", 5, "Explorer · five satellites", false],
  ["Static heat removed", "Kilns, flares and plants kept out of the count", 3, "Mask · formula F08", false],
  ["Forecasts, smoke and air quality", "Spread models, risk maps, CO₂ or haze estimates", 4, "Not claimed · outside our evidence", false],
  ["Burning that moved to hours no satellite watches", "The same sensor compared with itself by time of day", 0, "Fire Clock · this page", true],
];

export default function FireClock() {
  const navigate = useNavigate();
  const [doc, setDoc] = useState(null);
  const [failed, setFailed] = useState(false);
  const [year, setYear] = useState(2025);

  useEffect(() => {
    document.title = "Fire Clock · FIREWORK CHRONOS";
    fetchJson("/data/fire_clock_punjab_haryana.json")
      .then((d) => setDoc(d))
      .catch(() => setFailed(true));
  }, []);

  let status = "LOADING";
  if (doc) {
    status = doc.meta.status;
  }
  if (failed) {
    status = "UNAVAILABLE";
  }

  let body = <div className="fc-wait">Loading the measured fire clock…</div>;
  if (failed) {
    body = <p className="fc-none">The Fire Clock file could not be loaded, so nothing is estimated in its place.</p>;
  }

  if (doc) {
    const d = doc.data;
    const rows = d.rows;
    const a = rows.find((r) => r.year === 2021);
    const b = rows.find((r) => r.year === 2025);
    const sel = rows.find((r) => r.year === year);
    let selFlag = FLAGS.NORMAL;
    if (sel && FLAGS[sel.flag]) {
      selFlag = FLAGS[sel.flag];
    }
    let selNight = "—";
    if (sel && sel.night_share !== null) {
      selNight = pct(sel.night_share, 2);
    }
    let selSeason = "—";
    if (sel && sel.season_cell_days !== null) {
      selSeason = Math.round(sel.season_cell_days).toLocaleString();
    }
    let flagClass = "fc-verdict";
    if (sel && sel.flag === "HIDDEN_BURNING_LIKELY") {
      flagClass = "fc-verdict hot";
    } else if (sel && sel.flag !== "NORMAL") {
      flagClass = "fc-verdict warm";
    }

    body = (
      <>
        <section className="pd-sec">
          <div className="pd-margin"><b>The clock</b><span>24 hours over Punjab + Haryana · drag the year</span></div>
          <div className="pd-col">
            <h2>One day on Earth, and the few hours a satellite is looking</h2>
            <p>The ring is a full day in local solar time, midnight at the top and noon at the bottom. Slide through the seasons and watch the afternoon flame shrink while the night flame stays.</p>
            <EarthClock rows={doc.data.rows} />
          </div>
        </section>

        <section className="pd-sec">
          <div className="pd-margin"><b>Finding</b><span>Punjab + Haryana · Oct–Nov · 2021 → 2025</span></div>
          <div className="pd-col">
            <h2>Daytime detections collapsed. Night detections did not.</h2>
            <p>Every number here comes from the NASA FIRMS standard archive for Punjab, Haryana and Chandigarh, with known industrial and volcanic hot spots removed. The same VIIRS instrument that saw <b>{change(a.snpp_day, b.snpp_day)}</b> fewer fires at 13:30 saw <b>{change(a.snpp_night, b.snpp_night)}</b> more at 01:30.</p>
            <div className="pd-figures fc-figures">
              <div><b className="viirs">{change(a.snpp_day, b.snpp_day)}</b><span>VIIRS day detections, 13:30</span></div>
              <div><b className="model">{change(a.snpp_night, b.snpp_night)}</b><span>VIIRS night detections, 01:30</span></div>
              <div><b className="fire">{pct(a.night_share, 2)} → {pct(b.night_share, 1)}</b><span>night share of all detections</span></div>
              <div><b className="modis">{change(a.terra_day, b.terra_day)}</b><span>Terra morning detections, 10:30</span></div>
            </div>
            <div className="fc-badges"><Badge kind="SOURCE_DERIVED" /><StatusChip status={status} /></div>
          </div>
        </section>

        <section className="pd-sec">
          <div className="pd-margin"><b>Evidence 1</b><span>FC2 · night share</span></div>
          <div className="pd-col">
            <h2>The night share of detections rose 27-fold</h2>
            <p>Bars show night detections as a share of all VIIRS S-NPP detections in October–November, with 95% intervals. The dashed line is twice the 2012–2020 reference of <b>{pct(d.night_share_ref, 2)}</b>. Amber bars mark a timing shift; red bars mark years where the season is also at most half of normal.</p>
            <NightChart rows={rows} base={d.night_share_ref} />
          </div>
        </section>

        <section className="pd-sec">
          <div className="pd-margin"><b>Evidence 2</b><span>Day vs night, same sensor</span></div>
          <div className="pd-col">
            <h2>Two clocks, one instrument, opposite directions</h2>
            <p>Both lines are VIIRS S-NPP detections indexed to their own 2012–2016 average (= 100) on a logarithmic scale. Because it is one sensor, the pixel size, the algorithm and the orbit are the same for both lines. Only the hour differs.</p>
            <IndexChart rows={rows} />
            <div className="fc-key"><span><i className="day" />Day pass, about 13:30</span><span><i className="night" />Night pass, about 01:30</span></div>
          </div>
        </section>

        <section className="pd-sec">
          <div className="pd-margin"><b>Evidence 3</b><span>FC1 · supporting only</span></div>
          <div className="pd-col">
            <h2>Morning fires vanished first</h2>
            <p>The ratio of Terra (morning) to Aqua (afternoon) MODIS detections fell from about <b>0.2</b> in 2003–2009 to <b>{b.mar.toFixed(3)}</b> in 2025. Treat it with care: the measured local solar time of the Terra pass over this region moved from <b>{rows[0].terra_lmst}</b> to <b>{b.terra_lmst}</b> h, and Aqua from <b>{rows[0].aqua_lmst}</b> to <b>{b.aqua_lmst}</b> h, as both satellites drift before retirement.</p>
            <DriftChart rows={rows} />
          </div>
        </section>

        <section className="pd-sec">
          <div className="pd-margin"><b>Verdict</b><span>Pick a season</span></div>
          <div className="pd-col">
            <h2>Is burning falling, or moving out of sight?</h2>
            <div className="fc-years" role="group" aria-label="Season year">
              {rows.map((r) => {
                let cls = "fc-year " + r.flag.toLowerCase();
                if (r.year === year) {
                  cls = cls + " on";
                }
                return <button type="button" key={r.year} className={cls} onClick={() => setYear(r.year)} aria-pressed={r.year === year}>{r.year}</button>;
              })}
            </div>
            <div className={flagClass}>
              <div className="fc-verdict-head">
                <span>{year} · October–November</span>
                <b>{selFlag[0]}</b>
              </div>
              <p>{selFlag[1]}</p>
              <dl>
                <div><dt>Harmonised season</dt><dd>{selSeason} <small>VIIRS-eq cell-days · normal {Math.round(d.season_ref).toLocaleString()}</small></dd></div>
                <div><dt>Night share</dt><dd>{selNight} <small>reference {pct(d.night_share_ref, 2)}</small></dd></div>
                <div><dt>Morning ÷ afternoon</dt><dd>{sel.mar.toFixed(3)} <small>reference {d.mar_ref.toFixed(3)}</small></dd></div>
                <div><dt>Pass times measured</dt><dd>{sel.terra_lmst} · {sel.aqua_lmst} <small>Terra · Aqua, local solar hours</small></dd></div>
              </dl>
            </div>
            <p className="fc-fine">A flag says the record may be undercounting because burning moved to unobserved hours. It never multiplies the calendar and it does not say how much burning was missed.</p>
          </div>
        </section>

        <section className="pd-sec">
          <div className="pd-margin"><b>Method</b><span>How the clock is read</span></div>
          <div className="pd-col">
            <ol className="pd-steps">
              {STEPS.map((s) => <li key={s[0]}><b>{s[0]}</b><span>{s[1]}</span></li>)}
            </ol>
            <div className="fc-next">
              <b>Next check</b>
              <span>Geostationary satellites watch every 15 minutes. EUMETSAT's Meteosat Indian Ocean fire product (FRP-Pixel, 3 km, 15 min, 2017 onwards) and ISRO's INSAT-3DR fire points can confirm the hour of burning directly, and burned-area maps can confirm the area.</span>
              <button type="button" className="pd-link" onClick={() => navigate("/blind-spot")}>Open the Blind Spot scenario clock →</button>
            </div>
          </div>
        </section>

        <section className="pd-sec">
          <div className="pd-margin"><b>Where it fits</b><span>Public entries reviewed · 14 Nov 2026</span></div>
          <div className="pd-col">
            <h2>What many projects do, and the one question only this page asks</h2>
            <p>We read the public GitHub entries for this challenge on 14 November 2026. Most good ideas are shared across teams, including ours. The time-of-day question was the one we did not find anywhere else.</p>
            <div className="fc-fit" role="table" aria-label="Ideas across public entries compared with FIREWORK">
              <div className="fc-fit-head" role="row"><span role="columnheader">Idea</span><span role="columnheader">Other public entries</span><span role="columnheader">FIREWORK</span></div>
              {FIT.map((r) => {
                let cls = "fc-fit-row";
                if (r[4]) {
                  cls = "fc-fit-row only";
                }
                return (
                  <div className={cls} role="row" key={r[0]}>
                    <span role="cell"><b>{r[0]}</b><small>{r[1]}</small></span>
                    <span role="cell" className="fc-dots" aria-label={r[2] + " of 5"}>{[1, 2, 3, 4, 5].map((n) => { let c = ""; if (n <= r[2]) { c = "on"; } return <i key={n} className={c} />; })}<em>{FIT_WORD[r[2]]}</em></span>
                    <span role="cell" className="fc-have">{r[3]}</span>
                  </div>
                );
              })}
            </div>
            <p className="fc-fine">Dots show roughly how common an idea was among the entries we could read; it is our reading on one day, not a ranking of anyone's work. “Not found” means we did not find it in a public repository, not that nobody has done it.</p>
          </div>
        </section>
      </>
    );
  }

  return (
    <div className="pd fc">
      <header className="pd-head ph" style={{ "--ph": "var(--model)" }}>
        <div>
          <div className="eyebrow">Explore · Fire Clock</div>
          <h1 className="ph-title">Fire <em>clock</em></h1>
          <p className="ph-q">Is burning falling, or moving out of sight?</p>
          <GuideCue selector=".pd-sec" />
          <p className="pd-lead">Polar-orbiting satellites look at each place at only three times of day. When detections fall, this page asks whether the fires stopped or simply moved to hours the satellites do not watch, using each satellite's own clock as the evidence.</p>
          <div className="fc-clocks">
            {CLOCKS.map((c) => (
              <div key={c[0]} style={{ "--c": c[3] }}>
                <b>{c[0]}</b>
                <span>{c[1]}</span>
                <em>{c[2]}</em>
              </div>
            ))}
          </div>
        </div>
      </header>
      {body}
      <p className="pd-caveat"><b>Not for life-safety decisions.</b> Satellite fire detections have limited accuracy. This page is research decision support built from public NASA data.</p>
    </div>
  );
}
