import { NavLink, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { setMode, useSourceMode } from "../lib/sourceMode.js";

const GROUPS = [
  { id: "explore", label: "Explore", pages: [
    ["/explore", "Explorer", "globe"],
    ["/calendar/punjab_haryana", "Calendar", "month × year"],
    ["/sensors", "Sensor Lab", "MODIS vs VIIRS"],
    ["/sources", "Sources", "what burns"],
    ["/blind-spot", "Blind Spot", "missed fires"],
    ["/fire-clock", "Fire Clock", "hidden hours"],
  ] },
  { id: "trust", label: "Trust", pages: [
    ["/validation", "Validation", "gates G1–G12"],
    ["/formulas", "Formulas", "F01–F46"],
    ["/sources/health", "Source Health", "feeds"],
  ] },
  { id: "data", label: "Your data", pages: [
    ["/studio", "Data Studio", "upload"],
    ["/me", "Workspace", "saved views"],
    ["/brief/punjab_haryana", "Brief", "print"],
  ] },
  { id: "learn", label: "Learn", pages: [
    ["/learn", "Learn", "15 lessons"],
    ["/satellites", "Satellites", "fleet in 3D"],
    ["/guide", "Website guide", "tour of every page"],
  ] },
];

const SOURCES = [
  ["demo", "Demo", "Teaching data shipped with the site. Not real fires; see Learn → Demo data"],
  ["archive", "Archive", "NASA FIRMS standard processing (MODIS + VIIRS S-NPP), 5–6 Nov 2025"],
  ["live", "Live", "NASA FIRMS near-real-time feed, last 1–5 days"],
];

const KEYWORDS = {
  "/": "start story intro overview mission",
  "/explore": "globe map earth hotspots fires live nrt satellites terra aqua snpp noaa land cover burned clear sky 3d 2d",
  "/calendar/punjab_haryana": "calendar month year history archive 2000 2025 country world k exchange rate harmonised punjab haryana stubble",
  "/sensors": "modis viirs compare sensors resolution pixel 375 1km satellite",
  "/sources": "what burns agriculture wildfire industrial gas flare land cover source class",
  "/blind-spot": "missed fires cloud small fires detection limit",
  "/fire-clock": "fire clock night share morning afternoon terra aqua hidden burning late afternoon punjab stubble timing shift",
  "/validation": "gates tests g1 g3 seam leave one year out accuracy proof",
  "/formulas": "math equations f01 f03 f05 f07 k bootstrap pooling local solar time",
  "/sources/health": "status feeds api firms earth engine uptime",
  "/studio": "upload csv my data import",
  "/me": "saved views workspace bookmarks",
  "/brief/punjab_haryana": "print report pdf summary",
  "/learn": "lessons course tutorial demo data explain beginner",
  "/satellites": "satellites terra aqua suomi npp noaa-20 noaa-21 modis viirs 3d model orbit fleet",
  "/guide": "tour video website guide help how to",
};

const EXTRA = [
  ["/calendar/world", "Whole-Earth calendar", "every country, 2000–2025", "Calendar"],
  ["/calendar/b_punjab_haryana", "Punjab + Haryana calendar", "stubble-burning seasons", "Calendar"],
  ["/calendar/c_bra", "Brazil calendar", "dry-season fires", "Calendar"],
  ["/calendar/c_usa", "United States calendar", "wildfire seasons", "Calendar"],
  ["/calendar/c_aus", "Australia calendar", "bushfire seasons", "Calendar"],
  ["/learn#data-modes", "Demo, Archive and Live", "lesson 15 · what the data switch loads", "Learn"],
];

function readTheme() {
  try {
    const saved = window.localStorage.getItem("fc-theme");
    if (saved === "light") {
      return "light";
    }
  } catch (error) {
    return "dark";
  }
  return "dark";
}

function Palette(props) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  useEffect(() => {
    const input = document.getElementById("palette-input");
    if (input) {
      input.focus();
    }
  }, []);

  const all = [["/", "Home", "story", "Home"]];
  GROUPS.forEach((g) => g.pages.forEach((p) => all.push([p[0], p[1], p[2], g.label])));
  EXTRA.forEach((p) => all.push(p));
  const q = query.trim().toLowerCase();
  const matches = all.filter((page) => {
    if (!q) {
      return page.length === 4;
    }
    const words = (KEYWORDS[page[0]] || "") + " " + page[1] + " " + page[2] + " " + page[3];
    return q.split(/\s+/).every((w) => words.toLowerCase().indexOf(w) >= 0);
  });
  const [cursor, setCursor] = useState(0);
  let active = cursor;
  if (active >= matches.length) {
    active = 0;
  }

  function go(path) {
    props.onClose();
    navigate(path);
  }

  function onKey(event) {
    if (event.key === "ArrowDown" && matches.length > 0) {
      event.preventDefault();
      setCursor((active + 1) % matches.length);
    } else if (event.key === "ArrowUp" && matches.length > 0) {
      event.preventDefault();
      setCursor((active - 1 + matches.length) % matches.length);
    } else if (event.key === "Enter" && matches.length > 0) {
      go(matches[active][0]);
    } else if (event.key === "Escape") {
      props.onClose();
    }
  }

  let list = (
    <ul>
      {matches.map((page, index) => {
        let cls = "";
        if (index === active) {
          cls = "on";
        }
        return (
          <li key={page[0] + page[1]}>
            <button className={cls} onMouseEnter={() => setCursor(index)} onClick={() => go(page[0])}>
              <b>{page[1]}</b>
              <em>{page[2]}</em>
              <span>{page[3]}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
  if (matches.length === 0) {
    list = <div className="palette-empty">Nothing matches “{query}”. Try fire, satellite, calendar, k, upload or lesson.</div>;
  }

  return createPortal(
    <div className="palette-back" onClick={props.onClose}>
      <div className="palette" role="dialog" aria-label="Search pages" onClick={(event) => event.stopPropagation()}>
        <div className="palette-in">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
          <input id="palette-input" placeholder="Search pages, satellites, formulas…" value={query} onChange={(event) => { setQuery(event.target.value); setCursor(0); }} onKeyDown={onKey} autoComplete="off" />
          <kbd>esc</kbd>
        </div>
        {list}
        <div className="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>esc</kbd> close</span></div>
      </div>
    </div>,
    document.body
  );
}

export default function TopBar(props) {
  const [theme, setTheme] = useState(readTheme());
  const mode = useSourceMode();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (theme === "light") {
      document.documentElement.setAttribute("data-theme", "light");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    try {
      window.localStorage.setItem("fc-theme", theme);
    } catch (error) {
      console.info("theme not saved");
    }
  }, [theme]);

  useEffect(() => {
    function onKey(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function switchTheme() {
    if (theme === "light") {
      setTheme("dark");
    } else {
      setTheme("light");
    }
  }

  let themeLabel = "☀";
  if (theme === "light") {
    themeLabel = "☾";
  }

  let activeIndex = 0;
  SOURCES.forEach((source, i) => {
    if (source[0] === mode) {
      activeIndex = i;
    }
  });

  let srcSwitch = (
    <div className={"srcswitch at-" + activeIndex}>
      <span className="srcswitch-k">Data</span>
      <div className="srcswitch-track" role="radiogroup" aria-label="Data source">
        <i className="srcswitch-bar" aria-hidden="true" />
        {SOURCES.map((source, i) => {
          let cls = "";
          if (i === activeIndex) {
            cls = "on";
          }
          return (
            <button key={source[0]} type="button" role="radio" aria-checked={i === activeIndex} className={cls} title={source[2]} onClick={() => setMode(source[0])}>
              <span className="srcswitch-dot" aria-hidden="true" />
              {source[1]}
            </button>
          );
        })}
      </div>
    </div>
  );
  if (props.group === "learn") {
    srcSwitch = null;
  }

  let current = GROUPS.find((g) => g.id === props.group);
  if (!current) {
    current = GROUPS[0];
  }

  let palette = null;
  if (open) {
    palette = <Palette onClose={() => setOpen(false)} />;
  }

  return (
    <header className="tb">
      <div className="tb-row">
        <NavLink to="/" className="tb-brand" aria-label="FIREWORK CHRONOS home">
          <img src="/logo_ribbon_anim.svg" alt="" />
          <span><b>FIREWORK</b><small>CHRONOS · FIRE RECORD</small></span>
        </NavLink>
        <nav className="tb-pill" aria-label="Sections">
          <NavLink to="/" end>Home</NavLink>
          {GROUPS.map((g) => {
            let cls = "";
            if (g.id === props.group) {
              cls = "on";
            }
            return <NavLink key={g.id} to={g.pages[0][0]} className={cls}>{g.label}</NavLink>;
          })}
        </nav>
        <div className="tb-tools">
          <button className="kfield" onClick={() => setOpen(true)} aria-label="Search pages">
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
            <span className="kfield-t">Jump to…</span>
            <kbd>⌘K</kbd>
          </button>
          <button className="iconbtn" onClick={switchTheme} aria-label="Switch colour theme">{themeLabel}</button>
        </div>
      </div>
      <div className="tb-sub">
        <nav className="tb-pages" aria-label={current.label + " pages"}>
          <span className="tb-group">{current.label}</span>
          {current.pages.map((p) => (
            <NavLink key={p[0]} to={p[0]}>
              {p[1]}
              <small>{p[2]}</small>
            </NavLink>
          ))}
        </nav>
        {srcSwitch}
      </div>
      {palette}
    </header>
  );
}
