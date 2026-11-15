import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import FleetView from "../components/FleetView.jsx";
import SatViewer from "../components/SatViewer.jsx";
import { loadCalendar } from "../api/data.js";
import { fetchJson } from "../api/client.js";
import { PLATFORM_COLORS } from "../lib/colors.js";
import "../styles/pagedoc.css";
import "../styles/satellites.css";

const MODIS = { name: "MODIS", full: "Moderate Resolution Imaging Spectroradiometer", pixel: "1 km", swath: "2,330 km", bands: "36 bands, 0.4–14.4 µm", fire: "bands 21/22 (3.96 µm) and 31 (11.0 µm)", product: "MOD14 / MYD14, Collection 6.1" };
const VIIRS = { name: "VIIRS", full: "Visible Infrared Imaging Radiometer Suite", pixel: "375 m", swath: "3,040 km", bands: "22 bands, 0.41–12.5 µm", fire: "I-bands I4 (3.74 µm) and I5 (11.45 µm)", product: "VNP14IMG / VJ114IMG / VJ214IMG" };

const STORY = {
  terra: {
    tag: "MODIS · the morning eye", sensor: MODIS, others: "ASTER, CERES, MISR, MOPITT", img: "/img/sats/terra.webp", sheets: [["/img/sheets/terra_sheet.webp", "Terra · instrument layout"], ["/img/sheets/terra_xray.webp", "Terra · x-ray view"], ["/img/sheets/modis_cutaway.webp", "MODIS cutaway · scan mirror, telescope, detectors"]],
    lead: "Terra is where the satellite fire record begins. Since November 2000 its MODIS has crossed every place on Earth in the late morning and again late at night, flagging every 1 km pixel that is clearly hotter than its neighbours.",
    role: "For FIREWORK, Terra is half of the long MODIS history. Its morning pass catches fires that start early and are out before the afternoon satellites arrive, which is one reason MODIS (two satellites) can outcount a single VIIRS in some months. Terra has drifted to an earlier crossing time since 2022 and is planned to end science in 2027, which is why the 2012–2025 overlap must be used now.",
    facts: [["Fires it sees best", "Large, hot fires; smaller fires when the pixel is near nadir"], ["Weak spot", "Small and cool fires inside a 1 km pixel are diluted and missed"], ["Data in FIREWORK", "MODIS fire cell-days 2000–2025, together with Aqua"]],
  },
  aqua: {
    tag: "MODIS · the afternoon eye", sensor: MODIS, others: "AIRS, AMSU-A, CERES, AMSR-E", img: "/img/sats/aqua.webp", sheets: [["/img/sheets/modis_cutaway.webp", "MODIS cutaway · the same instrument as on Terra"], ["/img/aqua_hero.webp", "Aqua over the night side of Earth"]],
    lead: "Aqua carries a second MODIS on an afternoon orbit, crossing the equator around 13:30 local solar time — the same moment as the VIIRS satellites. Since July 2002 it has given MODIS a second look at every fire every day.",
    role: "Aqua is the key partner for harmonisation. Because it passes at the same time as Suomi NPP, the two instruments watch the same fires within minutes. Matching those passes shows that Aqua detects only 22 % of the fires S-NPP sees, and needs about 35.6 MW of fire power to catch half of them: the physical reason behind the exchange rate k.",
    facts: [["Matched with S-NPP", "22 % of S-NPP fires also detected by Aqua"], ["Half-detection power (FRP₅₀)", "≈ 35.6 MW"], ["Data in FIREWORK", "MODIS fire cell-days 2002–2025, together with Terra"]],
  },
  snpp: {
    tag: "VIIRS · today's ruler", sensor: VIIRS, others: "ATMS, CrIS, OMPS, CERES", img: "/img/sats/snpp.webp", sheets: [["/img/sheets/npp_xray.webp", "Suomi NPP · x-ray view"], ["/img/sheets/viirs_cutaway.webp", "VIIRS cutaway · rotating telescope and detectors"], ["/img/sheets/viirs_sheet_a.webp", "VIIRS · imaging bands"]],
    lead: "Suomi NPP brought VIIRS in January 2012: fire pixels of 375 m, about seven times smaller in area than MODIS. Small crop-residue fires that disappear in a 1 km pixel stand out clearly in a 375 m one.",
    role: "Suomi NPP is the reference ruler. Every harmonised value in FIREWORK is expressed in S-NPP fire cell-days, and k is learned from the years S-NPP and MODIS flew together (2012–2025). NASA FIRMS has had no new S-NPP near-real-time data since 2 November 2026; its standard archive keeps the full 2012–2026 record.",
    facts: [["Fires it sees best", "Small and cool fires, down to a few MW"], ["Median fire it detects", "≈ 5.3 MW"], ["Data in FIREWORK", "VIIRS fire cell-days 2012–2025; the k reference"]],
  },
  noaa20: {
    tag: "VIIRS · the live feed", sensor: VIIRS, others: "ATMS, CrIS, OMPS, CERES", img: "/img/sats/noaa20.webp", sheets: [["/img/sheets/viirs_sheet_b.webp", "VIIRS · fire bands I4 and I5"], ["/img/sheets/viirs_cutaway.webp", "The same VIIRS design as on Suomi NPP"]],
    lead: "NOAA-20 (launched as JPSS-1 in 2017) carries an identical VIIRS in the same afternoon orbit as Suomi NPP, about half an orbit apart, so the same place is seen twice within an hour.",
    role: "NOAA-20 is the backbone of the live Explorer today: most near-real-time hot pixels on the 3D globe come from it. In the calendar it is kept as a separate series (from April 2018) so the S-NPP reference stays one consistent instrument.",
    facts: [["In the live view", "Most of the hot pixels on the Explorer globe"], ["FIRMS archive", "From 1 April 2018"], ["Data in FIREWORK", "Live NRT detections; separate calendar series"]],
  },
  noaa21: {
    tag: "VIIRS · the newest eye", sensor: VIIRS, others: "ATMS, CrIS, OMPS", img: "/img/sats/noaa21.webp", sheets: [["/img/sheets/viirs_sheet_c.webp", "VIIRS · day–night band and imaging bands"], ["/img/sheets/viirs_cutaway.webp", "VIIRS cutaway"]],
    lead: "NOAA-21 (launched as JPSS-2 in November 2022) is the newest VIIRS in the afternoon constellation. With NOAA-20 and Suomi NPP it means three looks at every place in the early afternoon.",
    role: "NOAA-21 joined the live Explorer in November 2026 and will carry the VIIRS record forward after MODIS ends. Its archive is still short (standard processing from March 2023), so it is not yet part of the k calibration.",
    facts: [["In the live view", "Added to the Explorer in November 2026"], ["FIRMS archive", "Standard processing from 1 March 2023"], ["Data in FIREWORK", "Live NRT detections; future calibration"]],
  },
};

