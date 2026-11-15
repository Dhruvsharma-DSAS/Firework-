import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import SpaceBackground from "../components/SpaceBackground.jsx";
import IntroFilm, { introPending } from "../components/IntroFilm.jsx";
import { loadDetections, loadCalendar } from "../api/data.js";
import FireDeck from "../components/FireDeck.jsx";
import "../styles/home.css";

const SERVICE_GO = [["/explore", "See live detections"], ["/formulas/F03", "See the grid formula"], ["/calendar/punjab_haryana", "Open the calendar"], ["/studio", "Get the data"]];

const SECTIONS = [
  ["how", "01 How it works"],
  ["service", "02 Service"],
  ["satellites", "03 Satellites"],
  ["calendar", "04 Calendar"],
  ["mission", "05 Mission"],
  ["next", "06 Go further"],
];

const PILL = [
  ["/", "Home"],
  ["/explore", "Explore"],
  ["/calendar/punjab_haryana", "Calendar"],
  ["/validation", "Trust"],
  ["/me", "Your data"],
  ["/learn", "Learn"],
];

const NEXT = [
  ["01", "Explore the globe", "Every NASA FIRMS hot pixel of the last days on a 3D Earth. Search a region, play the days, click any place for its numbers.", "Top bar → Explore", "/explore", "var(--hviirs)"],
  ["02", "Read the 25-year calendar", "Month × year fire cell-days for any processed region on Earth, raw or harmonised to VIIRS units with a 95 % band.", "Explore → Calendar", "/calendar/punjab_haryana", "var(--hmodis)"],
  ["03", "See how we harmonise", "The formulas F01–F46 behind every number: local solar time, the 0.1° grid, cell-days and the exchange rate k.", "Trust → Formulas", "/formulas", "var(--ink)"],
  ["04", "Check if it is accurate", "Pass rules written before the real run, held-out tests and the model cards — including the models we hide.", "Trust → Validation", "/validation", "var(--ink)"],
  ["05", "Take a brief with you", "A one-page printable summary for a region, built only from computed numbers and their sources.", "Your data → Brief", "/brief/punjab_haryana", "var(--ink)"],
];

const TOUR_SRC = "/learn/video/site-tour.mp4";
const TOUR_POSTER = "/learn/video/site-tour.jpg";
const TOUR_SEGMENTS = [[18.8, 71.5], [152.3, 205.8], [205.8, 264.6], [268.4, 303]];

const CLIPS = [
  { name: "pass", url: "chronos / home · satellites", where: "Home · scroll down", cap: "STEP 1 OF 4 · SCROLL THIS PAGE — EACH SATELLITE OPENS INTO ITS PARTS", title: "Scroll the story", text: "Keep scrolling this page. Each satellite docks, comes apart into labelled parts and opens the instrument that sees fire.", get: "YOU LEARN · WHY MODIS AND VIIRS COUNT DIFFERENTLY", go: ["Go to the satellites ↓", "#satellites"] },
  { name: "pick", url: "chronos / explore", where: "Top bar → Explore", cap: "STEP 2 OF 4 · OPEN THE EXPLORER, SEARCH A REGION, PLAY THE DAYS", title: "Open the Explorer", text: "Press Explore in the top bar. Type a region in the search box: the globe flies there and Play steps through the latest days of NASA detections.", get: "YOU GET · EVERY HOT PIXEL ON ONE GLOBE", go: ["Open the Explorer →", "/explore"] },
  { name: "answer", url: "chronos / explore · location", where: "Explore → click the globe", cap: "STEP 3 OF 4 · CLICK ANY PLACE — A CARD PINS TO IT", title: "Click any place", text: "Click a fire or any spot on Earth. A card pins there and the right panel fills with its 0.1° cell: hot pixels, cell-days, overpass times.", get: "YOU GET · A NUMBER WITH ITS SOURCE AND STATUS", go: ["Try it in the Explorer →", "/explore"] },
  { name: "harm", url: "chronos / calendar", where: "Explore → Calendar", cap: "STEP 4 OF 4 · READ 25 YEARS AS ONE CALENDAR", title: "Read the calendar", text: "Open Calendar from the Explore menu. Switch Raw to Harmonised: MODIS years turn into VIIRS units with a 95 % band. Click a month for its numbers.", get: "YOU GET · ONE RECORD ACROSS THE 2012 SEAM", go: ["Open the calendar →", "/calendar/punjab_haryana"] },
];

