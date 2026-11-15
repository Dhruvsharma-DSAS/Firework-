import { useEffect, useState } from "react";
import { loadDetections } from "../api/data.js";
import { LIVE_SOURCES } from "../lib/sourceMode.js";

const BOX = [73.8423, 27.6704, 77.588, 32.5167];
const LON = 75.7;
const C = 300;
const R = 168;
const COLORS = { terra: "#ffb547", aqua: "#ff8a4c", day: "#35cbe8", night: "#a78bfa" };

function pt(hour, radius) {
  const a = (hour / 24) * Math.PI * 2;
  return [C + radius * Math.sin(a), C - radius * Math.cos(a)];
}

function arc(h0, h1, radius) {
  const a = pt(h0, radius);
  const b = pt(h1, radius);
  let large = 0;
  if (h1 - h0 > 12) {
    large = 1;
  }
  return "M" + a[0].toFixed(1) + " " + a[1].toFixed(1) + " A" + radius + " " + radius + " 0 " + large + " 1 " + b[0].toFixed(1) + " " + b[1].toFixed(1);
}

function flame(hour, length) {
  const base0 = pt(hour - 0.42, R + 16);
  const base1 = pt(hour + 0.42, R + 16);
  const mid0 = pt(hour - 0.3, R + 16 + length * 0.55);
  const mid1 = pt(hour + 0.3, R + 16 + length * 0.55);
  const tip = pt(hour, R + 16 + length);
  return "M" + base0.join(" ") + " Q" + mid0.join(" ") + " " + tip.join(" ") + " Q" + mid1.join(" ") + " " + base1.join(" ") + " Z";
}

