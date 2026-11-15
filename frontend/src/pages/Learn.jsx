import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { fetchJson } from "../api/client.js";

const GIBS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&STYLES=&CRS=EPSG:4326&FORMAT=image/jpeg&WIDTH=960&HEIGHT=640";

const REGIONS = [
  { id: "punjab", name: "Punjab + Haryana", bbox: "28.5,73.5,32.5,79.5" },
  { id: "california", name: "California", bbox: "36.0,-124.5,42.0,-115.5" },
  { id: "mato", name: "Mato Grosso", bbox: "-16.0,-60.0,-10.0,-51.0" },
  { id: "nsw", name: "New South Wales", bbox: "-37.0,145.0,-31.0,154.0" },
  { id: "cordoba", name: "Córdoba", bbox: "-34.5,-66.5,-29.5,-59.0" },
  { id: "africa", name: "Southern Africa", bbox: "-20.0,20.0,-8.0,38.0" },
];

const LAYERS = [
  { id: "viirs", name: "VIIRS 375 m", value: "VIIRS_NOAA20_CorrectedReflectance_TrueColor,VIIRS_NOAA20_Thermal_Anomalies_375m_All" },
  { id: "modis", name: "MODIS 1 km", value: "MODIS_Aqua_CorrectedReflectance_TrueColor,MODIS_Aqua_Thermal_Anomalies_All" },
  { id: "burn", name: "7-2-1 burn scars", value: "MODIS_Terra_CorrectedReflectance_Bands721" },
];

function daysAgo(n) {
  const d = new Date(Date.now() - n * 86400000);
  return d.toISOString().slice(0, 10);
}

