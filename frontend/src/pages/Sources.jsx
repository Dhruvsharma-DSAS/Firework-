import { GuideCue } from "../components/PageGuide.jsx";
import { useEffect, useState } from "react";
import GlobeView from "../components/GlobeView.jsx";
import Badge from "../components/Badge.jsx";
import StatusChip from "../components/StatusChip.jsx";
import { loadDetections } from "../api/data.js";
import { getMode, ARCHIVE_DATE, LIVE_SOURCES, ARCHIVE_SOURCES } from "../lib/sourceMode.js";
import { loadLandCover, landCoverMatch } from "../lib/landcover.js";
import { CLASS_COLORS, CLASS_LABELS, PLATFORM_LABELS } from "../lib/colors.js";
import { formatHour } from "../lib/geo.js";
import "../styles/pagedoc.css";
import "../styles/sources.css";

const GROUND = {
  "Cropland": ["#f2c94c", "Fields. Fire here is often residue burning after harvest, but a farm can also hold a kiln or a flare."],
  "Tree cover": ["#5bd69a", "Forest and plantations. Fire may be a wildfire, land clearing, or burning at a forest edge."],
  "Shrubland": ["#e0894a", "Bush and scrub, including savanna woodland. Burns readily in dry seasons."],
  "Grassland": ["#c3d66b", "Open grass and pasture. Fires are fast, cool and short-lived — easy to miss."],
  "Built-up": ["#c47dff", "Towns, industry and roads. Persistent heat here is often industrial, not vegetation."],
  "Bare / sparse": ["#b5a993", "Desert, rock, mines. Hot pixels here are often gas flares or industrial heat."],
  "Wetland": ["#3dd6f5", "Marsh and peat. Peat fires smoulder and can burn for weeks."],
  "Mangroves": ["#2fb58f", "Coastal mangrove forest."],
  "Snow and ice": ["#e6ebf0", "Snow and ice. A hot pixel here is unusual and worth checking."],
  "Moss / lichen": ["#9aa78a", "Tundra moss and lichen."],
  "Mixed cell": ["#6b7484", "The map cell blends several land types, so no single class is given. Common at field and forest edges."],
  "Open water": ["#5b8def", "Water at this map scale — usually a coastal or lakeshore pixel, or an offshore platform."],
};

const STEPS = [
  ["Take each hot pixel", "Every detection from NASA FIRMS has a latitude and longitude — the centre of a 375 m (VIIRS) or 1 km (MODIS) pixel."],
  ["Look up the ground below it", "That point is looked up on the ESA WorldCover 2021 land-cover map, resampled to about 10 km per cell for the browser. Cells whose colour does not clearly match one class are reported as “Mixed cell” instead of being forced into the nearest one; so is “moss / lichen” south of 50° latitude, where that class is almost always a blend of forest and bare-ground colours."],
  ["Count by ground type", "Pixels are grouped by land-cover class. The share tells you where fire is happening, not what caused it."],
];

const MIXED_LIMIT = 500;

function sourcesForMode(mode) {
  if (mode === "archive") {
    return [ARCHIVE_SOURCES, ARCHIVE_DATE];
  }
  return [LIVE_SOURCES, ""];
}

function groundColor(name) {
  const g = GROUND[name];
  if (g) {
    return g[0];
  }
  return "#8a93a6";
}

