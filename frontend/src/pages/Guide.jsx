import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchJson } from "../api/client.js";


const GROUPS = [
  {
    name: "Start",
    pages: [
      { to: "/", title: "Home", img: "home", what: "The story of the record: 25 years, 5 satellites, 2 sensors, with a live Earth showing the last two days of fire pixels.", look: "The striped record bar: amber is MODIS from 2000, blue is VIIRS from 2012." },
    ],
  },
  {
    name: "Explore",
    pages: [
      { to: "/explore", title: "Explorer", img: "explore-globe", what: "Every NASA FIRMS hot pixel on one Earth, in three views: 3D columns, 3D hexagon cells and a 2D map. Layers on the left, the Inspector on the right.", look: "Click any place. The Inspector shows its 0.1° cell, its 50 km neighbourhood and which satellites pass over it." },
      { to: "/calendar/punjab_haryana", title: "Calendar", img: "calendar", what: "Twenty-five years on one page: each row a year, each column a month, each cell the fire cell-days in that month.", look: "Switch Raw to Harmonised to see the 2012 seam put onto one ruler. Hatched means not observed, never zero." },
      { to: "/sensors", title: "Sensor Lab", img: "sensors", what: "The same Earth seen through two rulers. Switch MODIS and VIIRS and watch the same places light up differently.", look: "Why VIIRS records more: its 375 m pixels catch small fires that 1 km MODIS pixels miss." },
      { to: "/sources", title: "Sources", img: "sources", what: "What is burning: crop residue, forest, industrial heat, or honestly unknown, with an evidence card for each dot.", look: "UNKNOWN is a valid answer. The classifier abstains when the evidence is weak." },
      { to: "/blind-spot", title: "Blind Spot", img: "blindspot", what: "When the satellites cannot see: fixed overpass times, clouds and smoke, small or cool fires, and tree canopy.", look: "Move the burning peak and see how much of a late-afternoon fire falls outside the overpass windows." },
    ],
  },
  {
    name: "Trust",
    pages: [
      { to: "/validation", title: "Validation", img: "validation", what: "Twelve pass rules written down on 27 Oct 2026, before any real-data run.", look: "A dash means pending, not zero. Nothing synthetic is shown as a result." },
      { to: "/formulas", title: "Formulas", img: "formulas", what: "All 46 formulas behind the numbers, each with its original and revised version and an audit verdict.", look: "OK = kept, REVISE = definition changed, FIX = defect found and corrected." },
      { to: "/sources/health", title: "Source Health", img: "health", what: "Where every number comes from: NASA FIRMS, the NASA archive, Google Earth Engine, ESA WorldCover and more.", look: "The status column shows which feeds are configured right now." },
    ],
  },
  {
    name: "Your data",
    pages: [
      { to: "/studio", title: "Data Studio", img: "studio", what: "Put your own CSV on the Earth in ten steps: upload, inspect, validate, map columns, run, compare, export.", look: "Your file stays in your browser and is never sent to an AI model." },
      { to: "/me", title: "Workspace", img: "workspace", what: "Your saved views, kept in this browser only.", look: "Save a calendar view and reopen it later with the same settings." },
      { to: "/brief/punjab_haryana", title: "Brief", img: "brief", what: "A printable research summary whose sentences are filled only from computed numbers.", look: "It always carries the warning: not for life-safety decisions." },
    ],
  },
  {
    name: "Learn",
    pages: [
      { to: "/learn", title: "Learn", img: "learn", what: "Fourteen lessons and guides, each with a narrated video, a short explanation, real NASA images and a detailed PDF.", look: "Start with Lesson 01 if you are new to satellite fire data." },
      { to: "/explore", title: "Ask Chronos", img: "chat", what: "A guide to the fire record on every page. Ask about the satellites, the exchange rate or how to use a page.", look: "It only quotes numbers the site has computed." },
    ],
  },
];

const SAYS = ["Where and when a satellite saw strong heat", "How MODIS and VIIRS compare, month by month", "How much of each place could be seen", "Long-term trends on one ruler, with a band"];
const SAYS_NOT = ["How many separate fires there were", "How much area actually burned", "That a cloudy, quiet month had no fire", "Anything for emergency decisions"];
const IGNORE = ["A single dot on its own", "Raw totals that jump across the 2012 seam", "Small differences inside overlapping bands", "Day-to-day ups and downs in the live feed"];

