import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import StatusChip from "./StatusChip.jsx";
import { CLASS_LABELS, CLASS_COLORS, SENSOR_COLORS } from "../lib/colors.js";
import { formatHour } from "../lib/geo.js";
import { classifySource, loadCalendar } from "../api/data.js";

const OVERPASSES = [
  ["Terra MODIS", SENSOR_COLORS.MODIS, "~10:30", "~22:30", "terra"],
  ["Aqua MODIS", SENSOR_COLORS.MODIS, "~13:30", "~01:30", "aqua"],
  ["S-NPP VIIRS", SENSOR_COLORS.VIIRS, "~13:30", "~01:30", "snpp"],
  ["NOAA-20 VIIRS", SENSOR_COLORS.VIIRS, "~13:30", "~01:30", "noaa20"],
  ["NOAA-21 VIIRS", SENSOR_COLORS.VIIRS, "~13:30", "~01:30", "noaa21"],
];

function Row(props) {
  return (
    <div className="kv">
      <span>{props.k}</span>
      <b style={props.style}>{props.v}</b>
    </div>
  );
}
function Sec(props) {
  return <div className="lp-sec" style={{ marginTop: 20 }}>{props.children}</div>;
}

function ModelSource(props) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setResult(null);
    setError("");
    if (props.rows.length === 0) {
      return;
    }
    classifySource(props.rows).then((r) => setResult(r)).catch((e) => setError(String(e.message || e)));
  }, [props.cellId]);

  let value = "—";
  let note = "no hot pixels within 50 km";
  if (error) {
    note = error;
  }
  if (result && result.data.length > 0) {
    const flagged = result.data.filter((r) => r.label !== "vegetation").length;
    const share = Math.round((100 * flagged) / result.data.length);
    let label = "vegetation fire";
    if (share >= 50) {
      label = "static / non-vegetation";
    }
    value = label + " · " + share + "% static-like";
    note = result.meta.model + " · test F1 " + Number(result.meta.f1_test).toFixed(2) + " · " + result.meta.provenance;
  } else if (props.rows.length > 0 && !error) {
    note = "scoring " + Math.min(props.rows.length, 500) + " hot pixels…";
  }
  return (
    <div>
      <Row k="Probable source (model)" v={value} style={{ color: "var(--model)" }} />
      <div className="mono small faint" style={{ textAlign: "right" }}>{note}</div>
    </div>
  );
}

function downloadCsv(rows, name) {
  const cols = ["id", "lat", "lon", "date", "utc", "lmst", "dn", "platform", "sensor", "frp", "conf", "cls", "country"];
  const lines = [cols.join(",")];
  rows.forEach((row) => {
    lines.push(cols.map((c) => {
      let v = row[c];
      if (v === undefined || v === null) {
        v = "";
      }
      return '"' + String(v).replace(/"/g, '""') + '"';
    }).join(","));
  });
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 2000);
}