const ORDER = ["terra", "aqua", "snpp", "noaa20", "noaa21"];
const LIFE = { terra: [1999.96, 2027.1, false], aqua: [2002.34, 2027.7, false], snpp: [2011.82, 2026.84, false], noaa20: [2017.88, 2028.5, true], noaa21: [2022.86, 2028.5, true] };

function Timeline(props) {
  const W = 720;
  const H = 210;
  const x0 = 1999;
  const x1 = 2029;
  const px = (y) => 110 + ((y - x0) / (x1 - x0)) * (W - 130);
  const ticks = [2000, 2005, 2010, 2015, 2020, 2025];
  return (
    <svg viewBox={"0 0 " + W + " " + H} className="sat-chart" role="img" aria-label="Mission timeline of the five satellites">
      <rect x={px(2012)} y={8} width={px(2026) - px(2012)} height={H - 40} fill="rgba(56,232,255,0.06)" />
      <text x={px(2012) + 4} y={20} className="sat-ax">overlap 2012–2025</text>
      {ticks.map((t) => <g key={t}><line x1={px(t)} x2={px(t)} y1={24} y2={H - 30} className="sat-grid" /><text x={px(t)} y={H - 12} textAnchor="middle" className="sat-ax">{t}</text></g>)}
      {ORDER.map((id, i) => {
        const life = LIFE[id];
        const y = 34 + i * 30;
        let op = 0.35;
        if (props.sel === id) {
          op = 1;
        }
        let tail = null;
        if (life[2]) {
          tail = <text x={px(life[1]) + 4} y={y + 12} className="sat-ax">→</text>;
        }
        return (
          <g key={id} opacity={op}>
            <text x={8} y={y + 12} className="sat-lab">{props.names[id]}</text>
            <rect x={px(life[0])} y={y} width={px(life[1]) - px(life[0])} height={16} rx={4} fill={PLATFORM_COLORS[id]} />
            {tail}
          </g>
        );
      })}
    </svg>
  );
}

