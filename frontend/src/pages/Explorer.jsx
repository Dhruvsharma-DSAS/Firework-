import PageGuide, { GuideCue } from "../components/PageGuide.jsx";
import { useEffect, useState } from "react";
import GlobeView, { satIcon } from "../components/GlobeView.jsx";
import { PLATFORM_COLORS } from "../lib/colors.js";
import LayerPanel from "../components/LayerPanel.jsx";
import Inspector from "../components/Inspector.jsx";
import SatelliteCard from "../components/SatelliteCard.jsx";
import { positionOf } from "../lib/orbits.js";
import FlatView from "../components/FlatView.jsx";
import Legend from "../components/Legend.jsx";
import TimeStrip from "../components/TimeStrip.jsx";
import StatusChip from "../components/StatusChip.jsx";
import { HourChart, DailyChart, FrpChart, SourceBars, CountryBars, DayNight } from "../components/ExplorerCharts.jsx";
import { loadDetections, loadCountries, loadSatellites, loadRegions, loadCalendar, loadContext } from "../api/data.js";
import { statusOf } from "../api/client.js";
import { getMode, ARCHIVE_DATE, LIVE_SOURCES, ARCHIVE_SOURCES } from "../lib/sourceMode.js";
import { loadLandCover, landCoverAt } from "../lib/landcover.js";
import FetchTracker from "../components/FetchTracker.jsx";
import { cellIndex, cellAreaKm2, haversineKm, nearestPoint, countryAt, isDaylight, inBbox, localSolarHour } from "../lib/geo.js";
import { subsolarPoint } from "../lib/orbits.js";

const PLACES = [
  { name: "Whole Earth", lat: 15, lng: 40, altitude: 2.4 },
  { name: "Africa", lat: -5, lng: 22, altitude: 1.5 },
  { name: "Amazon", lat: -10, lng: -55, altitude: 1.4 },
  { name: "South Asia", lat: 25, lng: 80, altitude: 1.3 },
  { name: "Australia", lat: -22, lng: 134, altitude: 1.5 },
  { name: "Siberia", lat: 60, lng: 110, altitude: 1.5 },
  { name: "N. America", lat: 45, lng: -105, altitude: 1.7 },
];

const CELL_MODES = [
  ["pixels", "Hot pixels", "Colour each cell by how many hot pixels fall inside it"],
  ["frp", "Fire power", "Colour each cell by its strongest fire (max FRP)"],
  ["sensor", "MODIS vs VIIRS", "Colour each cell by which sensor saw its pixels"],
];

const WORLD = { id: "world", name: "Whole Earth", country: null, bbox: [-180, -90, 180, 90] };

function passesQa(point, qa) {
  if (qa === "all") {
    return true;
  }
  if (point.sensor === "MODIS") {
    const value = Number(point.conf);
    if (qa === "high") {
      return value >= 80;
    }
    return value >= 30;
  }
  if (qa === "high") {
    return point.conf === "h";
  }
  return point.conf === "n" || point.conf === "h";
}

function bboxText(bbox) {
  return bbox.map((v) => Number(v).toFixed(1)).join(", ");
}

function viewOfBbox(bbox) {
  const span = Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1]);
  let altitude = span / 30;
  if (altitude < 0.85) {
    altitude = 0.85;
  }
  if (altitude > 2.4) {
    altitude = 2.4;
  }
  return { lat: (bbox[1] + bbox[3]) / 2, lng: (bbox[0] + bbox[2]) / 2, altitude: altitude };
}

function bboxOfFeature(feature) {
  const box = [180, 90, -180, -90];
  function walk(coords) {
    if (typeof coords[0] === "number") {
      box[0] = Math.min(box[0], coords[0]);
      box[1] = Math.min(box[1], coords[1]);
      box[2] = Math.max(box[2], coords[0]);
      box[3] = Math.max(box[3], coords[1]);
      return;
    }
    coords.forEach(walk);
  }
  walk(feature.geometry.coordinates);
  return box;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

function median(values) {
  if (values.length === 0) {
    return null;
  }
  const s = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length % 2 === 0) {
    return (s[mid - 1] + s[mid]) / 2;
  }
  return s[mid];
}