export default function Sources() {
  const [points, setPoints] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mapReady, setMapReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [labeled, setLabeled] = useState([]);
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    document.title = "Ground under fires · FIREWORK CHRONOS";
    const pick = sourcesForMode(getMode());
    loadDetections(pick[0], 2, pick[1])
      .then((result) => {
        setPoints(result.data || []);
        setMeta(result.meta || null);
        setLoading(false);
      })
      .catch((err) => {
        setError(String(err.message || err));
        setLoading(false);
      });
    fetch("/textures/context/manifest.json")
      .then((r) => r.json())
      .then((m) => loadLandCover("/textures/context/" + m.landcover.file))
      .then((ok) => {
        setMapReady(Boolean(ok));
        setMapFailed(!ok);
      })
      .catch(() => setMapFailed(true));
  }, []);

  useEffect(() => {
    if (!mapReady) {
      return;
    }
    setLabeled(points.map((p) => {
      const match = landCoverMatch(p.lat, p.lon);
      let ground = match[0];
      if (match[1] !== null && match[1] > MIXED_LIMIT) {
        ground = "Mixed cell";
      }
      if (ground === "Moss / lichen" && Math.abs(p.lat) < 50) {
        ground = "Mixed cell";
      }
      return Object.assign({}, p, { ground: ground, groundColor: groundColor(ground) });
    }));
  }, [points, mapReady]);

  const demo = Boolean(meta && (meta.demo || meta.fallback_used));
  const counts = {};
  labeled.forEach((p) => {
    if (!counts[p.ground]) {
      counts[p.ground] = { n: 0, frp: 0, night: 0 };
    }
    counts[p.ground].n = counts[p.ground].n + 1;
    counts[p.ground].frp = counts[p.ground].frp + (p.frp || 0);
    if (p.dn === "N") {
      counts[p.ground].night = counts[p.ground].night + 1;
    }
  });
  const order = Object.keys(counts).sort((a, b) => counts[b].n - counts[a].n);
  const total = labeled.length;
  const shown = labeled.filter((p) => filter === "all" || p.ground === filter);

  function toggle(g) {
    if (filter === g) {
      setFilter("all");
    } else {
      setFilter(g);
    }
  }

  function chipCls(g) {
    if (filter === g) {
      return "src-chip on";
    }
    return "src-chip";
  }

  let status = "LOADING";
  if (!loading && meta) {
    status = meta.status || "ARCHIVE_STANDARD";
  }
  if (!loading && demo) {
    status = "SIMULATED";
  }
  if (!loading && error) {
    status = "UNAVAILABLE";
  }

  let banner = null;
  if (demo && meta && meta.fallback_used) {
    banner = <div className="pd-aside amber src-banner"><b>The live FIRMS feed could not be reached,</b> so the points below are the simulated demo set. Their ground type is read from the real map, but the fire locations are not real. <Badge kind="SIMULATED_DEMO" /></div>;
  } else if (demo) {
    banner = <div className="pd-aside amber src-banner"><b>Demo data is on.</b> Fire locations are simulated; the ground type under each is read from the real ESA WorldCover map. Switch to Archive or Live in the top bar for real NASA FIRMS pixels. <Badge kind="SIMULATED_DEMO" /></div>;
  } else if (error) {
    banner = <div className="pd-aside red src-banner"><b>No hot pixels could be loaded.</b> {error}. Nothing is shown rather than a guess.</div>;
  }
  if (mapFailed) {
    banner = <div className="pd-aside red src-banner"><b>The land-cover map could not be loaded,</b> so no ground type can be given. Reload the page to try again.</div>;
  }

  let period = "";
  if (meta && meta.start_date) {
    period = "from " + meta.start_date + ", " + meta.day_range + " days";
  } else if (meta && meta.day_range) {
    period = "last " + meta.day_range + " days";
  }
  if (demo && meta && meta.observation_period) {
    period = "simulated week " + meta.observation_period.join(" to ");
  }

  let breakdown = <div className="src-wait"><span className="src-spin" />Reading the ground under each pixel…</div>;
  if (!loading && (error || mapFailed)) {
    breakdown = <p className="src-none">No breakdown — see the note above.</p>;
  } else if (mapReady && !loading && total === 0) {
    breakdown = <p className="src-none">The feed returned no hot pixels for this period.</p>;
  } else if (mapReady && total > 0) {
    let footPeriod = "";
    if (period) {
      footPeriod = " · " + period;
    }
    if (meta && meta.sampled && meta.rows_total) {
      footPeriod = footPeriod + " · a random sample of " + meta.rows_total.toLocaleString() + " returned by FIRMS";
    }
    breakdown = (
      <div>
        <div className="src-stack" role="img" aria-label="Share of hot pixels by ground type">
          {order.map((g) => <i key={g} title={g + " " + Math.round((100 * counts[g].n) / total) + "%"} style={{ flexGrow: counts[g].n, background: groundColor(g) }} />)}
        </div>
        <ul className="src-list">
          <li className="src-list-head"><span>Ground type</span><span>Pixels</span><span>Share</span><span>Mean FRP</span></li>
          {order.map((g) => {
            const c = counts[g];
            const share = (100 * c.n) / total;
            let cls = "src-row";
            if (filter === g) {
              cls = "src-row on";
            }
            let shareText = share.toFixed(1) + "%";
            if (share < 0.1) {
              shareText = "<0.1%";
            }
            return (
              <li key={g}>
                <button type="button" className={cls} onClick={() => toggle(g)} aria-pressed={filter === g}>
                  <span className="src-name"><i style={{ background: groundColor(g) }} />{g}</span>
                  <span className="src-n">{c.n.toLocaleString()}</span>
                  <span className="src-share"><b style={{ width: Math.max(2, share) + "%", background: groundColor(g) }} /><em>{shareText}</em></span>
                  <span className="src-frp">{(c.frp / c.n).toFixed(1)} MW</span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="src-foot">{total.toLocaleString()} hot pixels{footPeriod}. Click a ground type to show only those pixels on the globe.</p>
      </div>
    );
  }

  let card = (
    <div className="src-card-empty">
      <svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="6" fill="none" stroke="currentColor" strokeWidth="1.4" /><circle cx="20" cy="20" r="14" fill="none" stroke="currentColor" strokeOpacity="0.4" strokeDasharray="3 4" /><path d="M20 2v8M20 30v8M2 20h8M30 20h8" stroke="currentColor" strokeWidth="1.2" /></svg>
      <p>Click any dot on the globe to see the ground under it and what the satellite recorded.</p>
    </div>
  );
  if (selected) {
    const sel = labeled.find((p) => p.id === selected.id) || selected;
    const site = labeled.filter((p) => Math.abs(p.lat - sel.lat) < 0.02 && Math.abs(p.lon - sel.lon) < 0.02);
    let solar = "—";
    if (typeof sel.lmst === "number") {
      solar = formatHour(sel.lmst);
    }
    let dn = "Day";
    if (sel.dn === "N") {
      dn = "Night";
    }
    let describe = "";
    if (GROUND[sel.ground]) {
      describe = GROUND[sel.ground][1];
    }
    let demoLabel = null;
    if (demo && sel.cls && CLASS_LABELS[sel.cls]) {
      demoLabel = <div className="kv"><span>Demo source label</span><b style={{ color: CLASS_COLORS[sel.cls] }}>{CLASS_LABELS[sel.cls]} <small>simulated</small></b></div>;
    }
    let countryText = null;
    if (sel.country) {
      countryText = <small> · {sel.country}</small>;
    }
    let utc = "—";
    if (sel.utc) {
      utc = sel.utc.slice(0, 2) + ":" + sel.utc.slice(2) + " UTC";
    }
    card = (
      <div className="src-card">
        <div className="src-card-ground" style={{ "--g": groundColor(sel.ground) }}>
          <i />
          <div>
            <b>{sel.ground || "Unknown"}</b>
            <span>{describe}</span>
          </div>
        </div>
        <div className="kv"><span>Location</span><b>{sel.lat.toFixed(3)}, {sel.lon.toFixed(3)}{countryText}</b></div>
        <div className="kv"><span>Satellite</span><b>{PLATFORM_LABELS[sel.platform] || sel.platform}</b></div>
        <div className="kv"><span>Seen</span><b>{sel.date} · {utc}</b></div>
        <div className="kv"><span>Local solar time</span><b>{solar} <small>{dn}</small></b></div>
        <div className="kv"><span>Fire radiative power</span><b>{sel.frp} MW</b></div>
        <div className="kv"><span>Confidence (sensor scale)</span><b>{String(sel.conf)}</b></div>
        <div className="kv"><span>Hot pixels within ~2 km</span><b>{site.length}</b></div>
        {demoLabel}
      </div>
    );
  }

  let chips = null;
  if (order.length > 0) {
    chips = (
      <div className="src-chips">
        <button type="button" className={chipCls("all")} onClick={() => setFilter("all")}>All ground types</button>
        {order.slice(0, 6).map((g) => (
          <button type="button" key={g} className={chipCls(g)} onClick={() => setFilter(g)}><i style={{ background: groundColor(g) }} />{g}</button>
        ))}
      </div>
    );
  }

  let topGround = null;
  if (order.length > 0 && total > 0) {
    let second = null;
    if (order[1]) {
      second = <>, and <b>{Math.round((100 * counts[order[1]].n) / total)}%</b> on <b>{order[1].toLowerCase()}</b></>;
    }
    let prefix = "Of the pixels loaded, ";
    if (demo) {
      prefix = "In the simulated demo set, ";
    }
    topGround = <p className="pd-lead src-headline">{prefix}<b>{Math.round((100 * counts[order[0]].n) / total)}%</b> of hot pixels sit on <b>{order[0].toLowerCase()}</b>{second}.</p>;
  }

  return (
    <div className="pd src">
      <header className="pd-head ph" style={{ "--ph": "var(--fire)" }}>
        <div>
          <div className="eyebrow">Explore · Sources</div>
          <h1 className="ph-title">Fire <em>sources</em></h1>
          <p className="ph-q">What ground is burning?</p>
          <GuideCue selector=".pd-sec" />
          <p className="pd-lead">Every hot pixel sits on some kind of land — cropland, forest, scrub, a city. This page looks up the ground under each pixel on the ESA WorldCover map, so you can see where fire is happening today.</p>
          {topGround}
        </div>
        <div className="pd-tags">
          <StatusChip status={status} />
          <Badge kind="SOURCE_DERIVED" text="Ground type · ESA WorldCover 2021" />
        </div>
      </header>

      {banner}
      {chips}

      <div className="src-bench">
        <div className="src-globe">
          <GlobeView hostId="sources-globe" points={shown} layers={{ points: true, rings: false, borders: true }} colorBy="ground" basemap="dark" selected={selected} onSelect={setSelected} autoRotate={false} startLat={20} startLng={30} />
        </div>
        <div className="src-side">
          <h2 className="src-h">Hot pixels by ground type</h2>
          {breakdown}
          <h2 className="src-h">Selected pixel</h2>
          {card}
        </div>
      </div>

      <section className="pd-sec">
        <div className="pd-margin"><b>Method</b><span>Three steps</span></div>
        <div className="pd-col">
          <h2>How the ground type is found</h2>
          <ol className="pd-steps">
            {STEPS.map((s) => <li key={s[0]}><b>{s[0]}</b><span>{s[1]}</span></li>)}
          </ol>
        </div>
      </section>

      <section className="pd-sec">
        <div className="pd-margin"><b>Limits</b><span>Read before quoting</span></div>
        <div className="pd-col">
          <h2>What the ground type cannot tell you</h2>
          <div className="src-limits">
            <div><b>Where, not why</b><span>A pixel on cropland is not proof of stubble burning. Kilns, flares and wildfires can all sit on farmland.</span></div>
            <div><b>A coarse map</b><span>One land-cover value per ~10 km cell. Field edges, villages and forest strips inside a cell are lost.</span></div>
            <div><b>A 2021 snapshot</b><span>Land cleared or planted since 2021 still shows its 2021 class.</span></div>
            <div><b>A pixel, not a fire</b><span>One fire can light several pixels; a small or cool fire can light none.</span></div>
          </div>
          <div className="pd-aside src-next"><b>Next step: a real source classifier.</b> A model that also uses persistence, night share and OpenStreetMap context will label each site as crop, wildland, industrial — or abstain as unknown when the evidence is weak. Until it passes gate G11 on held-out sites, only ground type is shown here.</div>
        </div>
      </section>

      <p className="pd-caveat"><b>Sources.</b> Hot pixels: NASA FIRMS (MODIS Collection 6.1, VIIRS 375 m). Ground type: ESA WorldCover v200, 2021 (10 m), resampled via Google Earth Engine. Research decision support, not a life-safety alert system.</p>
    </div>
  );
}