function YearBars(props) {
  const W = 720;
  const H = 200;
  const rows = props.rows.filter((r) => r[1] !== null);
  if (rows.length === 0) {
    return <p className="sat-none">{props.empty}</p>;
  }
  const max = Math.max.apply(null, rows.map((r) => r[1])) || 1;
  const bw = (W - 70) / props.rows.length;
  return (
    <svg viewBox={"0 0 " + W + " " + H} className="sat-chart" role="img" aria-label={props.label}>
      {[0.5, 1].map((f) => <g key={f}><line x1={56} x2={W - 6} y1={H - 26 - f * (H - 46)} y2={H - 26 - f * (H - 46)} className="sat-grid" /><text x={50} y={H - 22 - f * (H - 46)} textAnchor="end" className="sat-ax">{Math.round((f * max) / 1000)}k</text></g>)}
      {props.rows.map((r, i) => {
        if (r[1] === null) {
          return null;
        }
        const h = (r[1] / max) * (H - 46);
        let label = null;
        if (r[0] % 5 === 0) {
          label = <text x={60 + i * bw + bw / 2} y={H - 8} textAnchor="middle" className="sat-ax">{r[0]}</text>;
        }
        return (
          <g key={r[0]}>
            <rect x={60 + i * bw + 1} y={H - 26 - h} width={bw - 2} height={h} rx={2} fill={props.color}><title>{r[0] + ": " + Math.round(r[1]).toLocaleString() + " fire cell-days"}</title></rect>
            {label}
          </g>
        );
      })}
    </svg>
  );
}