function describeProbe(probe, points, countries) {
  const cell = cellIndex(probe.lat, probe.lon, 0.1);
  const props = countryAt(countries, probe.lat, probe.lon);
  let place = "Open ocean";
  if (props) {
    place = props.name;
  }
  const now = new Date();
  const lst = localSolarHour(now.getUTCHours() + now.getUTCMinutes() / 60, probe.lon);
  const daylight = isDaylight(probe.lat, probe.lon, subsolarPoint(now));
  const near = { n: 0, m: 0, v: 0, night: 0 };
  const nearRows = [];
  const inCell = [];
  points.forEach((p) => {
    if (Math.abs(p.lat - probe.lat) > 1) {
      return;
    }
    const km = haversineKm(probe.lat, probe.lon, p.lat, p.lon);
    if (km <= 50) {
      near.n = near.n + 1;
      nearRows.push(p);
      if (p.sensor === "MODIS") {
        near.m = near.m + 1;
      } else {
        near.v = near.v + 1;
      }
      if (p.dn === "N") {
        near.night = near.night + 1;
      }
    }
    const c = cellIndex(p.lat, p.lon, 0.1);
    if (c && c.id === cell.id) {
      inCell.push(p);
    }
  });
  const days = [];
  const mix = {};
  let maxFrp = 0;
  inCell.forEach((p) => {
    if (days.indexOf(p.date) < 0) {
      days.push(p.date);
    }
    mix[p.cls] = (mix[p.cls] || 0) + 1;
    maxFrp = Math.max(maxFrp, p.frp || 0);
  });
  let mixKey = "UNKNOWN";
  let mixCount = 0;
  Object.keys(mix).forEach((k) => {
    if (mix[k] > mixCount) {
      mixKey = k;
      mixCount = mix[k];
    }
  });
  let nearest = null;
  const np = nearestPoint(points, probe.lat, probe.lon, 150);
  if (np) {
    nearest = { km: haversineKm(probe.lat, probe.lon, np.lat, np.lon), sensor: np.sensor };
  }
  let hex = null;
  if (probe.hex && probe.hex.length > 0) {
    let frp = 0;
    let m = 0;
    let top = 0;
    let dayN = 0;
    probe.hex.forEach((p) => {
      frp = frp + (p.frp || 0);
      if (p.sensor === "MODIS") {
        m = m + 1;
      }
      if ((p.frp || 0) > top) {
        top = p.frp || 0;
      }
      if (p.dn === "D") {
        dayN = dayN + 1;
      }
    });
    hex = { n: probe.hex.length, m: m, v: probe.hex.length - m, meanFrp: frp / probe.hex.length, maxFrp: top, dayShare: Math.round((100 * dayN) / probe.hex.length) };
  }
  const cellTimes = inCell.filter((p) => typeof p.lmst === "number").map((p) => p.lmst).sort((a, b) => a - b);
  return {
    lat: probe.lat,
    lon: probe.lon,
    place: place,
    iso3: (props && props.iso3) || "",
    lst: lst,
    daylight: daylight,
    ground: landCoverAt(probe.lat, probe.lon),
    cell: { id: cell.id, area: cellAreaKm2(cell.row, 0.1), n: inCell.length, days: days.length, maxFrp: maxFrp, mixKey: mixKey, mixShare: Math.round((100 * mixCount) / Math.max(1, inCell.length)) },
    near: near,
    nearRows: nearRows,
    nearest: nearest,
    hex: hex,
    cellTimes: cellTimes,
  };
}

const SHORT = { terra: "Terra", aqua: "Aqua", snpp: "S-NPP", noaa20: "NOAA-20", noaa21: "NOAA-21" };

function pinHtml(info) {
  const rows = [
    ["Position", info.lat.toFixed(2) + "°, " + info.lon.toFixed(2) + "°"],
    ["0.1° cell", info.cell.id],
    ["Ground", info.ground || "–"],
    ["Pixels in cell", String(info.cell.n)],
    ["Pixels ≤ 50 km", String(info.near.n)],
  ];
  if (info.hex) {
    rows.push(["Hex pixels", String(info.hex.n)]);
  }
  let when = "night";
  if (info.daylight) {
    when = "day";
  }
  const seen = {};
  info.nearRows.forEach((p) => {
    seen[p.platform] = (seen[p.platform] || 0) + 1;
  });
  let sats = '<div class="pc-sats pc-none">No satellite saw fire within 50 km</div>';
  const ids = ["terra", "aqua", "snpp", "noaa20", "noaa21"].filter((id) => seen[id]);
  if (ids.length > 0) {
    sats = '<div class="pc-sats">' + ids.map((id) => '<span style="color:' + (PLATFORM_COLORS[id] || "#fff") + '">' + satIcon(id) + "<i>" + escapeHtml(SHORT[id]) + " " + seen[id] + "</i></span>").join("") + "</div>";
  }
  return '<div class="pc-k">Location · ' + when + "</div>" +
    '<div class="pc-t">' + escapeHtml(info.place) + "</div>" +
    rows.map((r) => '<div class="pc-r"><span>' + r[0] + "</span><b>" + escapeHtml(r[1]) + "</b></div>").join("") +
    '<div class="pc-k" style="margin-top:8px">Seen by · within 50 km</div>' + sats;
}

