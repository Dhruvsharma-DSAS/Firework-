import { GuideCue } from "../components/PageGuide.jsx";
import { useEffect, useState } from "react";
import Badge from "../components/Badge.jsx";
import StatusChip from "../components/StatusChip.jsx";
import { loadDetections } from "../api/data.js";
import { getMode, ARCHIVE_DATE, LIVE_SOURCES, ARCHIVE_SOURCES } from "../lib/sourceMode.js";
import { formatHour } from "../lib/geo.js";
import "../styles/pagedoc.css";
import "../styles/blindspot.css";

const WINDOWS = [
  ["Terra", 10.0, 10.8, "var(--modis)", "day"],
  ["Aqua", 13.2, 14.0, "#ff8a3d", "day"],
  ["VIIRS ×3", 13.0, 14.0, "var(--viirs)", "day"],
  ["Terra night", 22.0, 22.8, "var(--modis)", "night"],
  ["Aqua night", 1.2, 2.0, "#ff8a3d", "night"],
  ["VIIRS night", 1.1, 2.0, "var(--viirs)", "night"],
];

const LEGEND = [
  ["var(--modis)", "Terra (MODIS)", "Crosses the equator about 10:30 in the morning and 22:30 at night."],
  ["#ff8a3d", "Aqua (MODIS)", "About 13:30 and 01:30."],
  ["var(--viirs)", "S-NPP, NOAA-20, NOAA-21 (VIIRS)", "Three satellites in the same afternoon orbit, about 13:30 and 01:30."],
];

const PRESETS = [
  [10.5, "10:30", "at the Terra pass"],
  [13.5, "13:30", "at the afternoon passes"],
  [16.5, "16:30", "late afternoon"],
  [18.5, "18:30", "around sunset"],
];

const REASONS = [
  {
    key: "timing",
    title: "Timing",
    lead: "Burning between passes.",
    body: "Polar-orbiting satellites see a given place only a few times a day, always at about the same local solar time. A fire lit after the 13:30 pass and out before the 22:30 pass leaves no trace in the record.",
    act: "Modelled on this page: move the burning peak and watch the share that falls inside the windows.",
  },
  {
    key: "cloud",
    title: "Clouds and smoke",
    lead: "No view of the ground.",
    body: "Thick cloud hides the surface completely, and dense smoke can mask the fire beneath it. A cloudy week looks quiet even if the fields are burning.",
    act: "Counted, not guessed: the calendar divides by clear-view days from MOD14A1 / VNP14A1, so a cloudy month is not mistaken for a quiet one.",
  },
  {
    key: "small",
    title: "Too small or too cool",
    lead: "Below the detection limit.",
    body: "A hot pixel is flagged only when the fire raises the whole pixel’s temperature enough. A small or smouldering fire inside a 1 km MODIS pixel can stay below that threshold.",
    act: "Partly recovered: VIIRS 375 m pixels catch many fires MODIS misses, which is why the exchange rate k is above 1.",
  },
  {
    key: "canopy",
    title: "Under the canopy",
    lead: "Ground fires beneath trees.",
    body: "Low fires burning litter under a closed forest canopy may never be seen from above, especially in the tropics.",
    act: "Cannot be corrected from these satellites. It is stated as a limit, and burned-area products (MCD64A1) are the planned cross-check.",
  },
];

function polar(cx, cy, r, hour) {
  const angle = (hour / 24) * 2 * Math.PI - Math.PI / 2;
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
}

function arcPath(cx, cy, r1, r2, h1, h2) {
  const a = polar(cx, cy, r2, h1);
  const b = polar(cx, cy, r2, h2);
  const c = polar(cx, cy, r1, h2);
  const d = polar(cx, cy, r1, h1);
  return "M" + a[0] + "," + a[1] + " A" + r2 + "," + r2 + " 0 0 1 " + b[0] + "," + b[1] + " L" + c[0] + "," + c[1] + " A" + r1 + "," + r1 + " 0 0 0 " + d[0] + "," + d[1] + " Z";
}

