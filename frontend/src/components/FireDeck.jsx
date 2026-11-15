import { useEffect, useState } from "react";
import { loadCalendar } from "../api/data.js";

const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const W = 288;
const H = 120;

function fmt(v) {
  if (v >= 1000000) {
    return (v / 1000000).toFixed(1) + "M";
  }
  if (v >= 1000) {
    return Math.round(v / 1000) + "k";
  }
  return String(Math.round(v));
}

function pathOf(pts) {
  let d = "";
  pts.forEach((p, i) => {
    let cmd = "L";
    if (i === 0) {
      cmd = "M";
    }
    d = d + cmd + p[0].toFixed(1) + " " + p[1].toFixed(1) + " ";
  });
  return d.trim();
}

function seasonChart(data) {
  const sums = new Array(12).fill(0);
  const counts = new Array(12).fill(0);
  data.modis.forEach((row) => row.forEach((v, m) => {
    if (v !== null) {
      sums[m] = sums[m] + v;
      counts[m] = counts[m] + 1;
    }
  }));
  const avg = sums.map((s, m) => s / Math.max(1, counts[m]));
  const max = Math.max(...avg, 1);
  let peak = 0;
  avg.forEach((v, m) => {
    if (v > avg[peak]) {
      peak = m;
    }
  });
  const pts = avg.map((v, m) => [10 + (m * (W - 20)) / 11, H - 18 - (v / max) * (H - 34)]);
  const line = pathOf(pts);
  const area = line + " L" + pts[11][0] + " " + (H - 18) + " L" + pts[0][0] + " " + (H - 18) + " Z";
  return {
    title: "The fire season",
    sub: "Average year, month by month · MODIS",
    note: "Peak: " + MONTH_NAMES[peak] + " · " + fmt(avg[peak]) + " fire cell-days",
    svg: (
      <svg viewBox={"0 0 " + W + " " + H} className="fd-svg">
        <defs>
          <linearGradient id="fd-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ff7a3d" stopOpacity="0.55" />
            <stop offset="1" stopColor="#ff7a3d" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#fd-area)" className="fd-grow" />
        <path d={line} fill="none" stroke="#ffb547" strokeWidth="2" strokeLinejoin="round" className="fd-draw" />
        <circle cx={pts[peak][0]} cy={pts[peak][1]} r="4" fill="#ffe8aa" className="fd-pop" />
        {MONTHS.map((m, i) => <text key={i} x={pts[i][0]} y={H - 4} className="fd-ax">{m}</text>)}
      </svg>
    ),
  };
}

function yearsChart(data) {
  const rows = data.years.map((y, i) => {
    let m = 0;
    let v = 0;
    let vOk = false;
    data.modis[i].forEach((x) => {
      if (x !== null) {
        m = m + x;
      }
    });
    if (data.viirs && data.viirs[i]) {
      data.viirs[i].forEach((x) => {
        if (x !== null) {
          v = v + x;
          vOk = true;
        }
      });
    }
    return { y: y, m: m, v: v, vOk: vOk, full: data.modis[i].every((x) => x !== null) };
  }).filter((r) => r.full);
  const max = Math.max(...rows.map((r) => Math.max(r.m, r.v)), 1);
  const bw = (W - 20) / rows.length;
  const vPts = [];
  rows.forEach((r, i) => {
    if (r.vOk) {
      vPts.push([10 + i * bw + bw / 2, H - 18 - (r.v / max) * (H - 30)]);
    }
  });
  const vLine = pathOf(vPts);
  return {
    title: "25 years on record",
    sub: "Fire cell-days per full year · MODIS bars, VIIRS line",
    note: rows[0].y + " – " + rows[rows.length - 1].y + " · VIIRS sees about 2–3× more",
    svg: (
      <svg viewBox={"0 0 " + W + " " + H} className="fd-svg">
        {rows.map((r, i) => {
          const h = (r.m / max) * (H - 30);
          return <rect key={r.y} x={10 + i * bw + 1} y={H - 18 - h} width={Math.max(1, bw - 2)} height={h} rx="1.5" fill="#ffb547" className="fd-bar" style={{ animationDelay: i * 25 + "ms" }} />;
        })}
        <path d={vLine} fill="none" stroke="#3dd6f5" strokeWidth="2" className="fd-draw" />
        <text x="10" y={H - 4} className="fd-ax fd-left">{rows[0].y}</text>
        <text x={W - 10} y={H - 4} className="fd-ax fd-right">{rows[rows.length - 1].y}</text>
      </svg>
    ),
  };
}