function Summary(props) {
  const points = props.points;
  const bySensor = { MODIS: 0, VIIRS: 0 };
  points.forEach((p) => {
    bySensor[p.sensor] = (bySensor[p.sensor] || 0) + 1;
  });
  return (
    <div>
      <div className="insp-title">{props.scopeName}</div>
      <div className="insp-sub">{points.length.toLocaleString()} hot pixels · {props.period}</div>
      <div className="split2" style={{ gap: 10, marginTop: 14 }}>
        <div className="tile"><div className="big" style={{ color: "var(--modis)" }}>{bySensor.MODIS.toLocaleString()}</div><div className="lbl">MODIS 1 km pixels</div></div>
        <div className="tile"><div className="big" style={{ color: "var(--viirs)" }}>{bySensor.VIIRS.toLocaleString()}</div><div className="lbl">VIIRS 375 m pixels</div></div>
      </div>
      <Sec>How to read the globe</Sec>
      <Row k="Column height" v="log(1 + FRP)" />
      <Row k="Hex column" v="pixels per H3 cell" />
      <Row k="Click anywhere" v="location card" />
      <div className="note info small" style={{ marginTop: 14 }}>Click any column, hex or place on the Earth. A card pins to that spot and this panel fills with its numbers.</div>
    </div>
  );
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const GROUND = {
  "Cropland": "Farmland. Fires here are mostly crop-residue burning: small, short and lit in the afternoon. VIIRS sees many that MODIS misses.",
  "Tree cover": "Forest. Fires tend to be larger and last for days, but smoke and canopy can hide them from the satellite.",
  "Grassland": "Grassland. Grass fires run fast and often burn out between two satellite passes, so many leave no trace in the record.",
  "Shrubland": "Shrubland. Fires spread quickly in dry seasons and are often short-lived between passes.",
  "Built-up": "Towns and industry. A hot pixel here is often a factory, kiln or flare, not a vegetation fire; known static sources are removed.",
  "Bare / sparse": "Bare ground with little to burn. A hot pixel that repeats here is usually a gas flare or industry.",
  "Snow and ice": "Snow and ice. Vegetation fire is not expected here.",
  "Wetland": "Wetland. Peat and marsh fires can smoulder for weeks, often weakly and at night.",
  "Mangroves": "Mangroves. Fire is rare; burning here usually follows clearing.",
  "Moss / lichen": "Tundra. Fires are rare but can be large in hot, dry summers.",
  "Open water": "Open water. There is nothing to burn: a hot pixel here is a ship, platform or gas flare.",
};

const LOOKS = [[1.5, "VIIRS and Aqua night pass"], [10.5, "Terra morning pass"], [13.5, "VIIRS and Aqua afternoon pass"], [22.5, "Terra night pass"]];

function nextLook(lst) {
  let best = null;
  LOOKS.forEach((l) => {
    let d = l[0] - lst;
    if (d < 0) {
      d = d + 24;
    }
    if (best === null || d < best.d) {
      best = { d: d, at: l[0], name: l[1] };
    }
  });
  return best;
}

function median(values) {
  const v = values.slice().sort((a, b) => a - b);
  if (v.length === 0) {
    return null;
  }
  const h = Math.floor(v.length / 2);
  if (v.length % 2 === 1) {
    return v[h];
  }
  return (v[h - 1] + v[h]) / 2;
}

function countryMonth(cal, m) {
  const years = cal.years || [];
  const vals = [];
  let last = null;
  let lastYear = null;
  years.forEach((y, i) => {
    if (y >= 2012 && y <= 2025 && cal.viirs[i] && cal.viirs[i][m] !== null && cal.viirs[i][m] !== undefined) {
      vals.push(cal.viirs[i][m]);
      last = cal.viirs[i][m];
      lastYear = y;
    }
  });
  const byMonth = [];
  for (let mm = 0; mm < 12; mm = mm + 1) {
    const col = [];
    years.forEach((y, i) => {
      if (y >= 2012 && y <= 2025 && cal.viirs[i] && cal.viirs[i][mm] !== null && cal.viirs[i][mm] !== undefined) {
        col.push(cal.viirs[i][mm]);
      }
    });
    byMonth.push(median(col));
  }
  let peak = 0;
  byMonth.forEach((v, i) => {
    if (v !== null && (byMonth[peak] === null || v > byMonth[peak])) {
      peak = i;
    }
  });
  const sorted = byMonth.filter((v) => v !== null).sort((a, b) => b - a);
  const typical = median(vals);
  let rank = null;
  if (typical !== null) {
    rank = sorted.indexOf(byMonth[m]) + 1;
  }
  let rate = null;
  if (lastYear !== null && cal.exposure_viirs) {
    const e = cal.exposure_viirs[years.indexOf(lastYear)];
    if (e && e[m]) {
      rate = (1000 * last) / e[m];
    }
  }
  let k = null;
  if (cal.k_baseline && cal.k_baseline[String(m + 1)]) {
    k = cal.k_baseline[String(m + 1)];
  }
  let level = null;
  if (cal.trust && cal.trust.coverage && cal.trust.coverage[m]) {
    level = cal.trust.coverage[m].level;
  }
  let night = null;
  let n20 = null;
  let n21 = null;
  if (lastYear !== null) {
    const li = years.indexOf(lastYear);
    if (cal.night_viirs && cal.night_viirs[li] && cal.night_viirs[li][m] !== null && last > 0) {
      night = cal.night_viirs[li][m] / last;
    }
    if (cal.platforms && cal.platforms.noaa20 && cal.platforms.noaa20[li]) {
      n20 = cal.platforms.noaa20[li][m];
    }
    if (cal.platforms && cal.platforms.noaa21 && cal.platforms.noaa21[li]) {
      n21 = cal.platforms.noaa21[li][m];
    }
  }
  let now = null;
  const ci = years.indexOf(new Date().getUTCFullYear());
  if (ci >= 0 && cal.platforms && cal.platforms.noaa20 && cal.platforms.noaa20[ci] && cal.platforms.noaa20[ci][m] !== null && cal.platforms.noaa20[ci][m] !== undefined) {
    let st = null;
    if (cal.status_viirs && cal.status_viirs[ci]) {
      st = cal.status_viirs[ci][m];
    }
    now = { year: years[ci], n20: cal.platforms.noaa20[ci][m], status: st };
  }
  return { typical: typical, last: last, lastYear: lastYear, peak: peak, rank: rank, months: sorted.length, rate: rate, k: k, level: level, night: night, n20: n20, n21: n21, now: now };
}

function ProbeDetail(props) {
  const navigate = useNavigate();
  const info = props.info;
  const [cal, setCal] = useState(null);
  const [calState, setCalState] = useState("none");

  useEffect(() => {
    setCal(null);
    if (!info.iso3) {
      setCalState("none");
      return;
    }
    setCalState("loading");
    loadCalendar("c_" + info.iso3.toLowerCase())
      .then((r) => {
        if (r && r.data && r.data.years && !(r.meta && r.meta.demo)) {
          setCal(r.data);
          setCalState("ok");
        } else {
          setCalState("none");
        }
      })
      .catch(() => setCalState("none"));
  }, [info.iso3]);

  let mixLabel = "—";
  if (info.cell.n > 0) {
    mixLabel = (CLASS_LABELS[info.cell.mixKey] || info.cell.mixKey).split(" ")[0].toLowerCase() + " " + info.cell.mixShare + "%";
  }
  let daylight = "Night now";
  if (info.daylight) {
    daylight = "Day now";
  }
  let nearest = <Row k="Nearest hot pixel" v="none within 150 km" />;
  if (info.nearest) {
    nearest = <Row k="Nearest hot pixel" v={info.nearest.km.toFixed(1) + " km · " + info.nearest.sensor} />;
  }
  let maxFrp = "—";
  if (info.cell.n > 0) {
    maxFrp = info.cell.maxFrp.toFixed(1) + " MW";
  }
  let nightShare = "—";
  if (info.near.n > 0) {
    nightShare = Math.round((100 * info.near.night) / info.near.n) + "%";
  }
  let hexRows = null;
  if (info.hex) {
    hexRows = (
      <div>
        <Sec>Density hex (H3 res 3)</Sec>
        <p className="insp-cap">The column you clicked: all hot pixels that fell inside this hexagon in the period.</p>
        <Row k="Hot pixels in hex" v={info.hex.n.toLocaleString()} />
        <Row k="MODIS · VIIRS" v={info.hex.m + " · " + info.hex.v} />
        <Row k="Mean FRP" v={info.hex.meanFrp.toFixed(1) + " MW"} />
        <Row k="Max FRP" v={info.hex.maxFrp.toFixed(1) + " MW"} />
        <Row k="Day passes" v={info.hex.dayShare + " %"} />
      </div>
    );
  }

  const month = new Date().getUTCMonth();
  const look = nextLook(info.lst);
  const ground = info.ground || "";
  let state = "quiet";
  let headline = "Quiet: no fire seen nearby";
  const points = [];
  if (!info.iso3 && info.near.n === 0) {
    state = "water";
    headline = "Open water: no fire expected";
    points.push("No satellite saw fire within 50 km in " + props.period + ".");
  } else if (info.cell.n > 0) {
    state = "burning";
    headline = "Burning in this cell";
    let px = " hot pixels";
    if (info.cell.n === 1) {
      px = " hot pixel";
    }
    let dy = " days";
    if (info.cell.days === 1) {
      dy = " day";
    }
    points.push(info.cell.n + px + " on " + info.cell.days + dy + " inside this " + Math.round(info.cell.area) + " km² cell, strongest " + info.cell.maxFrp.toFixed(1) + " MW.");
    points.push(info.near.n.toLocaleString() + " hot pixels within 50 km (" + info.near.m + " MODIS, " + info.near.v + " VIIRS).");
  } else if (info.near.n > 0) {
    state = "nearby";
    headline = "Fire nearby, not in this cell";
    points.push(info.near.n.toLocaleString() + " hot pixels within 50 km in " + props.period + "; the nearest is " + info.nearest.km.toFixed(1) + " km away.");
  } else if (info.nearest) {
    state = "wider";
    headline = "Quiet here, fire in the wider area";
    points.push("Nothing within 50 km; the nearest hot pixel is " + info.nearest.km.toFixed(1) + " km away (" + info.nearest.sensor + ").");
  } else {
    points.push("No satellite saw fire within 150 km in " + props.period + ".");
  }
  if (GROUND[ground]) {
    points.push(GROUND[ground]);
  }
  let season = null;
  if (cal && calState === "ok") {
    const cm = countryMonth(cal, month);
    if (cm.typical !== null) {
      let busy = "a quiet month";
      if (cm.rank !== null && cm.rank <= 3) {
        busy = "one of the three busiest months";
      } else if (cm.rank !== null && cm.rank <= 6) {
        busy = "a moderately active month";
      }
      season = cm;
      points.push("In " + info.place + ", " + MONTHS[month] + " is " + busy + ": typically " + Math.round(cm.typical).toLocaleString() + " fire cell-days country-wide (median 2012–2025). The busiest month is " + MONTHS[cm.peak] + ".");
      if (cm.night !== null && cm.night >= 0.5) {
        points.push("Most of these detections (" + Math.round(100 * cm.night) + " %) come at night. Crop and forest fires burn mainly in the afternoon, so this pattern usually means gas flares or industry.");
      }
      if (cm.last !== null && cm.typical > 0) {
        const ratio = cm.last / cm.typical;
        let word = "close to usual";
        if (ratio >= 1.5) {
          word = "well above usual";
        } else if (ratio <= 0.67) {
          word = "well below usual";
        }
        points.push(MONTHS[month] + " " + cm.lastYear + " had " + Math.round(cm.last).toLocaleString() + " fire cell-days: " + word + " (" + ratio.toFixed(1) + "× the typical month).");
      }
    }
  }
  let timeLine = "It is " + daylight.toLowerCase().replace(" now", "") + " here (local solar " + formatHour(info.lst) + "). ";
  timeLine = timeLine + "The next satellite look is the " + look.name + " at about " + formatHour(look.at) + ", in " + look.d.toFixed(1) + " h.";
  points.push(timeLine);
  const ADDS = {
    burning: "FIREWORK counts this as fire cell-days and puts older MODIS years on the same scale, so this season can be compared with 2000–2011.",
    nearby: "A fire a few kilometres away lands in a different 0.1° cell. Open the calendar to see whether the area is above its usual level.",
    wider: "Quiet here does not mean quiet in the region. The country calendar shows whether this month is normal.",
    quiet: "No fire seen is not proof of no fire: fires that start and end between passes, or under cloud, leave no trace. FIREWORK separates no fire from no clear view.",
    water: "Hot pixels over water are left out of the fire calendar; only vegetation fire is counted.",
  };

  let monthRows = <p className="insp-cap">Click a country to see how this month compares with its own history.</p>;
  if (calState === "loading") {
    monthRows = <p className="insp-cap">Loading the country calendar…</p>;
  }
  if (season) {
    let rate = "—";
    if (season.rate !== null) {
      rate = season.rate.toFixed(1) + " per 1,000";
    }
    let k = "—";
    if (season.k) {
      k = season.k.k.toFixed(2) + " [" + season.k.lo.toFixed(2) + ", " + season.k.hi.toFixed(2) + "]";
    }
    let level = "—";
    if (season.level) {
      level = season.level.charAt(0).toUpperCase() + season.level.slice(1);
    }
    let nightV = "—";
    if (season.night !== null) {
      nightV = (100 * season.night).toFixed(1) + " % of VIIRS cell-days";
    }
    let satV = "—";
    if (season.n20 !== null || season.n21 !== null) {
      let a = "—";
      let b = "—";
      if (season.n20 !== null) {
        a = Math.round(season.n20).toLocaleString();
      }
      if (season.n21 !== null) {
        b = Math.round(season.n21).toLocaleString();
      }
      satV = a + " · " + b;
    }
    let nowYear = new Date().getUTCFullYear();
    let nowV = "—";
    if (season.now) {
      nowYear = season.now.year;
      nowV = Math.round(season.now.n20).toLocaleString() + " · NOAA-20";
      if (season.now.status === "nrt") {
        nowV = nowV + " · near-real-time, partial";
      }
    }
    let lastV = "—";
    if (season.last !== null) {
      lastV = Math.round(season.last).toLocaleString() + " (" + season.lastYear + ")";
    }
    monthRows = (
      <div>
        <p className="insp-cap">Country-wide VIIRS fire cell-days for {MONTHS[month]}, from the 2000–2025 calendar.</p>
        <Row k="Typical (median 2012–2025)" v={Math.round(season.typical).toLocaleString()} />
        <Row k="Latest full year" v={lastV} />
        <Row k="Busiest month" v={MONTHS[season.peak]} />
        <Row k={"Seen at night (" + season.lastYear + ")"} v={nightV} />
        <Row k={"NOAA-20 · NOAA-21 (" + season.lastYear + ")"} v={satV} />
        <Row k={"This month so far (" + nowYear + ")"} v={nowV} />
        <Row k="Fire per clear look" v={rate} />
        <Row k="k · parameter band" v={k} />
        <Row k="Confidence in k" v={level} />
      </div>
    );
  }

  let calLink = "/calendar/punjab_haryana";
  if (info.iso3) {
    calLink = "/calendar/c_" + info.iso3.toLowerCase();
  }

  return (
    <div className="insp">
      <div className="insp-title">{info.place}</div>
      <div className="insp-sub">{info.lat.toFixed(3)}°, {info.lon.toFixed(3)}° · {daylight} · local solar {formatHour(info.lst)}</div>
      <div className={"insp-sit " + state}>
        <span className="insp-sit-k">Situation</span>
        <b>{headline}</b>
        <ul>
          {points.map((t) => <li key={t}>{t}</li>)}
        </ul>
        <p className="insp-adds"><span>What FIREWORK adds</span>{ADDS[state]}</p>
      </div>
      {hexRows}
      <Sec>This 0.1° cell · {info.cell.id}</Sec>
      <p className="insp-cap">The grid square you clicked, about 11 km across. One fire cell-day = this square with fire on one local day.</p>
      <Row k="Cell area (F04)" v={Math.round(info.cell.area) + " km²"} />
      <Row k="Ground (ESA WorldCover)" v={ground || "–"} />
      <Row k={"Fire cell-days · " + props.period} v={info.cell.days} />
      <Row k="Hot pixels" v={info.cell.n} />
      <Row k="Max FRP" v={maxFrp} />
      <Row k={props.mixLabelName} v={mixLabel} style={{ color: CLASS_COLORS[info.cell.mixKey] }} />
      <Sec>Within 50 km</Sec>
      <p className="insp-cap">The neighbourhood: how much fire the satellites saw around this point.</p>
      <Row k="Hot pixels" v={info.near.n.toLocaleString()} />
      <Row k="MODIS · VIIRS" v={info.near.m + " · " + info.near.v} />
      <Row k="Night share" v={nightShare} />
      {nearest}
      <Sec>This month in {info.place}</Sec>
      {monthRows}
      <ModelSource rows={info.nearRows} cellId={info.cell.id + ":" + info.nearRows.length} />
      <div className="insp-actions">
        <button className="btn" onClick={() => navigate(calLink)}>Open calendar</button>
        <button className="btn" onClick={() => downloadCsv(info.nearRows, "chronos_" + info.cell.id + "_50km.csv")}>Export CSV</button>
        <button className="btn small" onClick={() => props.onClear()} aria-label="Clear location">✕</button>
      </div>
    </div>
  );
}


export default function Inspector(props) {
  let body = <Summary points={props.points} period={props.period} scopeName={props.scopeName} />;
  if (props.loading) {
    body = (
      <div className="scan-block">
        <b>Waiting for detections</b>
        <p>The scope summary fills in as soon as NASA FIRMS pixels arrive.</p>
        <div className="scan-rows"><span /><span /><span /></div>
        <i className="scanline" />
      </div>
    );
  }
  let title = "Scope summary";
  if (props.info) {
    let mixLabelName = "Source class (not classified yet)";
    if (props.demo) {
      mixLabelName = "Source mix (demo)";
    }
    body = <ProbeDetail info={props.info} onClear={props.onClear} period={props.period} mixLabelName={mixLabelName} />;
    title = "Location inspector";
  }

  let lastRow = <Row k="Burning often peaks" v="after 15:00" style={{ color: "var(--modis)" }} />;
  if (props.info && props.info.cellTimes.length > 0) {
    lastRow = <Row k="Seen here at (local)" v={props.info.cellTimes.slice(0, 4).map(formatHour).join(" · ")} style={{ color: "var(--modis)" }} />;
  }

  return (
    <div className="right">
      {props.satCard}
      <section className="panel" aria-label={title}>
        <div className="panel-h">
          <span className="caps" style={{ color: "var(--text)" }}>{title}</span>
          <StatusChip status={props.status} />
        </div>
        <div className="panel-b">{body}</div>
      </section>
      <section className="panel" aria-label="Sensors over this place">
        <div className="panel-h">
          <span className="caps" style={{ color: "var(--text)" }}>Sensors over this place</span>
          <span className="mono small faint">point at a row for its satellite</span>
        </div>
        <div className="panel-b">
          {OVERPASSES.map((row) => (
            <div className="srow srow-sat" key={row[0]} tabIndex={0} onMouseEnter={() => props.onSat && props.onSat(row[4])} onFocus={() => props.onSat && props.onSat(row[4])}>
              <span className="nm"><i style={{ background: row[1] }} />{row[0]}</span>
              <b>{row[2]} <span className="faint">· {row[3]}</span></b>
            </div>
          ))}
          {lastRow}
        </div>
      </section>
    </div>
  );
}