function ReasonIcon(props) {
  if (props.kind === "timing") {
    return <svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="14" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M20 10v10l7 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><path d="M8 7l4 4M32 7l-4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>;
  }
  if (props.kind === "cloud") {
    return <svg viewBox="0 0 40 40" aria-hidden="true"><path d="M11 27a6 6 0 0 1 1-12 8 8 0 0 1 15-2 6 6 0 0 1 3 12z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /><path d="M14 32h14M17 36h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeOpacity="0.6" /></svg>;
  }
  if (props.kind === "small") {
    return <svg viewBox="0 0 40 40" aria-hidden="true"><rect x="6" y="6" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="3 3" /><path d="M20 26c-3 0-4-2-4-4 0-3 3-4 3-7 2 1 5 4 5 7 0 2-1 4-4 4z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>;
  }
  return <svg viewBox="0 0 40 40" aria-hidden="true"><path d="M8 22c0-7 5-12 12-12s12 5 12 12z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /><path d="M20 22v8" stroke="currentColor" strokeWidth="1.4" /><path d="M10 34h20" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /><path d="M24 34c-1.5 0-2-1-2-2 0-1.4 1.4-2 1.4-3.4 1 .5 2.4 1.9 2.4 3.4 0 1-.6 2-1.8 2z" fill="currentColor" /></svg>;
}