export default function Satellites() {
  const navigate = useNavigate();
  const [sats, setSats] = useState([]);
  const [sel, setSel] = useState("snpp");
  const [focus, setFocus] = useState("");
  const [world, setWorld] = useState(null);

  useEffect(() => {
    document.title = "Satellites · FIREWORK CHRONOS";
    fetchJson("/data/satellites.json").then((r) => setSats(r.data || [])).catch(() => setSats([]));
    loadCalendar("world").then((r) => setWorld(r.data)).catch(() => setWorld(null));
  }, []);

  const names = {};
  sats.forEach((s) => {
    names[s.id] = s.name;
  });
  ORDER.forEach((id) => {
    if (!names[id]) {
      names[id] = id;
    }
  });
  const sat = sats.find((s) => s.id === sel);
  let wholeCls = "mc-whole";
  if (focus === "") {
    wholeCls = "mc-whole on";
  }
  const story = STORY[sel];

  let series = [];
  let seriesLabel = "";
  let empty = "";
  if (world) {
    series = world.years.map((y, i) => {
      let row = world.modis[i];
      if (sel === "snpp") {
        row = world.viirs[i];
      } else if (sel === "noaa20") {
        row = (world.platforms && world.platforms.noaa20 && world.platforms.noaa20[i]) || [];
      } else if (sel === "noaa21") {
        row = [];
      }
      let total = null;
      row.forEach((v) => {
        if (v !== null && v !== undefined) {
          total = (total || 0) + v;
        }
      });
      return [y, total];
    });
    seriesLabel = "MODIS fire cell-days per year, whole Earth (Terra and Aqua together)";
    if (sel === "snpp") {
      seriesLabel = "VIIRS S-NPP fire cell-days per year, whole Earth";
    } else if (sel === "noaa20") {
      seriesLabel = "NOAA-20 VIIRS fire cell-days per year, whole Earth (separate series)";
    }
    empty = "NOAA-21 has no full archive years in the FIREWORK calendar yet; its detections appear live on the Explorer.";
  }

  let specs = [];
  if (sat && story) {
    const o = sat.illustrative_orbit || {};
    specs = [
      ["Launch", sat.launch],
      ["Orbit", (o.altitude_km || "—") + " km · sun-synchronous · " + (o.inclination_deg || "—") + "° · " + (o.period_min || "—") + " min"],
      ["Equator crossing", sat.crossing],
      ["Fire instrument", story.sensor.name + " — " + story.sensor.full],
      ["Fire pixel", story.sensor.pixel],
      ["Swath", story.sensor.swath],
      ["Bands", story.sensor.bands],
      ["Fire bands", story.sensor.fire],
      ["Fire product", story.sensor.product],
      ["In NASA FIRMS since", sat.firms_start],
      ["Mission outlook", sat.end_plan || "continuing"],
      ["Other instruments", story.others],
    ];
  }

  const idx = ORDER.indexOf(sel);
  const prevId = ORDER[(idx + ORDER.length - 1) % ORDER.length];
  const nextId = ORDER[(idx + 1) % ORDER.length];
  function pick(id) {
    setSel(id);
    setFocus(id);
  }
  let hud = null;
  if (sat && story) {
    const o = sat.illustrative_orbit || {};
    hud = (
      <div className="fleet-hud" style={{ "--c": PLATFORM_COLORS[sel] }}>
        <span className="fleet-hud-k">{story.tag}</span>
        <b>{names[sel]}</b>
        <div className="fleet-hud-stats">
          <div><span>Altitude</span><b>{o.altitude_km || "—"} km</b></div>
          <div><span>Fire pixel</span><b>{story.sensor.pixel}</b></div>
          <div><span>Swath</span><b>{story.sensor.swath}</b></div>
          <div><span>Launched</span><b>{String(sat.launch || "").slice(0, 4)}</b></div>
        </div>
      </div>
    );
  }

  return (
    <div className="page sat-page">
      <header className="ph" style={{ "--ph": "var(--viirs)" }}>
        <div className="eyebrow">Learn · The satellites</div>
        <h1 className="ph-title">The fire <em>fleet</em></h1>
        <p className="ph-q">Five satellites, two sensors, one record</p>
      </header>
      <p className="lead">Every number on FIREWORK comes from five polar-orbiting satellites: two carry MODIS, three carry VIIRS. Fly around them in 3D, open each one up, and see exactly what it adds to 25 years of fire records.</p>

      <section className="mc" aria-label="Fleet mission control">
        <div className="mc-stage">
          <div className="fleet-frame"><FleetView focus={focus} /></div>
          <span className="mc-tag"><i />Live orbits · drag to turn · scroll to zoom</span>
          <button type="button" className={wholeCls} onClick={() => setFocus("")}>Whole fleet</button>
          {hud}
        </div>
        <div className="mc-roster">
          <span className="mc-roster-k">Choose a satellite</span>
          {ORDER.map((id) => {
            const s2 = sats.find((x) => x.id === id);
            let cls = "roster-card";
            if (sel === id) {
              cls = "roster-card on";
            }
            let year = "";
            if (s2) {
              year = String(s2.launch || "").slice(0, 4);
            }
            return (
              <button key={id} type="button" className={cls} style={{ "--c": PLATFORM_COLORS[id] }} onClick={() => pick(id)}>
                <img src={STORY[id].img} alt="" />
                <span className="roster-text">
                  <b>{names[id]}</b>
                  <small>{STORY[id].tag}</small>
                  <span className="roster-meta"><em>{STORY[id].sensor.name}</em><span>{year}</span><span>{STORY[id].sensor.pixel}</span></span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {story && (
        <section className="sat-detail" style={{ "--c": PLATFORM_COLORS[sel] }} aria-label={names[sel] + " in detail"}>
          <div className="sat-rail">
            <button type="button" className="sat-arrow" onClick={() => pick(prevId)} aria-label={"Previous: " + names[prevId]}>
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M20 12H5M11 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <div className="sat-rail-list">
              {ORDER.map((id) => {
                let cls = "sat-rail-item";
                if (id === sel) {
                  cls = "sat-rail-item on";
                }
                return (
                  <button key={id} type="button" className={cls} style={{ "--c": PLATFORM_COLORS[id] }} onClick={() => pick(id)} aria-pressed={id === sel}>
                    <img src={STORY[id].img} alt="" />
                    <span><b>{names[id]}</b><small>{STORY[id].sensor.name} · {STORY[id].sensor.pixel}</small></span>
                  </button>
                );
              })}
            </div>
            <button type="button" className="sat-arrow" onClick={() => pick(nextId)} aria-label={"Next: " + names[nextId]}>
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>

          <div className="sat-head">
            <div>
              <span className="sat-kicker">{story.tag}</span>
              <h3>{names[sel]}</h3>
              <p>{story.lead}</p>
            </div>
            <div className="sat-quick">
              {specs.filter((r, i) => [0, 1, 2, 4, 5, 9].indexOf(i) >= 0).map((r) => <div key={r[0]}><span>{r[0]}</span><b>{r[1]}</b></div>)}
            </div>
          </div>

          <div className="sat-box sat-studio">
            <span className="sat-box-k">3D model · drag to turn · pick a part to pull it out</span>
            <SatViewer key={sel} satId={sel} name={names[sel]} role={story.tag} />
          </div>

          <div className="sat-two">
            <div className="sat-hero">
              <img src={story.img} alt={names[sel] + " rendered from the FIREWORK 3D model"} />
              <span className="sat-hero-cap">{names[sel]} · rendered from the FIREWORK 3D model</span>
            </div>
            <div className="sat-box">
              <span className="sat-box-k">Specifications</span>
              <table className="sat-spec">
                <tbody>{specs.map((r) => <tr key={r[0]}><th>{r[0]}</th><td>{r[1]}</td></tr>)}</tbody>
              </table>
            </div>
          </div>

          <div className="sat-box sat-role">
            <span className="sat-box-k">What it does for FIREWORK</span>
            <p>{story.role}</p>
            <div className="sat-facts">
              {story.facts.map((f) => <div key={f[0]}><span>{f[0]}</span><b>{f[1]}</b></div>)}
            </div>
          </div>

          <div className="sat-two even">
            <div className="sat-box">
              <span className="sat-box-k">Mission timeline</span>
              <Timeline sel={sel} names={names} />
              <p className="sat-cap">Bars run from launch to the planned end of science (Terra, Aqua) or the last FIRMS near-real-time data (S-NPP). Arrows: still flying.</p>
            </div>
            <div className="sat-box">
              <span className="sat-box-k">Fires its sensor recorded</span>
              <YearBars rows={series} color={PLATFORM_COLORS[sel]} label={seriesLabel} empty={empty} />
              <p className="sat-cap">{seriesLabel} · FIREWORK calendar from the NASA FIRMS standard archive. 2000 and the last year are partial.</p>
            </div>
          </div>

          <div className="sat-box">
            <span className="sat-box-k">Images</span>
            <div className="sat-sheets">
              {story.sheets.map((s3) => <figure key={s3[0]}><img src={s3[0]} alt={s3[1]} loading="lazy" /><figcaption>{s3[1]}</figcaption></figure>)}
            </div>
          </div>

          <div className="sat-links">
            <button type="button" className="pd-btn" onClick={() => navigate("/sensors")}>Compare MODIS and VIIRS in the Sensor Lab →</button>
            <button type="button" className="pd-btn" onClick={() => navigate("/explore")}>See its fires live on the Explorer →</button>
            <button type="button" className="pd-btn" onClick={() => navigate("/learn#lesson-07")}>Lesson 07 · Meet the satellites →</button>
          </div>
        </section>
      )}
    </div>
  );
}