const ANSWERS = [
  ["01 · Target", "The whole Earth", "The globe shows every continent by default. Pick any country, state or box you draw — the same code builds its 25-year record."],
  ["02 · Satellites", "MODIS + VIIRS", "Terra and Aqua (MODIS, from 2000). Suomi NPP, NOAA-20 and NOAA-21 (VIIRS, from 2012)."],
  ["03 · Problem", "The record breaks in 2012", "VIIRS sees smaller fires, so raw counts jump. The old MODIS satellites are now ending."],
  ["04 · Who suffers", "People, officials, researchers", "Nobody can say for sure if burning fell, because the two rulers measure differently."],
  ["05 · Solution", "One record, 2000 → 2026", "MODIS years converted to VIIRS units with exchange rate k, each value with its interval."],
  ["06 · You get", "Map · calendar · CSV · brief", "Source labels (crop, forest, industry, unknown) and a warning where late or cloudy fires were missed."],
];

const SERVICE = [
  ["01", "Detect", "MODIS and VIIRS flag pixels whose 4 µm brightness jumps above their neighbours.", "FIRMS · NRT", "/img/earth_limb.webp", { width: "260%", left: "-80%", top: "-30px" }],
  ["02", "Grid", "Every detection becomes a fire cell-day on one 0.1° grid, divided by clear-sky days.", "0.1° · DAILY", "/img/grid.webp", { width: "220%", left: "-40%", top: "0" }],
  ["03", "Harmonise", "The 2012–2025 overlap teaches an exchange rate k. Old MODIS months become VIIRS units with an interval.", "MODIS → VIIRS", "/img/earth_horizon.webp", { width: "300%", left: "-100%", top: "-60px" }],
  ["04", "Deliver", "A calendar, a map and an API — each value labelled farm, forest or industry, with blind-spot flags.", "CSV · API · MAP", "/img/earth_india.webp", { width: "150%", left: "-10%", top: "-40px" }],
];

const MODIS_OV = [
  ["36 BANDS", "Visible to thermal infrared. Fires use the 4 µm bands 21/22 and 11 µm band 31."],
  ["TWO PASSES", "Terra ~10:30 and Aqua ~13:30 local time — morning and afternoon looks."],
  ["THE SUNSET", "Both satellites are drifting and near end of mission — the reason the record must move to VIIRS."],
];

const VIIRS_OV = [
  ["I-BANDS", "Fire detection uses I4 (3.74 µm) and I5 (11.45 µm) at 375 m."],
  ["WIDE SWATH", "3,040 km per pass — no gaps between orbits at the equator."],
  ["THE FLEET", "Three satellites in one 13:30 orbit, ~50 min apart, keep the record going after MODIS."],
];

const MODIS_SPEC = [["Altitude", "705", "km"], ["Swath", "2,330", "km"], ["Fire pixel", "1,000", "m"], ["Bands", "36", "0.4–14 µm"], ["Product", "MCD14", "C6.1"]];
const VIIRS_SPEC = [["Altitude", "824", "km"], ["Swath", "3,040", "km"], ["Fire pixel", "375", "m"], ["Bands", "22", "0.4–12 µm"], ["Product", "VNP14", "IMG"]];

const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const HEAT_STOPS = [[0, [21, 25, 31]], [0.18, [107, 74, 20]], [0.45, [255, 181, 71]], [0.72, [255, 122, 69]], [1, [255, 77, 94]]];

function heatColor(t) {
  let lower = HEAT_STOPS[0];
  let upper = HEAT_STOPS[HEAT_STOPS.length - 1];
  for (let i = 0; i < HEAT_STOPS.length - 1; i = i + 1) {
    if (t >= HEAT_STOPS[i][0] && t <= HEAT_STOPS[i + 1][0]) {
      lower = HEAT_STOPS[i];
      upper = HEAT_STOPS[i + 1];
    }
  }
  let f = 0;
  if (upper[0] > lower[0]) {
    f = (t - lower[0]) / (upper[0] - lower[0]);
  }
  const rgb = [0, 1, 2].map((i) => Math.round(lower[1][i] + f * (upper[1][i] - lower[1][i])));
  return "rgb(" + rgb.join(",") + ")";
}

function jumpSat(which) {
  const pin = document.getElementById("satpin");
  if (which === "compare" || !pin || pin.getBoundingClientRect().height <= window.innerHeight * 1.5) {
    scrollToId("dossier-" + which);
    return;
  }
  const box = pin.getBoundingClientRect();
  const range = box.height - window.innerHeight;
  let part = 0.08;
  if (which === "viirs") {
    part = 0.6;
  }
  let behavior = "smooth";
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    behavior = "auto";
  }
  window.scrollTo({ top: box.top + window.scrollY + range * part, behavior: behavior });
}

function scrollToId(id) {
  const target = document.getElementById(id);
  if (!target) {
    return;
  }
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let behavior = "smooth";
  if (reduce) {
    behavior = "auto";
  }
  target.scrollIntoView({ behavior: behavior, block: "start" });
}