function clockText(seconds) {
  const m = Math.floor(seconds / 60);
  let s = String(Math.floor(seconds % 60));
  if (s.length < 2) {
    s = "0" + s;
  }
  return m + ":" + s;
}

export default function Guide() {
  const [video, setVideo] = useState(null);
  const [chapter, setChapter] = useState(-1);

  useEffect(() => {
    fetchJson("/learn/video/videos.json")
      .then((v) => setVideo(v["site-tour"] || null))
      .catch(() => setVideo(null));
  }, []);

  useEffect(() => {
    if (!video || !video.chapters) {
      return;
    }
    const m = window.location.hash.match(/^#ch-(\d+)$/);
    if (!m) {
      return;
    }
    const n = Number(m[1]);
    const i = video.chapters.findIndex((c) => c.n === n);
    if (i < 0) {
      return;
    }
    const timer = setTimeout(() => {
      const v = document.getElementById("tour-video");
      setChapter(i);
      if (v) {
        v.currentTime = video.chapters[i].at;
        v.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [video]);

  function seek(i, at) {
    const v = document.getElementById("tour-video");
    setChapter(i);
    if (!v) {
      return;
    }
    v.currentTime = at;
    v.play();
    v.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  let tour = <div className="panel guide-wait">The guided tour video is being prepared.</div>;
  if (video) {
    const chapters = video.chapters || [];
    tour = (
      <section className="panel learn-tour" aria-label="Guided tour video">
        <div className="learn-tour-text">
          <span className="eyebrow">Guided tour · {clockText(video.seconds)}</span>
          <h2>Watch the whole website in one video</h2>
          <p>A narrated walk through the real website in seven parts: what each page shows, what the numbers mean, and what they do not mean. English narration, captions in the video.</p>
          <ol className="learn-tour-chapters">
            {chapters.map((c, i) => {
              let cls = "";
              if (i === chapter) {
                cls = "on";
              }
              return (
                <li key={c.title}>
                  <button className={cls} onClick={() => seek(i, c.at)}>
                    <span className="mono">{clockText(c.at)}</span>
                    <span>Part {c.n} · {c.title}<small>{c.sub}</small></span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
        <div className="learn-tour-video">
          <video id="tour-video" controls preload="none" playsInline poster={video.poster} src={video.src} />
        </div>
      </section>
    );
  }

  return (
    <div className="page guide">
      <header className="ph" style={{ "--ph": "var(--viirs)" }}>
        <div className="eyebrow">Learn · Website guide</div>
        <h1 className="ph-title">Website <em>guide</em></h1>
        <p className="ph-q">How to use FIREWORK CHRONOS</p>
      </header>
      <p className="lead">FIREWORK CHRONOS joins 25 years of NASA fire observations from two satellite sensors, MODIS and VIIRS, into one record of the whole Earth. This guide introduces every part of the website, and what its data can and cannot tell you.</p>

      {tour}

      <section className="guide-truth" aria-label="What the data says">
        <div className="panel guide-col yes">
          <span className="eyebrow">What our data says</span>
          <ul>{SAYS.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
        <div className="panel guide-col no">
          <span className="eyebrow">What it does not say</span>
          <ul>{SAYS_NOT.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
        <div className="panel guide-col calm">
          <span className="eyebrow">What should not worry you</span>
          <ul>{IGNORE.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      </section>

      {GROUPS.map((g) => (
        <section className="guide-group" key={g.name} aria-label={g.name}>
          <h2 className="guide-group-title"><span className="eyebrow">{g.name}</span></h2>
          <div className="guide-cards">
            {g.pages.map((p) => (
              <Link className="panel guide-card" to={p.to} key={p.title}>
                <img src={"/learn/tour/" + p.img + ".webp"} alt={p.title + " page"} loading="lazy" />
                <div className="guide-card-body">
                  <h3>{p.title} <span className="guide-go">Open →</span></h3>
                  <p>{p.what}</p>
                  <p className="guide-look"><b>Look for</b> {p.look}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