function clockText(hour) {
  const h = Math.floor(hour);
  const m = Math.floor((hour - h) * 60);
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

function solarNow() {
  const d = new Date();
  const utc = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  return (utc + LON / 15 + 24) % 24;
}

export default function EarthClock(props) {
  const rows = props.rows;
  const [idx, setIdx] = useState(rows.length - 1);
  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState(solarNow());
  const [live, setLive] = useState({ state: "loading", points: [] });

  useEffect(() => {
    const t = setInterval(() => setNow(solarNow()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!playing) {
      return undefined;
    }
    const t = setInterval(() => setIdx((i) => (i + 1) % rows.length), 900);
    return () => clearInterval(t);
  }, [playing, rows.length]);

  useEffect(() => {
    loadDetections(LIVE_SOURCES, 2)
      .then((res) => {
        const meta = res.meta || {};
        if (meta.demo || meta.fallback_used) {
          setLive({ state: "off", points: [] });
          return;
        }
        const inside = (res.data || []).filter((p) => p.lon >= BOX[0] && p.lon <= BOX[2] && p.lat >= BOX[1] && p.lat <= BOX[3] && p.lmst !== null && p.lmst !== undefined);
        setLive({ state: "ok", points: inside });
      })
      .catch(() => setLive({ state: "off", points: [] }));
  }, []);

  const row = rows[idx];
  let max = 1;
  rows.forEach((r) => {
    max = Math.max(max, r.aqua_day, r.snpp_day);
  });
  const hasViirs = row.year >= 2012;
  const passes = [
    { id: "terra", hour: row.terra_lmst, value: row.terra_day, label: "Terra · MODIS", color: COLORS.terra, show: true },
    { id: "aqua", hour: row.aqua_lmst, value: row.aqua_day, label: "Aqua · MODIS", color: COLORS.aqua, show: true },
    { id: "day", hour: 13.5, value: row.snpp_day, label: "VIIRS · day", color: COLORS.day, show: hasViirs },
    { id: "night", hour: 1.5, value: row.snpp_night, label: "VIIRS · night", color: COLORS.night, show: hasViirs },
  ];
  const hours = [0, 3, 6, 9, 12, 15, 18, 21];
  const hand = pt(now, R - 6);
  let nightShare = "VIIRS not launched yet";
  if (row.night_share !== null && row.night_share !== undefined) {
    nightShare = (100 * row.night_share).toFixed(2) + " %";
  }
  let flagText = "Normal clock";
  let flagCls = "ec-flag";
  if (row.flag === "HIDDEN_BURNING_LIKELY") {
    flagText = "Hidden burning likely";
    flagCls = "ec-flag hot";
  } else if (row.flag !== "NORMAL") {
    flagText = "Timing is shifting";
    flagCls = "ec-flag warm";
  }
  let playLabel = "▶ Play the years";
  if (playing) {
    playLabel = "❚❚ Pause";
  }
  let liveLine = "Checking the live NASA feed…";
  if (live.state === "off") {
    liveLine = "Live feed not reachable right now — no live dots are drawn.";
  } else if (live.state === "ok" && live.points.length === 0) {
    liveLine = "Live · no detections here in the last 48 h.";
  } else if (live.state === "ok") {
    liveLine = "Live · " + live.points.length.toLocaleString() + " detections in the last 48 h, each dot placed at the hour it was seen.";
  }

  return (
    <div className="ec">
      <div className="ec-dial">
        <div className="ec-globe" aria-hidden="true"><i /></div>
        <svg viewBox="0 0 600 600" role="img" aria-label={"24-hour fire clock for Punjab and Haryana, season " + row.year}>
          <defs>
            <pattern id="ec-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="rgba(255,255,255,.16)" strokeWidth="2" /></pattern>
            <radialGradient id="ec-fire" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="#fff3c4" /><stop offset="100%" stopColor="#ff5a1f" /></radialGradient>
          </defs>
          <path d={arc(6, 18, R)} className="ec-ring day" />
          <path d={arc(18, 30, R)} className="ec-ring night" />
          <path d={arc(15.6, 24.6, R + 16)} className="ec-blind" stroke="url(#ec-hatch)" />
          <path d={arc(2.6, 8.6, R + 16)} className="ec-blind" stroke="url(#ec-hatch)" />
          <text x={pt(20, R + 62)[0]} y={pt(20, R + 62)[1]} className="ec-blind-t" textAnchor="middle">NO SATELLITE LOOKS</text>
          {hours.map((h) => {
            const a = pt(h, R - 12);
            const b = pt(h, R + 2);
            const t = pt(h, R - 30);
            return (
              <g key={h}>
                <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className="ec-tick" />
                <text x={t[0]} y={t[1] + 4} textAnchor="middle" className="ec-hour">{String(h).padStart(2, "0")}</text>
              </g>
            );
          })}
          {passes.filter((p) => p.show).map((p) => {
            const len = 10 + 96 * Math.sqrt(p.value / max);
            const lab = pt(p.hour, R + 16 + len + 20);
            let side = "middle";
            if (lab[0] > C + 40) {
              side = "start";
            } else if (lab[0] < C - 40) {
              side = "end";
            }
            return (
              <g key={p.id}>
                <path d={arc(p.hour - 0.7, p.hour + 0.7, R + 16)} stroke={p.color} className="ec-watch" />
                {p.value > 0 && <path d={flame(p.hour, len)} fill={p.color} className="ec-flame" />}
                <text x={lab[0]} y={lab[1]} textAnchor={side} className="ec-val" fill={p.color}>{p.value.toLocaleString()}</text>
                <text x={lab[0]} y={lab[1] + 14} textAnchor={side} className="ec-lab">{p.label} · {clockText(p.hour)}</text>
              </g>
            );
          })}
          {live.points.slice(0, 400).map((p, i) => {
            const d = pt(p.lmst, R - 52 - (i % 5) * 7);
            return <circle key={i} cx={d[0]} cy={d[1]} r="3" className="ec-live" />;
          })}
          <line x1={C} y1={C} x2={hand[0]} y2={hand[1]} className="ec-hand" />
          <circle cx={hand[0]} cy={hand[1]} r="5" className="ec-hand-dot" />
        </svg>
        <div className="ec-now"><b>{clockText(now)}</b><span>local solar time now</span></div>
      </div>

      <div className="ec-side">
        <div className="ec-year">
          <span>Burning season</span>
          <b>{row.year}</b>
          <span className={flagCls}>{flagText}</span>
        </div>
        <input type="range" min="0" max={rows.length - 1} value={idx} onChange={(event) => { setPlaying(false); setIdx(Number(event.target.value)); }} aria-label="Season year" />
        <div className="ec-range"><span>{rows[0].year}</span><button type="button" onClick={() => setPlaying(!playing)}>{playLabel}</button><span>{rows[rows.length - 1].year}</span></div>
        <div className="ec-stats">
          <div><span>Seen in the afternoon</span><b style={{ color: COLORS.day }}>{hasViirs && row.snpp_day.toLocaleString()}{!hasViirs && row.aqua_day.toLocaleString()}</b></div>
          <div><span>Seen at night</span><b style={{ color: COLORS.night }}>{hasViirs && row.snpp_night.toLocaleString()}{!hasViirs && "—"}</b></div>
          <div><span>Night share</span><b>{nightShare}</b></div>
        </div>
        <ul className="ec-key">
          <li><i style={{ background: "linear-gradient(#fff3c4,#ff5a1f)" }} /><span><b>Flames</b> show how many fires each satellite pass saw that season. Taller flame, more fires.</span></li>
          <li><i style={{ background: COLORS.day }} /><span><b>Coloured arcs</b> are the only hours a satellite looks: morning, early afternoon and after midnight.</span></li>
          <li><i className="hatch" /><span><b>Hatched hours</b> are never watched. Fires lit there leave no dot in the record.</span></li>
          <li><i style={{ background: "#ff4d5e", borderRadius: "50%" }} /><span><b>Red dots</b> are live NASA detections. <b>The white hand</b> is the time in Punjab right now.</span></li>
        </ul>
        <p className="ec-live-line">{liveLine}</p>
      </div>
    </div>
  );
}
