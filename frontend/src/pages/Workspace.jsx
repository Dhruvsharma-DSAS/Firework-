import { GuideCue } from "../components/PageGuide.jsx";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getMode, setMode } from "../lib/sourceMode.js";
import "../styles/pagedoc.css";
import "../styles/yourdata.css";

const KEY = "fc-saved-views";

const TARGETS = [
  ["/calendar/world", "Calendar · Whole Earth", "Month × year fire record, 2000–2025"],
  ["/calendar/punjab_haryana", "Calendar · Punjab–Haryana", "The stubble-burning season, year by year"],
  ["/explore", "Explorer globe", "Hot pixels of the last days on the 3D Earth"],
  ["/sensors", "Sensor Lab", "MODIS and VIIRS side by side"],
  ["/sources", "Ground under fires", "Land-cover type below each hot pixel"],
  ["/blind-spot", "Blind Spot", "When the satellites are not looking"],
  ["/brief/punjab_haryana", "Brief · Punjab–Haryana", "One printable page for a region"],
];

const MODE_LABELS = {
  demo: "Demo data",
  archive: "Archive",
  live: "Live",
};

function readSaved() {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        return list;
      }
    }
  } catch (error) {
    return [];
  }
  return [];
}

function writeSaved(list) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch (error) {
    return false;
  }
}

function targetOf(path) {
  const found = TARGETS.find((t) => t[0] === path);
  if (found) {
    return found;
  }
  return [path, path, ""];
}

function when(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return "";
  }
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) + " · " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export default function Workspace() {
  const navigate = useNavigate();
  const [views, setViews] = useState(readSaved());
  const [name, setName] = useState("");
  const [path, setPath] = useState(TARGETS[0][0]);
  const [note, setNote] = useState("");

  useEffect(() => {
    document.title = "Workspace · FIREWORK CHRONOS";
  }, []);

  function save(event) {
    event.preventDefault();
    const target = targetOf(path);
    let label = name.trim();
    if (!label) {
      label = target[1];
    }
    const next = [{ name: label, path: path, mode: getMode(), saved: new Date().toISOString() }].concat(views);
    setViews(next);
    setName("");
    if (writeSaved(next)) {
      setNote("Saved “" + label + "”.");
    } else {
      setNote("This browser blocks local storage, so the view will be lost on reload.");
    }
  }

  function remove(index) {
    const next = views.filter((v, i) => i !== index);
    setViews(next);
    writeSaved(next);
    setNote("");
  }

  function open(view) {
    if (view.mode) {
      setMode(view.mode);
    }
    navigate(view.path);
  }

  let list = (
    <div className="yd-empty">
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r="46" fill="none" stroke="currentColor" strokeOpacity="0.18" />
        <ellipse cx="60" cy="60" rx="58" ry="18" fill="none" stroke="currentColor" strokeOpacity="0.22" transform="rotate(-18 60 60)" />
        <path d="M46 34h28v50l-14-10-14 10z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <circle cx="111" cy="44" r="3" fill="var(--fire-mark)" />
      </svg>
      <div>
        <b>No saved views yet</b>
        <p>Save the Whole-Earth calendar now, or any page you come back to often. It will appear here as a card you can open with one click.</p>
      </div>
    </div>
  );
  if (views.length > 0) {
    list = (
      <ul className="yd-views">
        {views.map((v, i) => {
          const target = targetOf(v.path);
          let mode = null;
          if (v.mode) {
            mode = <span className={"yd-mode " + v.mode}>{MODE_LABELS[v.mode] || v.mode}</span>;
          }
          return (
            <li key={v.saved + i}>
              <div className="yd-view-main">
                <b>{v.name}</b>
                <span>{target[1]} · <code>{v.path}</code></span>
                <small>Saved {when(v.saved)}</small>
              </div>
              {mode}
              <div className="yd-view-act">
                <button type="button" className="pd-btn small solid" onClick={() => open(v)}>Open</button>
                <button type="button" className="pd-btn small" onClick={() => remove(i)} aria-label={"Remove " + v.name}>Remove</button>
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  let savedNote = null;
  if (note) {
    savedNote = <p className="yd-saved" role="status">{note}</p>;
  }

  return (
    <div className="pd yd">
      <header className="pd-head ph" style={{ "--ph": "var(--user)" }}>
        <div>
          <div className="eyebrow">Your data · Workspace</div>
          <h1 className="ph-title">Saved <em>views</em></h1>
          <p className="ph-q">Saved views</p>
          <GuideCue selector=".pd-sec" />
          <p className="pd-lead">A saved view is a bookmark inside FIREWORK: a page, the region it shows, and the data source you were using — Demo, Archive or Live. Open it later and you land exactly there.</p>
        </div>
      </header>

      <section className="pd-sec">
        <div className="pd-margin"><b>New view</b><span>Two fields</span></div>
        <div className="pd-col">
          <form className="yd-form" onSubmit={save}>
            <label className="pd-field">
              <span>Name</span>
              <input className="pd-input" placeholder="e.g. Punjab, Oct–Nov peak" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} />
            </label>
            <label className="pd-field">
              <span>Page to save</span>
              <select className="pd-select" value={path} onChange={(event) => setPath(event.target.value)}>
                {TARGETS.map((t) => <option key={t[0]} value={t[0]}>{t[1]}</option>)}
              </select>
            </label>
            <button type="submit" className="pd-btn solid">Save view</button>
          </form>
          <p className="yd-form-hint">{targetOf(path)[2]}. The current data source (<b>{MODE_LABELS[getMode()]}</b>) is saved with it.</p>
          {savedNote}
        </div>
      </section>

      <section className="pd-sec">
        <div className="pd-margin"><b>Your views</b><span>{views.length} saved</span></div>
        <div className="pd-col">{list}</div>
      </section>

      <section className="pd-sec">
        <div className="pd-margin"><b>How it works</b><span>Three steps</span></div>
        <div className="pd-col">
          <ol className="pd-steps">
            <li><b>Pick a page and give it a name</b><span>Choose the calendar, globe or brief you want to keep, and a name you will recognise later.</span></li>
            <li><b>The data source comes with it</b><span>Whether you were looking at Demo, Archive or Live data is stored, so a saved demo view never reopens as if it were real data.</span></li>
            <li><b>Open it from here</b><span>One click switches the data source back and takes you to the page.</span></li>
          </ol>
          <div className="pd-aside yd-store"><b>Where views are kept.</b> In this browser’s local storage, on this device only. Clearing site data or using a private window removes them. Accounts that sync views across devices (Supabase) are planned; each synced view will also keep its configuration hash and method version so the numbers can be reproduced.</div>
        </div>
      </section>
    </div>
  );
}