function RecordStrip() {
  const years = [];
  for (let y = 2000; y <= 2026; y = y + 1) {
    years.push(y);
  }
  return (
    <div className="rstrip" role="img" aria-label="Record from 2000 to 2026: MODIS years before 2012, VIIRS from 2012">
      <div className="rstrip-head">
        <span>The record</span>
        <b>2000 — 2026</b>
      </div>
      <div className="rstrip-ticks">
        {years.map((y, i) => {
          let cls = "m";
          if (y >= 2012) {
            cls = "v";
          }
          if (y === 2012) {
            cls = "v seam";
          }
          return <i key={y} className={cls} style={{ animationDelay: 300 + i * 45 + "ms" }} title={String(y)} />;
        })}
      </div>
      <div className="rstrip-foot">
        <span className="m">MODIS · 2000</span>
        <span className="v">VIIRS joins · 2012</span>
        <span>now</span>
      </div>
    </div>
  );
}

function scrollToPin(fraction, fallbackId) {
  const pin = document.getElementById("satpin");
  if (!pin) {
    scrollToId(fallbackId);
    return;
  }
  const r = pin.getBoundingClientRect();
  const range = r.height - window.innerHeight;
  if (range < window.innerHeight * 0.5) {
    scrollToId(fallbackId);
    return;
  }
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let behavior = "smooth";
  if (reduce) {
    behavior = "auto";
  }
  window.scrollTo({ top: r.top + window.scrollY + range * fraction, behavior: behavior });
}

function Split(props) {
  const letters = props.text.split("").map((ch, i) => {
    let text = ch;
    if (ch === " ") {
      text = " ";
    }
    return <span key={i} style={{ transitionDelay: i * 35 + "ms" }}>{text}</span>;
  });
  return <h2 className="split" aria-label={props.text}>{letters}</h2>;
}

function Dossier(props) {
  const vis = (
    <div className="vis" style={{ order: props.visOrder }} role="img" aria-label={props.imgAlt}>
      <span className="burst" />
      <span className="lbl">{props.imgLabel}</span>
    </div>
  );
  return (
    <div className="dossier" id={props.id} style={{ "--halo": props.halo, "--c": props.color }}>
      {vis}
      <div className="info">
        <div className="eyebrow" style={{ color: props.color }}>{props.eyebrow}</div>
        <div className="sensor">{props.name}</div>
        <div className="carriers" style={{ color: props.color }}>{props.carriers}</div>
        <p className="desc" style={{ marginTop: 22 }}>{props.text}</p>
        <ul className="ov">
          {props.overview.map((row, i) => (
            <li key={row[0]}><span className="n">{"0" + (i + 1)}</span><b>{row[0]}</b><p>{row[1]}</p></li>
          ))}
        </ul>
        <div className="spec" style={{ "--c": props.color }}>
          {props.spec.map((row) => (
            <div key={row[0]}><span>{row[0]}</span><b>{row[1]}</b><small>{row[2]}</small></div>
          ))}
        </div>
      </div>
    </div>
  );
}