const EX_GUIDE = {
  eyebrow: "Guide · Explorer",
  title: "How to read the Explorer",
  intro: "Every fire pixel NASA FIRMS reports, on one Earth. Each part below explains one control or view, with a link to the lesson or formula behind it.",
  accent: "var(--viirs)",
  watch: [
    { to: "/guide#ch-2", title: "Watch the Explorer chapter", sub: "Website guide video · narrated walk-through" },
    { to: "/learn#lesson-01", title: "Lesson 01 · How a satellite sees fire", sub: "Video and PDF · what a hot pixel is" },
    { to: "/learn#lesson-07", title: "Lesson 07 · Meet the satellites", sub: "Video and PDF · Terra, Aqua, S-NPP, NOAA-20, NOAA-21" },
  ],
  cards: [
    { title: "A dot is a hot pixel, not a fire", text: "Each point is one FIRMS detection: a 1 km MODIS pixel or a 375 m VIIRS pixel that was hotter than its surroundings. Only nominal and high confidence pass, using each sensor's own confidence scale.", links: [{ label: "F07 Confidence filter", to: "/formulas/F07" }, { label: "Lesson 02", to: "/learn#lesson-02" }] },
    { title: "Three ways to see the Earth", text: "3D columns rise with log(1 + fire radiative power). 3D cells group pixels into 0.1° grid cells. 2D map is a flat view for reading coordinates. Switch with the View buttons beside the globe.", links: [{ label: "F03 Grid cell", to: "/formulas/F03" }, { label: "F21 Log FRP", to: "/formulas/F21" }] },
    { title: "Colour by", text: "Heat colours each pixel by fire radiative power in megawatts. Sensor shows MODIS in amber and VIIRS in cyan. Source shows the probable kind of fire, and stays UNKNOWN when the evidence is weak.", links: [{ label: "Lesson 10 · fire power", to: "/learn#lesson-10" }, { label: "Lesson 09 · sources", to: "/learn#lesson-09" }] },
    { title: "Click any place", text: "A card pins to the spot: its 0.1° cell and area, the pixels inside it and within 50 km, the ground type from ESA WorldCover, and which satellites saw fire there. Esc clears it.", links: [{ label: "F04 Cell area", to: "/formulas/F04" }, { label: "F40 Distance", to: "/formulas/F40" }] },
    { title: "Satellites and timing", text: "Ground tracks show where each satellite is now; point at one for its 3D model and facts. Polar satellites pass each place at fixed local solar times, so fires that burn between passes can be missed.", links: [{ label: "F01 Local solar time", to: "/formulas/F01" }, { label: "F45 Diurnal fraction", to: "/formulas/F45" }] },
    { title: "Live, Archive or Demo", text: "The switch at the top right decides the data: Live is NASA's near-real-time feed, Archive is the reprocessed standard record, Demo is a labelled teaching set that works offline.", links: [{ label: "Lesson 15 · data switch", to: "/learn#data-modes" }, { label: "Lesson 14 · live feed", to: "/learn#lesson-14" }] },
  ],
};