export default function BlindSpot() {
  const [points, setPoints] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [peak, setPeak] = useState(16.5);

  useEffect(() => {
    document.title = "Blind Spot · FIREWORK CHRONOS";
    let sources = LIVE_SOURCES;
    let date = "";
    if (getMode() === "archive") {
      sources = ARCHIVE_SOURCES;
      date = ARCHIVE_DATE;
    }
    loadDetections(sources, 2, date)
      .then((result) => {
        setPoints(result.data || []);
        setMeta(result.meta || null);
        setLoading(false);
      })
      .catch(() => {
        setFailed(true);
        setLoading(false);
      });
  }, []);

  const demo = Boolean(meta && (meta.demo || meta.fallback_used));
  const hours = new Array(24).fill(0);
  let counted = 0;
  points.forEach((p) => {
    if (typeof p.lmst !== "number") {
      return;
    }
    const h = Math.floor(p.lmst) % 24;
    hours[h] = hours[h] + 1;
    counted = counted + 1;
  });
  let maxHour = 1;
  hours.forEach((h) => {
    if (h > maxHour) {
      maxHour = h;
    }
  });
  let inWindows = 0;
  [10, 13, 1, 22].forEach((h) => {
    inWindows = inWindows + hours[h];
  });

  const cx = 230;
  const cy = 230;
  const curve = [];
  for (let i = 0; i <= 240; i = i + 1) {
    const hour = (i / 240) * 24;
    let dist = Math.abs(hour - peak);
    if (dist > 12) {
      dist = 24 - dist;
    }
    const g = Math.exp(-0.5 * Math.pow(dist / 1.6, 2));
    const p = polar(cx, cy, 86 + 100 * g, hour);
    curve.push(p[0].toFixed(1) + "," + p[1].toFixed(1));
  }
  let seen = 0;
  [[10.0, 10.8], [13.0, 14.0]].forEach((w) => {
    for (let h = w[0]; h < w[1]; h = h + 0.01) {
      seen = seen + Math.exp(-0.5 * Math.pow((h - peak) / 1.6, 2)) * 0.01;
    }
  });
  const share = (100 * seen) / (1.6 * Math.sqrt(2 * Math.PI));
  const peakDot = polar(cx, cy, 186, peak);

  let verdict = "Most of this burning happens while a satellite is overhead.";
  if (share < 40) {
    verdict = "Much of this burning happens between passes.";
  }
  if (share < 15) {
    verdict = "Almost all of this burning happens while no satellite is looking.";
  }

  let histStatus = "LOADING";
  if (!loading && meta) {
    histStatus = meta.status || "ARCHIVE_STANDARD";
  }
  if (!loading && demo) {
    histStatus = "SIMULATED";
  }
  if (failed) {
    histStatus = "UNAVAILABLE";
  }

  let hist = <div className="bs-wait">Loading hot pixels…</div>;
  if (failed) {
    hist = <p className="bs-none">The detections could not be loaded, so the histogram is left empty rather than estimated.</p>;
  } else if (!loading && counted === 0) {
    hist = <p className="bs-none">No hot pixels with a local solar time were returned for this period.</p>;
  } else if (!loading) {
    hist = (
      <div>
        <svg className="bs-hist" viewBox="0 0 520 210" role="img" aria-label="Hot pixels by local solar hour">
          {[10.5, 13.5, 1.5, 22.5].map((h) => <line key={h} x1={20 + h * 20.4} x2={20 + h * 20.4} y1={8} y2={176} className="bs-pass" />)}
          {hours.map((h, i) => {
            const height = (160 * h) / maxHour;
            let cls = "bs-bar";
            if (i === 10 || i === 13 || i === 1 || i === 22) {
              cls = "bs-bar on";
            }
            return <rect key={i} className={cls} x={22 + i * 20.4} y={176 - height} width="16" height={Math.max(height, 0.5)} rx="2" style={{ animationDelay: i * 18 + "ms" }} />;
          })}
          <line x1="20" x2="512" y1="176.5" y2="176.5" className="bs-axis" />
          {[0, 3, 6, 9, 12, 15, 18, 21].map((h) => <text key={h} x={30 + h * 20.4} y={194} className="bs-tick">{String(h).padStart(2, "0")}</text>)}
          <text x="512" y="208" className="bs-tick end">local solar hour</text>
        </svg>
        <p className="bs-cap"><b>{Math.round((100 * inWindows) / counted)}%</b> of {counted.toLocaleString()} hot pixels fall in the four overpass hours (highlighted). Fires burn at every hour; the satellites record them mostly when they look.</p>
      </div>
    );
  }

  let histNote = null;
  if (demo) {
    histNote = <div className="pd-aside amber bs-note">These are the simulated demo detections. Switch to Archive or Live in the top bar for real FIRMS pixels. <Badge kind="SIMULATED_DEMO" /></div>;
  }

  return (
    <div className="pd bs">
      <header className="pd-head ph" style={{ "--ph": "var(--modis)" }}>
        <div>
          <div className="eyebrow">Explore · Blind Spot</div>
          <h1 className="ph-title">Blind <em>spot</em></h1>
          <p className="ph-q">When can the satellites not see?</p>
          <GuideCue selector=".pd-sec" />
          <p className="pd-lead">MODIS and VIIRS fly in polar orbits. They pass over each place at almost the same local time every day, so a fire is recorded only if it is burning — and visible — at that moment. This page shows how much burning can fall through the gaps.</p>
        </div>
      </header>

      <section className="pd-sec">
        <div className="pd-margin"><b>Why</b><span>Four reasons fires go unseen</span></div>
        <div className="pd-col">
          <h2>A missing hot pixel is not a missing fire</h2>
          <div className="bs-reasons">
            {REASONS.map((r, i) => (
              <article key={r.key} className="bs-reason" style={{ animationDelay: i * 70 + "ms" }}>
                <div className="bs-icon"><ReasonIcon kind={r.key} /></div>
                <h3>{r.title}</h3>
                <p className="bs-reason-lead">{r.lead}</p>
                <p>{r.body}</p>
                <p className="bs-act">{r.act}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="pd-sec">
        <div className="pd-margin"><b>Try it</b><span>The overpass clock</span></div>
        <div className="pd-col">
          <h2>Slide the burning peak around the clock</h2>
          <p>Imagine fires in one region all burn at about the same time of day. Move that peak and see how much of the burning a satellite is overhead for.</p>
          <div className="bs-lab">
            <figure className="bs-clock">
              <svg viewBox="0 0 460 460" role="img" aria-label={"24-hour overpass clock. Peak at " + formatHour(peak) + ", " + share.toFixed(0) + "% of the curve inside day windows."}>
                <defs>
                  <radialGradient id="bs-night" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="rgba(143,125,255,0)" />
                    <stop offset="100%" stopColor="rgba(143,125,255,0.08)" />
                  </radialGradient>
                </defs>
                <path d={arcPath(cx, cy, 86, 196, 18, 24)} fill="url(#bs-night)" />
                <path d={arcPath(cx, cy, 86, 196, 0, 6)} fill="url(#bs-night)" />
                <circle cx={cx} cy={cy} r={196} fill="none" className="bs-ring" />
                <circle cx={cx} cy={cy} r={86} fill="none" className="bs-ring soft" />
                {Array.from({ length: 24 }).map((x, h) => {
                  const a = polar(cx, cy, 196, h);
                  const b = polar(cx, cy, 189, h);
                  return <line key={h} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className="bs-ring" />;
                })}
                {WINDOWS.map((w) => <path key={w[0]} d={arcPath(cx, cy, 86, 196, w[1], w[2])} fill={w[3]} className={"bs-win " + w[4]} />)}
                <polyline points={curve.join(" ")} className="bs-curve" />
                <circle cx={peakDot[0]} cy={peakDot[1]} r="5" className="bs-peak" />
                {[0, 3, 6, 9, 12, 15, 18, 21].map((h) => {
                  const p = polar(cx, cy, 214, h);
                  return <text key={h} x={p[0]} y={p[1] + 4} className="bs-hour">{String(h).padStart(2, "0")}</text>;
                })}
                <text x={cx} y={cy - 4} className="bs-big">{share.toFixed(0)}%</text>
                <text x={cx} y={cy + 18} className="bs-small">inside day windows</text>
              </svg>
            </figure>

            <div className="bs-controls">
              <div className="bs-readout">
                <span>Burning peak</span>
                <b>{formatHour(peak)}</b>
                <em>local solar time</em>
              </div>
              <label className="bs-range">
                <span className="pd-sr">Burning peak, local solar hour</span>
                <input type="range" min="8" max="20" step="0.1" value={peak} onChange={(event) => setPeak(Number(event.target.value))} style={{ "--p": ((peak - 8) / 12) * 100 + "%" }} />
                <span className="bs-range-ticks" aria-hidden="true"><i>08</i><i>11</i><i>14</i><i>17</i><i>20</i></span>
              </label>
              <div className="bs-presets">
                {PRESETS.map((p) => {
                  let cls = "bs-preset";
                  if (Math.abs(peak - p[0]) < 0.05) {
                    cls = "bs-preset on";
                  }
                  return <button type="button" key={p[1]} className={cls} onClick={() => setPeak(p[0])}><b>{p[1]}</b><span>{p[2]}</span></button>;
                })}
              </div>
              <p className="bs-verdict">{verdict} Only <b>{share.toFixed(0)}%</b> of the curve falls inside a daytime window; the other <b>{(100 - share).toFixed(0)}%</b> is burning no satellite records.</p>
              <div className="bs-scenario"><Badge kind="PROPOSED_UNVALIDATED" text="Scenario, not a measurement" /></div>
            </div>
          </div>

          <h3 className="bs-h3">How to read the clock</h3>
          <dl className="bs-legend">
            <div><dt><i className="bs-sw ring" /></dt><dd><b>The ring is one day</b> in local solar time — midnight at the top, noon at the bottom. Local solar time is UTC plus longitude ÷ 15, so 13:30 means early afternoon wherever you are.</dd></div>
            {LEGEND.map((l) => <div key={l[1]}><dt><i className="bs-sw" style={{ background: l[0] }} /></dt><dd><b>{l[1]}.</b> {l[2]}</dd></div>)}
            <div><dt><i className="bs-sw curve" /></dt><dd><b>The dashed curve</b> is an imagined daily burning pattern — a bell shape about 1.6 hours wide around the peak you choose.</dd></div>
            <div><dt><i className="bs-sw pct">%</i></dt><dd><b>The number in the middle</b> is the share of that curve that falls inside the two daytime windows — the part a satellite could record on a clear day.</dd></div>
          </dl>
          <p className="bs-fine">Window widths are approximate. The exact viewing time at a place shifts by up to about an hour with its position across the satellite’s swath.</p>
        </div>
      </section>

      <section className="pd-sec">
        <div className="pd-margin"><b>Evidence</b><span>From the detections</span></div>
        <div className="pd-col">
          <div className="bs-hist-head">
            <h2>Hot pixels pile up at overpass hours</h2>
            <StatusChip status={histStatus} />
          </div>
          <p>Each bar counts hot pixels recorded in that hour of local solar time. If satellites watched all day, the bars would follow the burning. Instead they spike when the satellites look.</p>
          {histNote}
          {hist}
        </div>
      </section>

      <section className="pd-sec">
        <div className="pd-margin"><b>Next</b><span>Planned check</span></div>
        <div className="pd-col">
          <div className="bs-pending">
            <div>
              <b>Burned area versus detections</b>
              <span>Compares MCD64A1 burned-area maps with hot-pixel counts to flag regions where fires burn but are rarely detected.</span>
            </div>
            <span className="bs-pill">Pending · needs the MCD64A1 run</span>
          </div>
        </div>
      </section>

      <p className="pd-caveat"><b>Not for life-safety decisions.</b> Satellite fire detections have limited accuracy and miss fires under cloud, between passes, or below detection size. This is research decision support, not an alert system.</p>
    </div>
  );
}
