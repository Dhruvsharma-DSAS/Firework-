import { GuideCue } from "../components/PageGuide.jsx";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import GlobeView from "../components/GlobeView.jsx";
import Badge from "../components/Badge.jsx";
import StatusChip from "../components/StatusChip.jsx";
import { loadDetections, loadSatellites } from "../api/data.js";
import { getMode, ARCHIVE_DATE, LIVE_SOURCES, ARCHIVE_SOURCES } from "../lib/sourceMode.js";
import { PLATFORM_COLORS, PLATFORM_LABELS } from "../lib/colors.js";
import "../styles/pagedoc.css";
import "../styles/sensorlab.css";

const SENSORS = {
  MODIS: { name: "MODIS", pixel: "1 km pixels", sats: "Terra and Aqua", since: "since November 2000", color: "var(--modis)" },
  VIIRS: { name: "VIIRS", pixel: "375 m pixels", sats: "S-NPP, NOAA-20, NOAA-21", since: "since January 2012", color: "var(--viirs)" },
};

const FACTS = [
  ["Pixel size at nadir", "1 km", "375 m", "One MODIS pixel covers about seven VIIRS pixels."],
  ["Satellites", "Terra, Aqua", "S-NPP, NOAA-20, NOAA-21", ""],
  ["Archive starts", "Terra 1 Nov 2000", "S-NPP 20 Jan 2012 · NOAA-20 1 Apr 2018 · NOAA-21 1 Mar 2023", ""],
  ["Local overpass time", "Terra ~10:30 and 22:30 · Aqua ~13:30 and 01:30", "~13:30 and 01:30", "Local solar time = UTC + longitude ÷ 15."],
  ["Confidence scale", "0–100", "low / nominal / high", "Kept as each sensor reports it — never turned into a probability."],
  ["Mission outlook", "Terra science ends Feb 2027 · Aqua Sep 2027 (NASA plans)", "S-NPP new data ends 2 Nov 2026; NOAA-20 and NOAA-21 continue", "Why one ruler matters: MODIS is retiring."],
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const SOURCE_PLATFORMS = { VIIRS_SNPP: ["snpp"], VIIRS_NOAA20: ["noaa20"], VIIRS_NOAA21: ["noaa21"], MODIS: ["terra", "aqua"] };

function niceDate(text) {
  const parts = String(text || "").split("-");
  if (parts.length !== 3) {
    return text;
  }
  return Number(parts[2]) + " " + MONTHS[Number(parts[1]) - 1] + " " + parts[0];
}

function sourceStatus(meta) {
  const out = {};
  if (!meta || !meta.sources) {
    return out;
  }
  meta.sources.forEach((entry) => {
    Object.keys(SOURCE_PLATFORMS).forEach((prefix) => {
      if (String(entry.source).indexOf(prefix + "_") === 0) {
        SOURCE_PLATFORMS[prefix].forEach((id) => {
          out[id] = entry;
        });
      }
    });
  });
  return out;
}

export default function SensorLab() {
  const navigate = useNavigate();
  const [points, setPoints] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [satellites, setSatellites] = useState([]);
  const [sensor, setSensor] = useState("VIIRS");
  const [kRows, setKRows] = useState([]);
  const [kMeta, setKMeta] = useState(null);
  const [kFailed, setKFailed] = useState(false);
  const [hoverMonth, setHoverMonth] = useState(-1);

  useEffect(() => {
    document.title = "Sensor Lab · FIREWORK CHRONOS";
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
    loadSatellites().then((result) => setSatellites(result.data || [])).catch(() => setSatellites([]));
    fetch("/data/world_k.json")
      .then((r) => r.json())
      .then((j) => {
        setKRows(j.data || []);
        setKMeta(j.meta || null);
      })
      .catch(() => setKFailed(true));
  }, []);

  const demo = Boolean(meta && (meta.demo || meta.fallback_used));
  const shown = points.filter((p) => p.sensor === sensor);
  const byPlatform = {};
  let modisN = 0;
  let viirsN = 0;
  points.forEach((p) => {
    if (!byPlatform[p.platform]) {
      byPlatform[p.platform] = { n: 0, frp: 0, night: 0 };
    }
    byPlatform[p.platform].n = byPlatform[p.platform].n + 1;
    byPlatform[p.platform].frp = byPlatform[p.platform].frp + (p.frp || 0);
    if (p.dn === "N") {
      byPlatform[p.platform].night = byPlatform[p.platform].night + 1;
    }
    if (p.sensor === "MODIS") {
      modisN = modisN + 1;
    } else if (p.sensor === "VIIRS") {
      viirsN = viirsN + 1;
    }
  });
  let maxN = 1;
  Object.keys(byPlatform).forEach((k) => {
    if (byPlatform[k].n > maxN) {
      maxN = byPlatform[k].n;
    }
  });

  let status = "LOADING";
  if (!loading && meta) {
    status = meta.status || "ARCHIVE_STANDARD";
  }
  if (!loading && demo) {
    status = "SIMULATED";
  }
  if (failed) {
    status = "UNAVAILABLE";
  }

  let ratio = null;
  let pairV = "";
  ["noaa20", "noaa21", "snpp"].forEach((id) => {
    if (!pairV && byPlatform[id] && byPlatform[id].n > 0) {
      pairV = id;
    }
  });
  if (!loading && pairV && byPlatform.aqua && byPlatform.aqua.n > 0) {
    ratio = <p className="sl-ratio">In this sample, {PLATFORM_LABELS[pairV]} recorded <b>{(byPlatform[pairV].n / byPlatform.aqua.n).toFixed(1)}×</b> as many hot pixels as Aqua MODIS — one satellite against one, both passing at about 13:30. Pixel counts are not the same as cell-days — the exchange rate below is the careful version of this ratio.</p>;
  } else if (!loading && modisN > 0 && viirsN > 0) {
    ratio = <p className="sl-ratio">In this sample, VIIRS recorded <b>{(viirsN / modisN).toFixed(1)}×</b> as many hot pixels as MODIS. Pixel counts are not the same as cell-days — the exchange rate below is the careful version of this ratio.</p>;
  }
  const feed = sourceStatus(meta);

  let note = null;
  if (demo) {
    note = <div className="pd-aside amber sl-note">These detections are the simulated demo set. Switch to Archive or Live in the top bar for real FIRMS pixels. <Badge kind="SIMULATED_DEMO" /></div>;
  } else if (failed) {
    note = <div className="pd-aside red sl-note">The detections could not be loaded. The bars are left empty rather than estimated.</div>;
  }
  if (!demo && meta && meta.sampled && meta.rows_total) {
    note = <p className="sl-sampled">A random sample of {points.length.toLocaleString()} from {meta.rows_total.toLocaleString()} hot pixels returned by FIRMS for the last {meta.day_range} days.</p>;
  }

  let kChart = <p className="sl-none">Loading the exchange rate…</p>;
  if (kFailed) {
    kChart = <p className="sl-none">The exchange-rate file could not be loaded, so nothing is drawn.</p>;
  } else if (kRows.length > 0) {
    const top = 3.5;
    const h = 220;
    const y = (v) => 16 + h - (h * v) / top;
    let hover = <p className="sl-k-read">Hover or tap a month to read its value.</p>;
    if (hoverMonth >= 0) {
      const r = kRows[hoverMonth];
      hover = <p className="sl-k-read"><b>{MONTHS[r.month - 1]}</b> k = <b>{r.k.toFixed(2)}</b> <span>95% band {r.lo.toFixed(2)} – {r.hi.toFixed(2)} · {r.n_years} overlap years</span></p>;
    }
    kChart = (
      <div>
        <svg className="sl-k" viewBox="0 0 640 270" role="img" aria-label="Exchange rate k by calendar month for the whole Earth, with 95 percent bands">
          {[0, 1, 2, 3].map((v) => (
            <g key={v}>
              <line x1="44" x2="632" y1={y(v)} y2={y(v)} className="sl-grid" />
              <text x="34" y={y(v) + 4} className="sl-axis end">{v}</text>
            </g>
          ))}
          <line x1="44" x2="632" y1={y(1)} y2={y(1)} className="sl-one" />
          <text x="630" y={y(1) - 6} className="sl-axis end">k = 1 · both sensors equal</text>
          {kRows.map((r, i) => {
            const x = 70 + i * 49;
            let cls = "sl-kcol";
            if (hoverMonth === i) {
              cls = "sl-kcol on";
            }
            return (
              <g key={r.month} className={cls} onMouseEnter={() => setHoverMonth(i)} onMouseLeave={() => setHoverMonth(-1)} onClick={() => setHoverMonth(i)} style={{ animationDelay: i * 40 + "ms" }}>
                <rect x={x - 22} y="10" width="44" height={h + 10} className="sl-khit" />
                <rect x={x - 9} y={y(r.hi)} width="18" height={Math.max(2, y(r.lo) - y(r.hi))} rx="3" className="sl-band" />
                <line x1={x - 13} x2={x + 13} y1={y(r.k)} y2={y(r.k)} className="sl-kline" />
                <text x={x} y={h + 38} className="sl-axis">{MONTHS[i]}</text>
              </g>
            );
          })}
        </svg>
        {hover}
      </div>
    );
  }

  let kSource = null;
  if (kMeta) {
    kSource = <p className="sl-fine">Whole Earth, overlap years 2012–2025, from the global calendar built {String(kMeta.generated_at_utc).slice(0, 10)}. Band: year-block bootstrap, 95%.</p>;
  }

  return (
    <div className="pd sl">
      <header className="pd-head ph" style={{ "--ph": "var(--viirs)" }}>
        <div>
          <div className="eyebrow">Explore · Sensor Lab</div>
          <h1 className="ph-title">Sensor <em>Lab</em></h1>
          <p className="ph-q">Same Earth, two rulers</p>
          <GuideCue selector=".pd-sec" />
          <p className="pd-lead">MODIS has watched fires since 2000; VIIRS since 2012, with pixels seven times smaller. The same fires look different through each. To join them into one record, FIREWORK measures how much more VIIRS sees — the exchange rate <b>k</b>.</p>
        </div>
        <div className="pd-tags"><StatusChip status={status} /></div>
      </header>

      <div className="sl-switch" role="tablist" aria-label="Choose a sensor">
        {["MODIS", "VIIRS"].map((s) => {
          const info = SENSORS[s];
          let cls = "sl-opt";
          if (sensor === s) {
            cls = "sl-opt on";
          }
          let count = "";
          if (!loading && !failed) {
            if (s === "MODIS") {
              count = modisN.toLocaleString() + " hot pixels";
            } else {
              count = viirsN.toLocaleString() + " hot pixels";
            }
          }
          return (
            <button type="button" role="tab" aria-selected={sensor === s} key={s} className={cls} style={{ "--c": info.color }} onClick={() => setSensor(s)}>
              <span className="sl-opt-name">{info.name}</span>
              <span className="sl-opt-meta">{info.pixel} · {info.sats} · {info.since}</span>
              <span className="sl-opt-count">{count}</span>
            </button>
          );
        })}
      </div>

      <div className="sl-bench">
        <div className="sl-globe" style={{ "--c": SENSORS[sensor].color }}>
          <GlobeView hostId="sensor-globe" points={shown} satellites={satellites.filter((s) => s.instrument === sensor)} layers={{ points: true, density: true, rings: false, borders: true, tracks: true }} colorBy="platform" basemap="dark" autoRotate={true} startLat={5} startLng={20} />
          <div className="sl-globe-cap">{SENSORS[sensor].name} · orbits drawn are the {SENSORS[sensor].sats} ground tracks</div>
        </div>
        <div className="sl-side">
          <h2 className="sl-h">Hot pixels by satellite</h2>
          {note}
          <ul className="sl-bars">
            {Object.keys(PLATFORM_LABELS).map((id, i) => {
              const row = byPlatform[id];
              let n = "—";
              let frp = "";
              let width = 0;
              let nightShare = "";
              const src = feed[id];
              if (!loading && !demo && src && src.rows === 0 && src.latest_date) {
                frp = "No new NASA FIRMS data since " + niceDate(src.latest_date);
              } else if (!loading && !demo && src && src.rows === 0) {
                frp = "NASA FIRMS returned no pixels for this window";
              } else if (!loading && !demo && meta && !src) {
                frp = "Not part of this data mode";
              }
              if (row && row.n > 0) {
                n = row.n.toLocaleString();
                frp = "mean FRP " + (row.frp / row.n).toFixed(1) + " MW";
                width = (100 * row.n) / maxN;
                nightShare = Math.round((100 * row.night) / row.n) + "% at night";
              }
              let cls = "sl-bar";
              if (id === "terra" || id === "aqua") {
                if (sensor !== "MODIS") {
                  cls = "sl-bar dim";
                }
              } else if (sensor !== "VIIRS") {
                cls = "sl-bar dim";
              }
              return (
                <li key={id} className={cls}>
                  <div className="sl-bar-top">
                    <span><i style={{ background: PLATFORM_COLORS[id] }} />{PLATFORM_LABELS[id]}</span>
                    <b>{n}</b>
                  </div>
                  <div className="sl-bar-track"><i style={{ width: width + "%", background: PLATFORM_COLORS[id], animationDelay: i * 60 + "ms" }} /></div>
                  <div className="sl-bar-sub"><span>{frp}</span><span>{nightShare}</span></div>
                </li>
              );
            })}
          </ul>
          {ratio}
          <p className="sl-fine">A satellite with no bar returned no pixels for this period (for example, a feed not requested, or a satellite no longer producing new data). It is left empty, not shown as zero activity.</p>
        </div>
      </div>

      <section className="pd-sec">
        <div className="pd-margin"><b>Exchange rate</b><span>Real archive · whole Earth</span></div>
        <div className="pd-col">
          <h2>VIIRS records two to three times more fire</h2>
          <p>In the years both sensors flew (2012–2025), the whole Earth’s VIIRS S-NPP fire cell-days were divided by MODIS fire cell-days for each calendar month. That ratio, <b>k</b>, converts the MODIS-only years before 2012 onto the VIIRS ruler. The shaded bar is the 95% band; the line is the estimate.</p>
          {kChart}
          {kSource}
          <div className="sl-k-foot">
            <Badge kind="SOURCE_DERIVED" text="Derived from the NASA FIRMS archive" />
            <button type="button" className="pd-link" onClick={() => navigate("/calendar/world")}>Open the whole-Earth calendar</button>
            <button type="button" className="pd-link" onClick={() => navigate("/validation")}>How well k predicts held-out years</button>
          </div>
          <div className="pd-aside sl-pending"><b>Day and night k — pending.</b> Splitting k by day and night passes needs the per-overpass archive run (milestone M3). It stays empty until then; k is never shown without its band.</div>
        </div>
      </section>

      <section className="pd-sec">
        <div className="pd-margin"><b>Fact sheet</b><span>Official NASA documentation</span></div>
        <div className="pd-col">
          <h2>The two instruments side by side</h2>
          <div className="sl-pixels" aria-hidden="true">
            <div className="sl-px modis">
              <div className="sl-px-grid">
                {Array.from({ length: 9 }).map((x, i) => <i key={i} />)}
                <em />
              </div>
              <span>One MODIS pixel, 1 km × 1 km, with VIIRS 375 m pixels laid over it</span>
            </div>
          </div>
          <div className="pd-table-wrap">
            <table className="pd-table sl-facts">
              <thead><tr><th></th><th><i className="sl-sw modis" />MODIS</th><th><i className="sl-sw viirs" />VIIRS</th></tr></thead>
              <tbody>
                {FACTS.map((f) => {
                  let sub = null;
                  if (f[3]) {
                    sub = <small>{f[3]}</small>;
                  }
                  return (
                    <tr key={f[0]}>
                      <td>{f[0]}{sub}</td>
                      <td>{f[1]}</td>
                      <td>{f[2]}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="sl-k-foot"><Badge kind="OFFICIAL_DOCUMENTED" text="NASA FIRMS and mission documentation, checked 27 Oct 2026" /></div>
        </div>
      </section>

      <p className="pd-caveat"><b>Reading the numbers.</b> A hot spot is a pixel, not a fire; a cell-day is not burned area; harmonised values are estimates with a band.</p>
    </div>
  );
}