export default function Explorer() {
  const [all, setAll] = useState([]);
  const [meta, setMeta] = useState(null);
  const [countries, setCountries] = useState([]);
  const [regions, setRegions] = useState([]);
  const [satellites, setSatellites] = useState([]);
  const [calendar, setCalendar] = useState(null);
  const [error, setError] = useState("");
  const [layers, setLayers] = useState({ viirs: true, modis: true, density: true, terminator: true, tracks: true, borders: true, rings: true, points: true, burned: false, landcover: false, clearsky: false });
  const [context, setContext] = useState({ layer: "", data: [], meta: null, status: "" });
  const [ctxImages, setCtxImages] = useState({});
  const [sat, setSat] = useState({ id: "", pinned: false });
  const satId = sat.id;

  const [pinOpen, setPinOpen] = useState(false);

  function probeAndClose(next) {
    setProbe(next);
    setPinOpen(Boolean(next));
    if (next) {
      setSat({ id: "", pinned: false });
    }
  }

  function onSatPointer(id, mode) {
    if (mode === "click") {
      setSat({ id: id, pinned: true });
      return;
    }
    setSat((prev) => {
      if (prev.pinned) {
        return prev;
      }
      if (mode === "leave") {
        return { id: "", pinned: false };
      }
      return { id: id, pinned: false };
    });
  }

  function pinSat(id) {
    setSat({ id: id, pinned: Boolean(id) });
  }

  function closeSat() {
    setSat({ id: "", pinned: false });
  }
  const [dn, setDn] = useState("both");
  const [qa, setQa] = useState("nominal");
  const [colorBy, setColorBy] = useState("frp");
  const [basemap, setBasemap] = useState("atlas");
  const [day, setDay] = useState("all");
  const [probe, setProbe] = useState(null);
  const [flyTo, setFlyTo] = useState(null);
  const [region, setRegion] = useState(WORLD);
  const [query, setQuery] = useState("Whole Earth");
  const [searching, setSearching] = useState(false);
  const [windowDays, setWindowDays] = useState(2);
  const [globeStyle, setGlobeStyle] = useState("columns");
  const [cellMode, setCellMode] = useState("pixels");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = "";
    ["burned", "landcover", "clearsky"].forEach((k) => {
      if (layers[k]) {
        active = k;
      }
    });
    if (!active) {
      setContext({ layer: "", data: [], meta: null, status: "" });
      return;
    }
    const wide = region.bbox[2] - region.bbox[0] > 30 || region.bbox[3] - region.bbox[1] > 30;
    if (active === "landcover" || wide) {
      setContext({ layer: active, data: [], meta: null, status: "image" });
      return;
    }
    setContext({ layer: active, data: [], meta: null, status: "loading from Earth Engine…" });
    loadContext(active, region.bbox)
      .then((result) => setContext({ layer: active, data: result.data, meta: result.meta, status: "ok" }))
      .catch((err) => setContext({ layer: active, data: [], meta: null, status: String(err.message || err) }));
  }, [layers.burned, layers.landcover, layers.clearsky, region]);

  useEffect(() => {
    setLoading(true);
    setDay("all");
    let sources = LIVE_SOURCES;
    let startDate = "";
    if (getMode() === "archive") {
      sources = ARCHIVE_SOURCES;
      startDate = ARCHIVE_DATE;
    }
    loadDetections(sources, windowDays, startDate)
      .then((result) => {
        setAll(result.data);
        setMeta(result.meta);
        setError("");
        setLoading(false);
      })
      .catch((err) => {
        setError(String(err));
        setLoading(false);
      });
  }, [windowDays]);

  useEffect(() => {
    document.title = "Explorer · FIREWORK CHRONOS";
    loadCountries().then((result) => setCountries(result.data.features)).catch(() => setCountries([]));
    loadSatellites().then((result) => setSatellites(result.data)).catch(() => setSatellites([]));
    loadRegions().then((result) => setRegions(result.data)).catch(() => setRegions([]));
    loadCalendar("punjab_haryana").then((result) => setCalendar(result.data)).catch(() => setCalendar(null));
    fetch("/textures/context/manifest.json")
      .then((r) => r.json())
      .then((m) => {
        setCtxImages(m);
        if (m.landcover) {
          loadLandCover("/textures/context/" + m.landcover.file);
        }
      })
      .catch(() => setCtxImages({}));
  }, []);

  useEffect(() => {
    function onKey(event) {
      if (event.key === "Escape") {
        setProbe(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const days = [];
  all.forEach((p) => {
    if (days.indexOf(p.date) < 0) {
      days.push(p.date);
    }
  });
  days.sort();

  const filtered = all.filter((p) => {
    if (p.sensor === "VIIRS" && !layers.viirs) {
      return false;
    }
    if (p.sensor === "MODIS" && !layers.modis) {
      return false;
    }
    if (dn !== "both" && p.dn !== dn) {
      return false;
    }
    if (day !== "all" && p.date !== day) {
      return false;
    }
    return passesQa(p, qa);
  });

  let scope = filtered;
  let scopeName = "Whole Earth";
  if (region.id !== "world") {
    scope = filtered.filter((p) => inBbox(p, region.bbox));
    scopeName = query;
  }

  const counts = {};
  all.forEach((p) => {
    if (!counts[p.date]) {
      counts[p.date] = { total: 0, MODIS: 0, VIIRS: 0 };
    }
    counts[p.date].total = counts[p.date].total + 1;
    counts[p.date][p.sensor] = counts[p.date][p.sensor] + 1;
  });

  let period = "7 days";
  if (days.length > 0) {
    period = days[0].slice(5) + " → " + days[days.length - 1].slice(5);
  }
  if (day !== "all") {
    period = day;
  }
  if (getMode() === "archive" && day === "all") {
    period = "Archive points: 5–6 Nov 2025 only";
  }

  let highlight = "";
  if (region.country) {
    const match = countries.find((f) => f.properties.name === region.country);
    if (match) {
      highlight = match.properties.iso3;
    }
  }
  if (region.iso3) {
    highlight = region.iso3;
  }

  let info = null;
  let pin = null;
  if (probe) {
    info = describeProbe(probe, filtered, countries);
    if (pinOpen) {
      pin = { lat: probe.lat, lon: probe.lon, html: pinHtml(info) };
    }
  }

  const m = scope.filter((p) => p.sensor === "MODIS").length;
  const v = scope.length - m;
  const night = scope.filter((p) => p.dn === "N").length;
  const total = Math.max(1, scope.length);
  const medFrp = median(scope.map((p) => p.frp || 0));
  let medFrpText = "—";
  if (medFrp !== null) {
    medFrpText = medFrp.toFixed(1);
  }

  const q = query.trim().toLowerCase();
  const options = [];
  if (searching) {
    [WORLD].concat(regions.filter((r) => r.id !== "world")).forEach((r) => {
      let label = r.name;
      if (r.country && r.country !== r.name) {
        label = r.name + ", " + r.country;
      }
      if (!q || label.toLowerCase().indexOf(q) >= 0) {
        options.push({ key: "r-" + r.id, label: label, note: "region", region: r });
      }
    });
    if (q.length > 1) {
      countries.filter((f) => f.properties.name.toLowerCase().indexOf(q) >= 0).slice(0, 6).forEach((f) => {
        options.push({ key: "c-" + f.properties.iso3, label: f.properties.name, note: "country", region: { id: f.properties.iso3, name: f.properties.name, iso3: f.properties.iso3, bbox: bboxOfFeature(f) } });
      });
    }
  }

  function chooseRegion(next) {
    setRegion(next);
    let label = next.name;
    if (next.country && next.country !== next.name) {
      label = next.name + ", " + next.country;
    }
    setQuery(label);
    setSearching(false);
    setProbe(null);
    setFlyTo(viewOfBbox(next.bbox));
  }

  function onSearchKey(event) {
    if (event.key === "Enter" && options.length > 0) {
      chooseRegion(options[0].region);
    }
    if (event.key === "Escape") {
      setSearching(false);
    }
  }

  let trackNote = "illustrative";
  if (satellites.length > 0 && satellites[0].tle1) {
    trackNote = "TLE";
  }

  let errorNote = null;
  if (error) {
    errorNote = <div className="note err small">Detections could not load ({error}). Nothing is drawn rather than zeros.</div>;
  }

  let searchList = null;
  if (searching && options.length > 0) {
    searchList = (
      <ul className="search-list" role="listbox">
        {options.slice(0, 9).map((opt) => (
          <li key={opt.key}><button onMouseDown={(event) => { event.preventDefault(); chooseRegion(opt.region); }}>{opt.label}<span>{opt.note}</span></button></li>
        ))}
      </ul>
    );
  }

  const demo = Boolean(meta && (meta.demo || meta.fallback_used));
  let sizeTag = null;
  if (meta && meta.rows_total) {
    let shown = meta.rows_total.toLocaleString() + " hot pixels from FIRMS";
    if (meta.sampled) {
      shown = shown + " · " + all.length.toLocaleString() + " drawn (random sample)";
    }
    sizeTag = <span className="chip"><span className="dot" style={{ background: "var(--good)" }} />{shown}</span>;
  }
  let loadingTag = null;
  if (loading) {
    loadingTag = <span className="chip"><span className="dot" />Loading NASA FIRMS…</span>;
  }
  let scopeNote = scopeName + " · " + period + " · confidence rule applied";
  const contextNotes = {};
  let overlayUrl = "";
  let overlayOpacity = 0.85;
  const ctxImage = ctxImages[context.layer];
  if (ctxImage && context.status !== "ok") {
    overlayUrl = "/textures/context/" + ctxImage.file;
    if (context.layer === "clearsky") {
      overlayOpacity = 0.7;
    } else if (context.layer === "landcover") {
      overlayOpacity = 0.78;
    } else {
      overlayOpacity = 0.95;
    }
  }
  if (context.layer) {
    let text = context.status;
    if (context.status === "image") {
      text = "World view is too large for this layer · search a country (≤ 30°) to load it";
      if (ctxImage && context.layer === "landcover") {
        text = "ESA WorldCover 2021 · 10 m map · click a place for its class";
      } else if (ctxImage) {
        text = "World · " + ctxImage.period + " · search a country for exact cell values";
      }
    }
    if (context.status === "ok" && context.meta) {
      const month = context.meta.month;
      let summary = context.meta.cells + " cells";
      if (context.layer === "burned") {
        let maxShare = 0;
        context.data.forEach((c) => {
          if (c.value > maxShare) {
            maxShare = c.value;
          }
        });
        summary = context.meta.cells + " cells burned · max " + Math.round(100 * maxShare) + "%";
      } else if (context.layer === "clearsky") {
        let sum = 0;
        context.data.forEach((c) => {
          sum = sum + c.value;
        });
        summary = "mean " + (sum / Math.max(1, context.data.length)).toFixed(1) + " clear days";
      } else {
        const counts = {};
        const land = context.data.filter((c) => c.value !== 80);
        land.forEach((c) => {
          counts[c.class] = (counts[c.class] || 0) + 1;
        });
        const top = Object.keys(counts).sort((a2, b2) => counts[b2] - counts[a2]).slice(0, 2);
        summary = top.map((k) => k + " " + Math.round((100 * counts[k]) / Math.max(1, land.length)) + "%").join(" · ") + " of land";
        text = summary + " · " + context.meta.grid_deg + "° grid";
      }
      if (context.layer !== "landcover") {
        text = month + " · " + summary + " · " + context.meta.grid_deg + "°";
      }
    }
    contextNotes[context.layer] = text;
  }
  if (meta && meta.sampled) {
    scopeNote = "of the " + all.length.toLocaleString() + " drawn · confidence rule applied";
  }
  let sourceSub = "Probable source class (demo labels, abstains as UNKNOWN).";
  if (!demo) {
    sourceSub = "Live FIRMS pixels are UNKNOWN until the land-cover join runs (Layer 2).";
  }

  let selectedPoint = null;
  if (probe && probe.point) {
    selectedPoint = probe.point;
  }

  let liveStatus = statusOf(meta);
  if (loading) {
    liveStatus = "LOADING";
  }
  let kpis = (
    <div className="ex-kpis">
      <div className="kpi"><div className="k">Hot pixels in scope</div><div className="v">{scope.length.toLocaleString()}</div><div className="s">{scopeNote}</div></div>
      <div className="kpi"><div className="k">MODIS · 1 km</div><div className="v" style={{ color: "var(--modis)" }}>{m.toLocaleString()}</div><div className="s">{Math.round((100 * m) / total)}% of scope</div></div>
      <div className="kpi"><div className="k">VIIRS · 375 m</div><div className="v" style={{ color: "var(--viirs)" }}>{v.toLocaleString()}</div><div className="s">{Math.round((100 * v) / total)}% of scope</div></div>
      <div className="kpi"><div className="k">Night detections</div><div className="v">{Math.round((100 * night) / total)}%</div><div className="s">{night.toLocaleString()} night-pass pixels</div></div>
      <div className="kpi"><div className="k">Median FRP</div><div className="v">{medFrpText}<span className="faint" style={{ fontSize: 16 }}> MW</span></div><div className="s">sensor-native, not harmonised</div></div>
    </div>
  );
  let globeClass = "ex-globe";
  let satCard = null;
  const hoveredSat = satellites.find((s) => s.id === satId);
  if (hoveredSat) {
    let satPos = null;
    try {
      satPos = positionOf(hoveredSat, new Date());
    } catch (error) {
      satPos = null;
    }
    satCard = <SatelliteCard sat={hoveredSat} position={satPos} onClose={closeSat} />;
  }
  let legend = <Legend colorBy={colorBy} density={layers.density} context={context.layer} />;
  let cellModes = null;
  let flatView = null;
  let hint = "Drag to rotate · scroll to zoom · click a place · Esc clears · © Natural Earth · tracks " + trackNote;
  if (globeStyle === "map") {
    globeClass = "ex-globe show-flat";
    hint = "Drag to pan · scroll or pinch to zoom · double-click to zoom in · click a place · © Natural Earth";
    flatView = (
      <FlatView
        hostId="explorer-flat"
        points={filtered}
        countries={countries}
        satellites={satellites}
        layers={layers}
        colorBy={colorBy}
        basemap={basemap}
        highlight={highlight}
        terminator={layers.terminator}
        selected={selectedPoint}
        pin={pin}
        onProbe={probeAndClose}
        onGrab={() => setPinOpen(false)}
        flyTo={flyTo}
        contextCells={context}
      />
    );
  }
  if (globeStyle === "cells") {
    globeClass = "ex-globe show-cells";
    let ramp = <div className="cell-ramp heat"><span>few</span><span>many pixels</span></div>;
    if (cellMode === "frp") {
      ramp = <div className="cell-ramp heat"><span>weak</span><span>200+ MW</span></div>;
    } else if (cellMode === "sensor") {
      ramp = <div className="cell-ramp sensor"><span>all MODIS</span><span>all VIIRS</span></div>;
    }
    legend = (
      <div className="legend cell-legend">
        <div className="eyebrow">Hex cells · colour = {CELL_MODES.find((m) => m[0] === cellMode)[1].toLowerCase()}</div>
        {ramp}
        <div className="small dim">Each flat hexagon is a ≈ 60 km grid cell (H3 res 3). Small dots are the hot pixels inside it. Click a cell for its numbers.</div>
      </div>
    );
    cellModes = (
      <div className="ex-cellmode" role="group" aria-label="Colour cells by">
        {CELL_MODES.map((m) => {
          let cls = "";
          if (cellMode === m[0]) {
            cls = "on";
          }
          return <button key={m[0]} className={cls} onClick={() => setCellMode(m[0])} title={m[2]}>{m[1]}</button>;
        })}
      </div>
    );
  }
  let globeLoader = null;
  if (loading) {
    kpis = (
      <div className="ex-kpis">
        {["Hot pixels in scope", "MODIS · 1 km", "VIIRS · 375 m", "Night detections", "Median FRP"].map((k) => (
          <div className="kpi scan" key={k}><div className="k">{k}</div><div className="v">— —</div><div className="s">receiving from NASA FIRMS</div><i className="scanline" /></div>
        ))}
      </div>
    );
    globeLoader = <FetchTracker days={windowDays} />;
  }

  return (
    <div className="ex-page">
      <header className="ex-head">
        <div className="ph" style={{ "--ph": "var(--viirs)" }}>
          <div className="eyebrow">Analysis · {scopeName}</div>
          <h1 className="ph-title">Fire <em>explorer</em></h1>
          <p className="ph-q">Every hot pixel on one Earth</p>
          <GuideCue target="guide-explorer" />
        </div>
        <div>
          <p className="ex-lede">Every hot pixel NASA FIRMS reports from MODIS and VIIRS, on one 3D Earth. Columns rise with fire radiative power and density hexes show where detections cluster. Click any place to read its 0.1° cell, its 50 km neighbourhood and which satellites can see it.</p>
          <div className="ex-tags">
            <StatusChip status={liveStatus} />
            <span className="chip"><span className="dot" />{period}</span>
            {sizeTag}
            {loadingTag}
            <span className="chip"><span className="dot" style={{ background: "var(--modis)" }} />MODIS 1 km</span>
            <span className="chip"><span className="dot" style={{ background: "var(--viirs)" }} />VIIRS 375 m</span>
          </div>
        </div>
      </header>

      {errorNote}

      {kpis}

      <div className="ex-work">
        <LayerPanel
          layers={layers}
          onLayers={setLayers}
          dn={dn}
          onDn={setDn}
          qa={qa}
          onQa={setQa}
          colorBy={colorBy}
          onColorBy={setColorBy}
          basemap={basemap}
          onBasemap={setBasemap}
          trackNote={trackNote}
          contextNotes={contextNotes}
          places={PLACES}
          onFly={(place) => {
            setProbe(null);
            setRegion(WORLD);
            setQuery(place.name);
            setFlyTo(place);
          }}
        />
        <section className={globeClass} aria-label="Interactive 3D Earth with fire detections">
          <GlobeView
            hostId="explorer-globe"
            points={filtered}
            countries={countries}
            satellites={satellites}
            layers={layers}
            colorBy={colorBy}
            basemap={basemap}
            highlight={highlight}
            terminator={layers.terminator}
            selected={selectedPoint}
            keepCamera={true}
            pin={pin}
            onProbe={probeAndClose}
        onGrab={() => setPinOpen(false)}
            autoRotate={!window.matchMedia("(prefers-reduced-motion: reduce)").matches && !probe && region.id === "world"}
            flyTo={flyTo}
            startLat={18}
            startLng={60}
            startAltitude={2.2}
            pointRadius={0.16}
            contextCells={context}
            overlayUrl={overlayUrl}
            onSatHover={onSatPointer}
            overlayOpacity={overlayOpacity}
            view={globeStyle}
            cellMode={cellMode}
          />
          {flatView}
          {globeLoader}
          <div className="ex-globe-top">
            <div className="searchbox">
              <span aria-hidden="true">⌕</span>
              <input value={query} aria-label="Search a region or country" onFocus={(event) => { setSearching(true); event.target.select(); }} onBlur={() => setSearching(false)} onChange={(event) => { setQuery(event.target.value); setSearching(true); }} onKeyDown={onSearchKey} />
              <span className="bbox" title="Bounding box west, south, east, north">{bboxText(region.bbox)}</span>
              {searchList}
            </div>
            <div className="seg" role="group" aria-label="Data window" style={{ background: "var(--panel)" }}>
              {[1, 2, 3, 5].map((d) => {
                let cls = "";
                if (windowDays === d) {
                  cls = "on";
                }
                return <button key={d} className={cls} onClick={() => setWindowDays(d)} title="Days of NASA FIRMS data (API maximum 5)">{d + "D"}</button>;
              })}
            </div>
          </div>
          <div className="ex-view" role="group" aria-label="Earth view">
            <span className="ex-view-k">View</span>
            {[["columns", "3D", "Columns", "3D globe: fire pixels as columns that rise with fire power"], ["cells", "3D", "Cells", "3D globe: fire pixels grouped into flat hexagon cells"], ["map", "2D", "Map", "Flat 2D map with the same layers"]].map((m) => {
              let cls = "";
              if (globeStyle === m[0]) {
                cls = "on";
              }
              return <button key={m[0]} className={cls} onClick={() => setGlobeStyle(m[0])} title={m[3]} aria-pressed={globeStyle === m[0]}><b>{m[1]}</b><small>{m[2]}</small></button>;
            })}
          </div>
          {cellModes}
          <div className="ex-globe-bottom">
            <span className="ex-hint">{hint}</span>
            {legend}
          </div>
        </section>
        <Inspector satCard={satCard} onSat={pinSat} loading={loading} points={scope} info={info} onClear={() => setProbe(null)} status={liveStatus} period={period} scopeName={scopeName} demo={demo} />
      </div>


      <div className="ex-strip">
        <TimeStrip calendar={calendar} days={days} day={day} onDay={setDay} counts={counts} />
      </div>

      <section className="ex-section" aria-label="Analysis of the current scope">
        <div className="ex-section-head">
          <div>
            <div className="eyebrow">Analysis of the scope · {scopeName}</div>
            <h2>What the satellites recorded</h2>
          </div>
          <div className="ex-tags" style={{ marginTop: 0 }}>
            <StatusChip status={liveStatus} />
            <span className="chip"><span className="dot" />{scope.length.toLocaleString()} hot pixels · {period}</span>
          </div>
        </div>
        <div className="ex-grid">
          <div className="chart-card wide">
            <h3>When the satellites look</h3>
            <p className="sub">Detections by local solar hour (F01). Dashed lines are the overpass times; nothing passes between 14 and 22 h.</p>
            <div className="legend-row"><span><i style={{ background: "#c98418" }} />MODIS</span><span><i style={{ background: "#1a9dba" }} />VIIRS</span></div>
            <HourChart points={scope} />
          </div>
          <div className="chart-card">
            <h3>Day and night passes</h3>
            <p className="sub">Share of hot pixels from day and night overpasses.</p>
            <DayNight points={scope} />
            <h3 style={{ marginTop: 26 }}>What is burning</h3>
            <p className="sub">{sourceSub}</p>
            <SourceBars points={scope} />
          </div>
          <div className="chart-card">
            <h3>Detections per day</h3>
            <p className="sub">Hot pixels by acquisition date, stacked by sensor.</p>
            <DailyChart points={scope} days={days} />
          </div>
          <div className="chart-card">
            <h3>Fire radiative power</h3>
            <p className="sub">Pixels per FRP band (MW). Raw FRP is not comparable across sensors.</p>
            <FrpChart points={scope} />
          </div>
          <div className="chart-card">
            <h3>Where in the scope</h3>
            <p className="sub">Countries with the most hot pixels, split MODIS / VIIRS.</p>
            <CountryBars points={scope} limit={7} />
          </div>
        </div>
      </section>
      <PageGuide id="guide-explorer" {...EX_GUIDE} />
    </div>
  );
}