const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default function Home() {
  const navigate = useNavigate();

  function goTo(target) {
    if (target.startsWith("#")) {
      scrollToId(target.slice(1));
    } else if (target === "/") {
      scrollToId("top");
    } else {
      navigate(target);
    }
  }
  const [calendar, setCalendar] = useState(null);
  const [heatTip, setHeatTip] = useState(null);
  const [heatNudge, setHeatNudge] = useState("");

  useEffect(() => {
    if (!heatNudge) {
      return undefined;
    }
    const t = setTimeout(() => setHeatNudge(""), 4500);
    return () => clearTimeout(t);
  }, [heatNudge]);

  function heatMissing(label) {
    setHeatNudge(label);
  }
  const [calendarMeta, setCalendarMeta] = useState(null);
  const [today, setToday] = useState(null);
  const [fires, setFires] = useState(null);
  const [earthReady, setEarthReady] = useState(false);
  const [splashGone, setSplashGone] = useState(!introPending());
  const [active, setActive] = useState(-1);
  const [clip, setClip] = useState(0);
  const [muted, setMuted] = useState(true);
  const [progress, setProgress] = useState(0);
  const [inView, setInView] = useState(false);
  const [satTab, setSatTab] = useState("modis");

  useEffect(() => {
    document.title = "FIREWORK CHRONOS · 25 years of fire, one honest record";
    loadCalendar("punjab_haryana").then((result) => {
      setCalendar(result.data);
      setCalendarMeta(result.meta);
    }).catch(() => setCalendar(null));
    loadDetections("VIIRS_NOAA20_NRT", 2)
      .then((result) => {
        let last = "";
        result.data.forEach((p) => {
          if (p.date > last) {
            last = p.date;
          }
        });
        const count = result.data.filter((p) => p.date === last).length;
        const byCountry = {};
        result.data.forEach((p) => {
          if (p.country) {
            byCountry[p.country] = (byCountry[p.country] || 0) + 1;
          }
        });
        const top = Object.keys(byCountry).sort((a, b) => byCountry[b] - byCountry[a]).slice(0, 3);
        let total = result.data.length;
        if (result.meta && result.meta.rows_total) {
          total = result.meta.rows_total;
        }
        const binMap = {};
        result.data.forEach((p) => {
          const key = p.date + "-" + Math.floor(Number(p.utc || 0) / 300);
          binMap[key] = (binMap[key] || 0) + 1;
        });
        const bins = Object.keys(binMap).sort().slice(-16).map((k) => ({ key: k, n: binMap[k] }));
        const topCounts = top.map((name) => ({ name: name, n: byCountry[name] }));
        let status = "LIVE_NRT";
        if (result.meta && result.meta.status) {
          status = result.meta.status;
        }
        setToday({ count: count, date: last, demo: Boolean(result.meta && result.meta.demo), total: total, top: top, topCounts: topCounts, bins: bins, status: status, countries: Object.keys(byCountry).length });
        setFires(result.data.map((p) => {
          let color = "#ff7a3d";
          if (p.frp > 20) {
            color = "#ffd08a";
          }
          return { lat: p.lat, lon: p.lon, color: color };
        }));
      })
      .catch(() => setToday(null));
  }, []);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const targets = Array.prototype.slice.call(document.querySelectorAll(".home .split, .home .rv, .home .vis"));
    if (reduce || !("IntersectionObserver" in window)) {
      targets.forEach((el) => el.classList.add("in"));
      return undefined;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.18 });
    targets.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [calendar]);

  useEffect(() => {
    if (earthReady) {
      return undefined;
    }
    const failsafe = setTimeout(() => setEarthReady(true), 15000);
    return () => clearTimeout(failsafe);
  }, [earthReady]);

  useEffect(() => {
    function onScroll() {
      const mid = window.innerHeight * 0.45;
      let found = -1;
      SECTIONS.forEach((section, i) => {
        const el = document.getElementById(section[0]);
        if (el && el.getBoundingClientRect().top < mid) {
          found = i;
        }
      });
      setActive(found);
      const pinEl = document.getElementById("satpin");
      const viirsEl = document.getElementById("dossier-viirs");
      const cmpEl = document.getElementById("dossier-compare");
      if (pinEl && viirsEl && cmpEl) {
        const pr = pinEl.getBoundingClientRect();
        const range = Math.max(1, pr.height - window.innerHeight);
        let viirsNow = viirsEl.getBoundingClientRect().top < mid;
        if (pr.height > window.innerHeight * 1.5) {
          viirsNow = -pr.top / range > 0.5;
        }
        if (cmpEl.getBoundingClientRect().top < mid) {
          setSatTab("compare");
        } else if (viirsNow) {
          setSatTab("viirs");
        } else {
          setSatTab("modis");
        }
      }
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const box = document.getElementById("howplayer");
    if (!box || !("IntersectionObserver" in window)) {
      return undefined;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => setInView(entry.isIntersecting));
    }, { threshold: 0.35 });
    io.observe(box);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const video = document.getElementById("howvid");
    if (!video) {
      return undefined;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const seg = TOUR_SEGMENTS[clip];
    if (video.getAttribute("data-src") !== TOUR_SRC) {
      video.setAttribute("data-src", TOUR_SRC);
      video.poster = TOUR_POSTER;
      video.src = TOUR_SRC;
    }
    function seekStart() {
      if (Math.abs(video.currentTime - seg[0]) > 0.5 && (video.currentTime < seg[0] || video.currentTime > seg[1])) {
        video.currentTime = seg[0];
      }
    }
    if (video.readyState >= 1) {
      video.currentTime = seg[0];
    } else {
      video.addEventListener("loadedmetadata", seekStart, { once: true });
    }
    setProgress(0);
    video.controls = reduce;
    function onTime() {
      setProgress(Math.max(0, Math.min(1, (video.currentTime - seg[0]) / (seg[1] - seg[0]))));
      if (video.currentTime >= seg[1]) {
        setClip((clip + 1) % CLIPS.length);
      }
    }
    function onEnd() {
      setClip((clip + 1) % CLIPS.length);
    }
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("ended", onEnd);
    if (inView && !reduce) {
      const p = video.play();
      if (p && p.catch) {
        p.catch(() => setProgress(0));
      }
    } else {
      video.pause();
    }
    return () => {
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("ended", onEnd);
    };
  }, [clip, inView]);

  function toggleSound() {
    const v = document.getElementById("howvid");
    if (v) {
      v.muted = !muted;
    }
    setMuted(!muted);
  }
  let soundLabel = "Sound on · from the guided tour";
  if (!muted) {
    soundLabel = "Sound off";
  }

  let heat = null;
  if (calendar) {
    const rows = calendar.years.map((year, yi) => {
      if (year < 2012) {
        return calendar.modis[yi];
      }
      return calendar.viirs[yi];
    });
    let max = 1;
    rows.forEach((row) => row.forEach((v) => {
      if (v !== null && v > max) {
        max = v;
      }
    }));
    const cells = [<span key="h0" />];
    MONTHS.forEach((m, i) => cells.push(<span key={"m" + i} className="m">{m}</span>));
    calendar.years.forEach((year, yi) => {
      if (year === 2012) {
        cells.push(<div key="seam" className="seamline"><span>2012 · VIIRS JOINS — THE SEAM</span></div>);
      }
      cells.push(<span key={"y" + year} className="y">{year}</span>);
      rows[yi].forEach((v, mi) => {
        const key = year + "-" + mi;
        const label = MONTH_LONG[mi] + " " + year;
        if (v === null) {
          cells.push(<i key={key} className="null" role="button" tabIndex={0} aria-label={label + ": data unavailable"} onMouseEnter={() => setHeatTip({ label: label, none: true })} onClick={() => heatMissing(label)} />);
          return;
        }
        let cls = "";
        if (heatTip && heatTip.label === label) {
          cls = "on";
        }
        cells.push(<i key={key} className={cls} role="button" tabIndex={0} aria-label={label + ": " + v + " fire cell-days. Open in the Calendar."} style={{ background: heatColor(v / max) }} onMouseEnter={() => setHeatTip({ label: label, value: v })} onClick={() => navigate("/calendar/punjab_haryana?y=" + year + "&m=" + (mi + 1))} onKeyDown={(event) => { if (event.key === "Enter") { navigate("/calendar/punjab_haryana?y=" + year + "&m=" + (mi + 1)); } }} />);
      });
    });
    let tipCls = "heat-tip";
    let tipText = <span><em>↑</em> Click any month to open it in the Calendar</span>;
    if (heatTip && heatTip.none) {
      tipCls = "heat-tip miss";
      tipText = <span><b>{heatTip.label}</b> · data unavailable — not observed, which is not the same as zero fire</span>;
    } else if (heatTip) {
      tipCls = "heat-tip live";
      tipText = <span><b>{heatTip.label}</b> · {heatTip.value.toLocaleString()} fire cell-days · click to open this month</span>;
    }
    let openCls = "b2";
    if (heatNudge) {
      openCls = "b2 nudge";
      tipCls = "heat-tip miss";
      tipText = <span><b>{heatNudge}</b> has no data to open. Use <b>Open calendar</b> to explore the months that do.</span>;
    }
    heat = (
      <div>
        <div className="heat" aria-label="Year by month heatmap of fire cell-days with the 2012 seam. Select a month to open it in the Calendar." onMouseLeave={() => setHeatTip(null)}>{cells}</div>
        <div className={tipCls} aria-live="polite">{tipText}</div>
        <div className="cal-foot">
          <span className="cal-ramp">0<b />{Math.round(max)} cell-days · fixed scale</span>
          <button className={openCls} onClick={() => navigate("/calendar/punjab_haryana")}>Open calendar →</button>
        </div>
      </div>
    );
  }

  let todayValue = "—";
  let todayNote = "detections feed unavailable";
  if (today) {
    todayValue = today.count.toLocaleString();
    todayNote = "NOAA-20 · " + today.date;
    if (today.demo) {
      todayNote = todayNote + " · SIM";
    }
  }

  let calendarRegion = "first processed region";
  if (calendar && calendar.region_name) {
    calendarRegion = calendar.region_name;
  }
  let calendarTag = "SIMULATED PREVIEW DATA";
  if (calendarMeta && !calendarMeta.demo && !calendarMeta.fallback_used) {
    calendarTag = "REAL · NASA FIRMS ARCHIVE";
  }
  let kValue = "—";
  let kNote = "PENDING · needs the archive run";
  if (calendar && calendar.k_baseline && calendar.k_baseline["11"]) {
    const kn = calendar.k_baseline["11"];
    kValue = kn.k.toFixed(2);
    kNote = "95% " + kn.lo.toFixed(2) + "–" + kn.hi.toFixed(2) + " · baseline B1, clear-sky correction pending";
  }

  const tabCls = { modis: "", viirs: "", compare: "" };
  if (satTab === "modis") {
    tabCls.modis = "on";
  } else if (satTab === "viirs") {
    tabCls.viirs = "on v";
  } else {
    tabCls.compare = "on c";
  }

  let sideCls = "sidenav";
  if (active >= 0) {
    sideCls = "sidenav show";
  }
  let progressHeight = 0;
  if (active >= 0) {
    progressHeight = ((active + 1) / SECTIONS.length) * 120;
  }

  let splash = null;
  if (!splashGone) {
    splash = <IntroFilm ready={earthReady} onDone={() => setSplashGone(true)} />;
  }

  return (
    <div className="home" id="top">
      <SpaceBackground fires={fires} onReady={() => setEarthReady(true)} />
      {splash}
      <ul className={sideCls} aria-label="Sections">
        {SECTIONS.map((section, i) => {
          let cls = "";
          if (i === active) {
            cls = "on";
          }
          return <li key={section[0]}><a href={"#" + section[0]} className={cls} onClick={(event) => { event.preventDefault(); scrollToId(section[0]); }}>{section[1]}</a></li>;
        })}
        <li><div className="prog"><i style={{ height: progressHeight }} /></div></li>
        <li className="tot">{"0" + Math.max(1, active + 1) + " / 0" + SECTIONS.length}</li>
      </ul>

      <div className="frame">
        <nav className="hnav" aria-label="Home">
          <a className="hbrand" href="/" onClick={(event) => { event.preventDefault(); scrollToId("top"); }}>
            <img src="/logo_ribbon_anim.svg" alt="" />
            <span><b>FIREWORK</b><small>CHRONOS · FIRE RECORD</small></span>
          </a>
          <div className="hpill">
            {PILL.map((item, i) => {
              let cls = "";
              if (i === 0) {
                cls = "on";
              }
              return <a key={item[0]} href={item[0]} className={cls} onClick={(event) => { event.preventDefault(); goTo(item[0]); }}>{item[1]}</a>;
            })}
          </div>
          <div className="hic">
            <button className="hgo" onClick={() => navigate("/explore")}>Open explorer →</button>
          </div>
        </nav>
        <div className="hero">
          <div className="copy">
            <RecordStrip />
            <h1><b>25 years of fire.</b><br />One honest<br /><em>record.</em></h1>
            <p className="hlead">Twenty-five years of NASA fire observations from MODIS and VIIRS, joined into one calendar you can trust.</p>
            <div className="cta">
              <a className="b1" href="#how" onClick={(event) => { event.preventDefault(); scrollToId("how"); }}>Begin the story ↓</a>
              <a className="b2" href="/explore" onClick={(event) => { event.preventDefault(); navigate("/explore"); }}>Open explorer +</a>
            </div>
          </div>
          <FireDeck className="hdeck" />
        </div>
      </div>

      <section className="scene" id="how">
        <div className="eyebrow">How to use it · four steps</div>
        <Split text="How it works" />
        <div className="svc-head rv">
          <p className="title">From this page to <b>your answer</b> in four steps.</p>
          <p className="desc">Each clip shows one step of the route through the site. The top bar is always there: Explore for the globe and calendar, Trust for the method and tests, Your data for exports.</p>
        </div>
        <div className="how">
          <ol className="steps rv">
            {CLIPS.map((c, i) => {
              let cls = "step";
              let scale = 0;
              if (i === clip) {
                cls = "step on";
                scale = progress;
              }
              return (
                <li key={c.name}>
                  <button className={cls} onClick={() => setClip(i)} aria-pressed={i === clip}>
                    <span className="sn">{"0" + (i + 1)}</span>
                    <span className="st">{c.title}</span>
                    <span className="sw">{c.where}</span>
                    <span className="sd">{c.text}</span>
                    <span className="sg">{c.get}</span>
                    <i className="sp"><b style={{ transform: "scaleX(" + scale.toFixed(3) + ")" }} /></i>
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="player rv" id="howplayer">
            <div className="chrome"><i /><i /><i /><span className="url">{CLIPS[clip].url}</span><button type="button" className="demo sound" onClick={toggleSound} aria-pressed={!muted}>{soundLabel}</button></div>
            <div className="vidbox"><video id="howvid" muted playsInline preload="metadata" poster={TOUR_POSTER} aria-label={CLIPS[clip].cap} /></div>
            <div className="cap">
              <span>{CLIPS[clip].cap}</span>
              <a className="go" href={CLIPS[clip].go[1]} onClick={(event) => { event.preventDefault(); goTo(CLIPS[clip].go[1]); }}>{CLIPS[clip].go[0]}</a>
            </div>
          </div>
        </div>
        <div className="ans">
          {ANSWERS.map((row) => (
            <div className="a rv" key={row[0]}><span className="ak">{row[0]}</span><b>{row[1]}</b><p>{row[2]}</p></div>
          ))}
        </div>
      </section>

      <section className="scene" id="service">
        <div className="eyebrow">Fire record as a service</div>
        <Split text="End-to-end" />
        <div className="svc-head rv">
          <p className="title">From a hot pixel in orbit to <b>one number you can compare</b> across 25 years.</p>
          <p className="desc">You pick a region and a season. Chronos handles the rest — the satellites, the grid, the cloud gaps, the sensor switch in 2012 — and hands back a calendar with its uncertainty attached.</p>
        </div>
        <div className="svc">
          {SERVICE.map((card, i) => (
            <button type="button" className="sc rv" key={card[0]} style={{ transitionDelay: i * 90 + "ms" }} onClick={() => navigate(SERVICE_GO[i][0])} aria-label={card[1] + ": " + SERVICE_GO[i][1]}>
              <img src={card[4]} alt="" style={card[5]} />
              <span className="n">{card[0]}</span>
              <span className="sc-go">{SERVICE_GO[i][1]}<em>→</em></span>
              <h3>{card[1]}</h3>
              <p>{card[2]}</p>
              <span className="hchip">{card[3]}</span>
            </button>
          ))}
        </div>
        <div className="stats rv">
          <div><b>2000</b><span>Record starts · Terra</span></div>
          <div><b>0.1°</b><span>Common grid</span></div>
          <div><b>14 yr</b><span>Sensor overlap</span></div>
          <div><b>95%</b><span>Stated interval</span></div>
        </div>
      </section>

      <section className="scene" id="satellites">
        <div className="eyebrow">Two sensors · one record</div>
        <Split text="Satellites" />
        <div className="tabs">
          <a href="#dossier-modis" className={tabCls.modis} onClick={(event) => { event.preventDefault(); scrollToPin(0.06, "dossier-modis"); }}>MODIS · 2000 →</a>
          <a href="#dossier-viirs" className={tabCls.viirs} onClick={(event) => { event.preventDefault(); scrollToPin(0.56, "dossier-viirs"); }}>VIIRS · 2012 →</a>
          <a href="#dossier-compare" className={tabCls.compare} onClick={(event) => { event.preventDefault(); scrollToId("dossier-compare"); }}>Compare</a>
        </div>
        <div className="satpin" id="satpin">
          <div className="satpin-stick">
        <Dossier
          id="dossier-modis"
          visOrder={2}
          halo="rgba(255,181,71,.16)"
          imgAlt="Aqua satellite, 3D model that opens into labelled parts as you scroll"
          imgLabel="AQUA · 3D RECONSTRUCTION FROM PUBLIC NASA DIAGRAMS · NOT CAD"
          color="var(--hmodis)"
          eyebrow="The old ruler · since 2000"
          name="MODIS"
          carriers="TERRA (1999) · AQUA (2002)"
          text="The Moderate Resolution Imaging Spectroradiometer started the global fire record. Two copies fly on two satellites, so every place on Earth is seen up to four times a day — but each fire pixel is 1 km wide."
          overview={MODIS_OV}
          spec={MODIS_SPEC}
        />
        <Dossier
          id="dossier-viirs"
          visOrder={2}
          halo="rgba(61,214,245,.14)"
          imgAlt="Suomi NPP satellite, 3D model that opens into labelled parts as you scroll"
          imgLabel="SUOMI NPP · 3D RECONSTRUCTION FROM PUBLIC NASA DIAGRAMS · NOT CAD"
          color="var(--hviirs)"
          eyebrow="The new ruler · since 2012"
          name="VIIRS"
          carriers="SUOMI NPP (2011) · NOAA-20 (2017) · NOAA-21 (2022)"
          text="The Visible Infrared Imaging Radiometer Suite sees fire at 375 m — small farm burns MODIS misses become visible. Sharper eyes mean more fires counted, which is exactly why the two records cannot simply be stacked."
          overview={VIIRS_OV}
          spec={VIIRS_SPEC}
        />
            <div className="satpin-hud" aria-label="Jump to a satellite">
              <button type="button" className={tabCls.modis} onClick={() => jumpSat("modis")}>01 · Aqua · inside MODIS</button>
              <button type="button" className={tabCls.viirs} onClick={() => jumpSat("viirs")}>02 · Suomi NPP · inside VIIRS</button>
              <button type="button" className={tabCls.compare} onClick={() => jumpSat("compare")}>03 · Compare both</button>
            </div>
          </div>
        </div>
        <div className="cmp rv" id="dossier-compare">
          <div className="eyebrow">Same field · two rulers</div>
          <div className="cmp-row" style={{ marginTop: 14 }}>
            <span className="k">Pixel at nadir</span>
            <div className="pix">
              <svg width="80" height="80" aria-hidden="true"><rect x="1" y="1" width="78" height="78" fill="rgba(255,181,71,.12)" stroke="#FFB547" /><circle cx="52" cy="30" r="4" fill="#FF4D5E" /></svg>
              <span className="mono" style={{ color: "var(--hmodis)" }}>MODIS · 1 km</span>
            </div>
            <div className="pix">
              <svg width="80" height="80" aria-hidden="true"><g stroke="#3DD6F5" fill="none" opacity=".7"><rect x="1" y="1" width="78" height="78" /><path d="M28 1V79M54 1V79M1 28H79M1 54H79" /></g><rect x="45" y="20" width="9" height="8" fill="#FF4D5E" /></svg>
              <span className="mono" style={{ color: "var(--hviirs)" }}>VIIRS · 375 m (≈7× more detail)</span>
            </div>
          </div>
          <div className="cmp-row"><span className="k">Overpass</span><span>~10:30 (Terra) · ~13:30 (Aqua)</span><span>~13:30 (all three)</span></div>
          <div className="cmp-row"><span className="k">Confidence</span><span>0–100 (sensor-native)</span><span>low · nominal · high</span></div>
          <div className="cmp-row"><span className="k">Record</span><span>2000 → ending (Terra Feb 2027, Aqua Sep 2027)</span><span>2012 → 2030s</span></div>
        </div>
      </section>

      <section className="scene" id="calendar">
        <div className="eyebrow">Historical fire calendar · any region on Earth</div>
        <Split text="Calendar" />
        <p className="desc rv" style={{ maxWidth: 640, marginTop: 30 }}>Pick any region and the archive pipeline builds its 25-year calendar. Each row is a year, each cell a month: MODIS before the line, VIIRS after it. The jump at the line is the seam Chronos removes.</p>
        <div className="cal rv">
          <div className="cal-top">
            <span className="eyebrow" style={{ fontSize: 11 }}>Fire cell-days · raw</span>
            <span className="sim">{calendarTag + " · " + calendarRegion.toUpperCase()}</span>
          </div>
          {heat}
        </div>
      </section>

      <section className="scene" id="mission">
        <div className="eyebrow">Mission control</div>
        <Split text="Control" />
        <div className="mc">
          <div className="mtile big rv">
            <img src="/img/earth_quarter.webp" alt="" />
            <div>
              <div className="eyebrow">Overpasses · whole Earth</div>
              <b style={{ fontSize: 30 }}>TWICE A DAY</b>
              <small>Each polar orbiter sees every place ~13:30 and ~01:30 local · Suomi NPP data ends 02 NOV 2026</small>
            </div>
          </div>
          <div className="mtile rv"><div className="eyebrow">Detections · latest day</div><b>{todayValue}</b><small>{todayNote}</small></div>
          <div className="mtile rv"><div className="eyebrow">Exchange rate k · November</div><b>{kValue}</b><small>{kNote}</small></div>
          <div className="mtile rv"><div className="eyebrow">Sensor health</div><b style={{ color: "var(--hok)", fontSize: 32 }}>● NOMINAL</b><small>live status: open Source Health</small></div>
          <div className="mtile rv"><div className="eyebrow">Blind-spot flag</div><b style={{ color: "var(--hmodis)", fontSize: 32 }}>LATE FIRES</b><small>burns after 15:00 may be under-counted</small></div>
        </div>
      </section>

      <section className="scene" id="next">
        <div className="eyebrow">Where to next · the rest of the site</div>
        <Split text="Go further" />
        <p className="desc rv" style={{ maxWidth: 680, marginTop: 30 }}>This page tells the story. The tools live one click away — each card opens a page, and the top bar takes you back here from anywhere.</p>
        <div className="next">
          {NEXT.map((card, i) => (
            <a className="nc rv" key={card[0]} href={card[4]} style={{ "--c": card[5], transitionDelay: i * 80 + "ms" }} onClick={(event) => { event.preventDefault(); navigate(card[4]); }}>
              <span className="n">{card[0]}</span>
              <b>{card[1]}</b>
              <p>{card[2]}</p>
              <span className="route">{card[3]}</span>
              <span className="arrow">→</span>
            </a>
          ))}
        </div>
      </section>

      <footer className="hfoot">
        <span className="fl"><img src="/logo_ribbon_anim.svg" alt="" />FIREWORK</span>
        <span>NASA Space Apps 2026 · data: NASA FIRMS / LANCE · research decision support, not a life-safety alert</span>
      </footer>
    </div>
  );
}