function LiveViewer() {
  const [regionId, setRegionId] = useState("punjab");
  const [layerId, setLayerId] = useState("viirs");
  const [date, setDate] = useState(daysAgo(1));
  const [state, setState] = useState("loading");
  const region = REGIONS.find((r) => r.id === regionId);
  const layer = LAYERS.find((l) => l.id === layerId);
  const src = GIBS + "&LAYERS=" + layer.value + "&BBOX=" + region.bbox + "&TIME=" + date;

  useEffect(() => {
    setState("loading");
  }, [src]);

  let status = <span className="chip live"><span className="dot" />Live · NASA GIBS</span>;
  if (state === "loading") {
    status = <span className="chip loading"><span className="dot" />Loading</span>;
  } else if (state === "error") {
    status = <span className="chip unavailable"><span className="dot" />No image for this date</span>;
  }

  let imgCls = "";
  let failNote = null;
  if (state === "error") {
    imgCls = "failed";
    failNote = <div className="learn-live-fail">NASA GIBS has no image for {date} in this layer. This is missing imagery, not a sign that there was no fire. Pick a later date.</div>;
  }

  return (
    <div className="panel learn-live">
      <div className="learn-live-head">
        <div>
          <div className="eyebrow">Live satellite viewer</div>
          <h3>See the Earth as the fire satellites saw it</h3>
          <p className="dim">Images load straight from NASA GIBS in your browser. No key is used. Orange or red marks are fire pixels drawn from the fire product, not photographs of flames.</p>
        </div>
        {status}
      </div>
      <div className="learn-live-controls">
        <div className="seg">
          {LAYERS.map((l) => {
            let cls = "";
            if (l.id === layerId) {
              cls = "on";
            }
            return <button key={l.id} className={cls} onClick={() => setLayerId(l.id)}>{l.name}</button>;
          })}
        </div>
        <select value={regionId} onChange={(e) => setRegionId(e.target.value)} className="learn-select">
          {REGIONS.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <input type="date" value={date} max={daysAgo(0)} min="2000-02-24" onChange={(e) => setDate(e.target.value)} className="learn-select" />
        <button className="btn small" onClick={() => setDate(daysAgo(1))}>Yesterday</button>
        <button className="btn small" onClick={() => setDate("2020-11-04")}>Peak stubble day 2020</button>
      </div>
      <div className="learn-live-frame">
        <img className={imgCls} src={src} alt={"NASA GIBS " + layer.name + " " + region.name + " " + date} onLoad={() => setState("ok")} onError={() => setState("error")} />
        {failNote}
      </div>
      <p className="learn-cap">{layer.name} · {region.name} · {date} UTC · Recent days can be partly empty until NASA finishes processing; clouds hide fire (Lesson 03).</p>
    </div>
  );
}

function LessonVideo(props) {
  if (!props.video) {
    return null;
  }
  const m = Math.floor(props.video.seconds / 60);
  let sec = String(props.video.seconds % 60);
  if (sec.length < 2) {
    sec = "0" + sec;
  }
  return (
    <div className="learn-video">
      <div className="learn-video-head">
        <span className="chip archive"><span className="dot" />Video lesson · {m}:{sec}</span>
        <small>Narrated, animated explainer · subtitles in the video · real NASA imagery and project data</small>
      </div>
      <video key={props.video.src} controls preload="none" playsInline poster={props.video.poster} src={props.video.src} />
    </div>
  );
}

function PdfCallout(props) {
  if (!props.lesson.pdf) {
    return (
      <div className="learn-pdf off">
        <span className="learn-pdf-icon">PDF</span>
        <span>
          <b>Detailed lesson — link coming soon</b>
          <small>The full explanation with satellite images, graphs, formulas, worked examples, a quiz and sources will open here.</small>
        </span>
      </div>
    );
  }
  return (
    <a className="learn-pdf" href={props.lesson.pdf} target="_blank" rel="noreferrer">
      <span className="learn-pdf-icon">PDF</span>
      <span>
        <b>Read the detailed lesson</b>
        <small>Full explanation with satellite images, graphs, formulas, worked examples, a quiz and sources — far more than this page.</small>
      </span>
      <span className="learn-pdf-go">Open ↗</span>
    </a>
  );
}

function PdfLink(props) {
  if (!props.href) {
    return <span className={props.className + " off"}>{props.children}</span>;
  }
  return <a className={props.className} href={props.href} target="_blank" rel="noreferrer">{props.children}</a>;
}

function Sections(props) {
  if (!props.items || props.items.length === 0) {
    return null;
  }
  return (
    <div className="learn-sections">
      {props.items.map((s, i) => (
        <section className="learn-section" key={s.heading}>
          <span className="mono dim">{props.num}.{i + 1}</span>
          <div>
            <h4>{s.heading}</h4>
            <p>{s.text}</p>
          </div>
        </section>
      ))}
    </div>
  );
}

function SatPair(props) {
  if (props.items.length === 0) {
    return null;
  }
  let cls = "learn-sat";
  if (props.items.length === 1) {
    cls = "learn-sat one";
  }
  return (
    <div className={cls}>
      {props.items.map((s) => (
        <figure key={s.src} className="learn-fig">
          <img src={s.src} alt={s.caption} loading="lazy" />
          <figcaption>
            <span className="chip archive"><span className="dot" />NASA satellite · {s.date}</span>
            <p>{s.caption}</p>
            <small className="mono">{s.layer}</small>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

function Figures(props) {
  return (
    <div className="learn-figs">
      {props.items.map((f) => (
        <figure key={f.src} className="learn-fig">
          <img src={f.src} alt={f.caption} loading="lazy" />
          <figcaption><p>{f.caption}</p></figcaption>
        </figure>
      ))}
    </div>
  );
}

export default function Learn() {
  const [lessons, setLessons] = useState([]);
  const [index, setIndex] = useState(0);
  const location = useLocation();
  const [jump, setJump] = useState(0);
  const [error, setError] = useState("");
  const [videos, setVideos] = useState({});

  useEffect(() => {
    fetchJson("/learn/video/videos.json")
      .then((v) => setVideos(v))
      .catch(() => setVideos({}));
    fetchJson("/data/lessons.json")
      .then((r) => setLessons(r.data))
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    const id = location.hash.replace("#", "");
    if (!id || lessons.length === 0) {
      return;
    }
    const i = lessons.findIndex((l) => l.id === id);
    if (i >= 0) {
      setIndex(i);
      setJump((j) => j + 1);
    }
  }, [location.hash, lessons]);

  useEffect(() => {
    if (jump === 0) {
      return;
    }
    const el = document.getElementById("learn-main");
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [jump]);

  function go(i) {
    setIndex(i);
    setJump(jump + 1);
  }

  if (error) {
    return <div className="page"><div className="eyebrow">Learn</div><p className="lead">Lessons could not be loaded: {error}</p></div>;
  }
  if (lessons.length === 0) {
    return <div className="page"><div className="eyebrow">Learn</div><p className="lead">Loading lessons…</p></div>;
  }

  const lesson = lessons[index];
  const myths = lessons.find((l) => l.id === "myths");

  const body = lesson.lead;

  let live = null;
  if (lesson.id === "live") {
    live = <LiveViewer />;
  }

  let prev = null;
  if (index > 0) {
    prev = <button className="btn small" onClick={() => go(index - 1)}>← {lessons[index - 1].num} {lessons[index - 1].title}</button>;
  }
  let next = null;
  if (index < lessons.length - 1) {
    next = <button className="btn small" onClick={() => go(index + 1)}>{lessons[index + 1].num} {lessons[index + 1].title} →</button>;
  }

  return (
    <div className="page learn">
      <header className="ph" style={{ "--ph": "var(--modis)" }}>
        <div className="eyebrow">Research & education</div>
        <h1 className="ph-title">Learn <em>the record</em></h1>
        <p className="ph-q">Fifteen lessons and three guides</p>
      </header>
      <p className="lead">Twelve lessons and three guides: how a satellite turns heat into a fire pixel, why MODIS and VIIRS disagree, and how FIREWORK puts 25 years on one ruler. Each lesson has a short version here and a detailed PDF with real NASA satellite images and graphs made from the project's own FIRMS data.</p>
      <div className="row learn-badges">
        <span className="chip archive"><span className="dot" />Real NASA imagery</span>
        <span className="chip live"><span className="dot" />Live FIRMS data</span>
        <span className="chip"><span className="dot" />{lessons.length} lessons</span>
      </div>

      <div className="learn-grid">
        <nav className="panel learn-nav">
          {lessons.map((l, i) => {
            let cls = "learn-nav-item";
            if (i === index) {
              cls = "learn-nav-item on";
            }
            return (
              <button key={l.id} className={cls} onClick={() => go(i)}>
                <span className="mono dim">{l.num}</span>
                <span>{l.title}<small>{l.kicker}</small></span>
              </button>
            );
          })}
        </nav>

        <article className="panel learn-main" id="learn-main">
          <div className="row learn-pager top">
            {prev}
            <span style={{ flex: 1 }} />
            {next}
          </div>
          <span className="eyebrow">Lesson {lesson.num} · {lesson.kicker}</span>
          <h2 className="learn-title">{lesson.title}</h2>
          <LessonVideo video={videos[lesson.id]} />
          <p className="lead">{body}</p>
          <PdfCallout lesson={lesson} />

          <div className="learn-points">
            {lesson.points.map((p) => (
              <div className="learn-point" key={p.title}>
                <h4>{p.title}</h4>
                <p>{p.text}</p>
              </div>
            ))}
          </div>

          <Sections items={lesson.sections} num={lesson.num} />
          {live}
          <SatPair items={lesson.satellite} />
          <Figures items={lesson.figures} />

          <div className="learn-more">
            <p>This page is the short version. The detailed PDF for lesson {lesson.num} explains every step in far more depth, with more satellite images, graphs, formulas and a self-check quiz.</p>
            <PdfLink className="btn primary" href={lesson.pdf}>Download lesson {lesson.num} (PDF)</PdfLink>
          </div>

        </article>
      </div>

      <h2>Most misunderstood ideas</h2>
      <div className="cards">
        {myths.points.map((m) => (
          <div className="card learn-myth" key={m.title}>
            <h3>“{m.title}”</h3>
            <p>{m.text}</p>
            <PdfLink href={myths.pdf} className="learn-link">Details in PDF ↗</PdfLink>
          </div>
        ))}
      </div>

      <h2>Detailed lesson library</h2>
      <div className="learn-library">
        {lessons.map((l) => (
          <PdfLink key={l.id} href={l.pdf} className="learn-lib-item">
            <span className="mono dim">{l.num}</span>
            <span>{l.title}<small>{l.kicker}</small></span>
            <span className="learn-pdf-icon">PDF</span>
          </PdfLink>
        ))}
      </div>
      <p className="learn-cap">Satellite images: NASA GIBS / Worldview (public domain). Fire data: NASA FIRMS. Every figure states its provenance. Research decision support, not a life-safety alert system.</p>
    </div>
  );
}