function kChart(data) {
  const kb = data.k_baseline || {};
  const ks = [];
  for (let m = 1; m <= 12; m = m + 1) {
    if (kb[String(m)]) {
      ks.push({ m: m - 1, k: kb[String(m)].k, lo: kb[String(m)].lo, hi: kb[String(m)].hi });
    }
  }
  if (ks.length < 6) {
    return null;
  }
  const max = Math.max(...ks.map((x) => x.hi), 1) * 1.1;
  const bw = (W - 20) / 12;
  const y = (v) => H - 18 - (v / max) * (H - 30);
  return {
    title: "Exchange rate k",
    sub: "VIIRS ÷ MODIS by month · 95 % band",
    note: "One ruler for 25 years: MODIS × k",
    svg: (
      <svg viewBox={"0 0 " + W + " " + H} className="fd-svg">
        <line x1="10" x2={W - 10} y1={y(1)} y2={y(1)} className="fd-ref" />
        <text x={W - 10} y={y(1) - 3} className="fd-ax fd-right">k = 1</text>
        {ks.map((x, i) => {
          const cx = 10 + x.m * bw + bw / 2;
          return (
            <g key={x.m} className="fd-bar" style={{ animationDelay: i * 40 + "ms" }}>
              <rect x={cx - bw * 0.3} y={y(x.k)} width={bw * 0.6} height={H - 18 - y(x.k)} rx="2" fill="#3dd6f5" opacity="0.85" />
              <line x1={cx} x2={cx} y1={y(x.hi)} y2={y(x.lo)} stroke="#e6edf3" strokeWidth="1.2" />
            </g>
          );
        })}
        {MONTHS.map((m, i) => <text key={i} x={10 + i * bw + bw / 2} y={H - 4} className="fd-ax">{m}</text>)}
      </svg>
    ),
  };
}

function topChart(data) {
  const all = [];
  data.years.forEach((yr, i) => data.modis[i].forEach((v, m) => {
    if (v !== null) {
      all.push({ label: MONTH_NAMES[m] + " " + yr, v: v });
    }
  }));
  all.sort((a, b) => b.v - a.v);
  const top = all.slice(0, 5);
  const max = top[0].v;
  return {
    title: "Busiest months ever",
    sub: "Top 5 months · MODIS fire cell-days",
    note: "The biggest month on record: " + top[0].label,
    svg: (
      <svg viewBox={"0 0 " + W + " " + H} className="fd-svg">
        {top.map((t, i) => {
          const w = ((W - 110) * t.v) / max;
          return (
            <g key={t.label} className="fd-bar" style={{ animationDelay: i * 60 + "ms" }}>
              <text x="10" y={16 + i * 21} className="fd-lab">{t.label}</text>
              <rect x="66" y={7 + i * 21} width={w} height="11" rx="3" fill="url(#fd-hbar)" />
              <text x={70 + w} y={16 + i * 21} className="fd-val">{fmt(t.v)}</text>
            </g>
          );
        })}
        <defs>
          <linearGradient id="fd-hbar" x1="0" x2="1">
            <stop offset="0" stopColor="#ff7a3d" />
            <stop offset="1" stopColor="#ffd08a" />
          </linearGradient>
        </defs>
      </svg>
    ),
  };
}

export default function FireDeck(props) {
  const [data, setData] = useState(null);
  const [demo, setDemo] = useState(false);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    loadCalendar("world")
      .then((r) => {
        setData(r.data);
        setDemo(Boolean(r.meta && (r.meta.demo || r.meta.fallback_used)));
      })
      .catch(() => setData(null));
  }, []);

  const slides = [];
  if (data && data.modis) {
    [seasonChart, yearsChart, kChart, topChart].forEach((make) => {
      const s = make(data);
      if (s) {
        slides.push(s);
      }
    });
  }

  useEffect(() => {
    if (paused || slides.length < 2) {
      return undefined;
    }
    const timer = setInterval(() => setIndex((i) => (i + 1) % slides.length), 5200);
    return () => clearInterval(timer);
  }, [paused, slides.length]);

  if (slides.length === 0) {
    return null;
  }
  const i = index % slides.length;
  const slide = slides[i];
  let tag = "Whole Earth";
  if (demo) {
    tag = "Demo data";
  }

  return (
    <div className={props.className} role="group" aria-roledescription="carousel" aria-label="Fire record charts" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <button type="button" className="fd-body" onClick={() => setIndex((i + 1) % slides.length)} aria-label={"Show next chart after " + slide.title}>
        <span className="fd-head">
          <b>{slide.title}</b>
          <small>{tag}</small>
        </span>
        <span className="fd-sub">{slide.sub}</span>
        <span className="fd-chart" key={i}>{slide.svg}</span>
        <span className="fd-note">{slide.note}</span>
      </button>
      <div className="fd-dots">
        {slides.map((s, k) => {
          let cls = "";
          if (k === i) {
            cls = "on";
          }
          return <button type="button" key={s.title} className={cls} onClick={() => setIndex(k)} aria-label={s.title} aria-current={k === i} />;
        })}
        <span className="fd-hint">click for the next chart</span>
      </div>
    </div>
  );
}
