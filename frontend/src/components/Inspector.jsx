import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import StatusChip from "./StatusChip.jsx";
import { CLASS_LABELS, CLASS_COLORS, SENSOR_COLORS } from "../lib/colors.js";
import { formatHour } from "../lib/geo.js";
import { classifySource } from "../api/data.js";
import "../styles/explorer-inspector.css";

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
      <p className="insp-observation-note">Select a column, hex or location on the globe to inspect the area.</p>
    </div>
  );
}

function ProbeDetail(props) {
  const navigate = useNavigate();
  const info = props.info;
  let mixLabel = "—";
  if (info.cell.n > 0) {
    mixLabel = (CLASS_LABELS[info.cell.mixKey] || info.cell.mixKey).split(" ")[0].toLowerCase() + " " + info.cell.mixShare + "%";
  }
  let daylight = "Night now";
  if (info.daylight) {
    daylight = "Day now";
  }
  let nearest = <Row k="Nearest loaded hot pixel" v="None within 150 km" />;
  if (info.nearest) {
    nearest = <Row k="Nearest loaded hot pixel" v={info.nearest.km.toFixed(1) + " km · " + info.nearest.sensor} />;
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
      <details className="insp-density-details">
        <summary>Density hex details (H3 res 3)</summary>
        <Row k="Hot pixels in hex" v={info.hex.n.toLocaleString()} />
        <Row k="MODIS · VIIRS" v={info.hex.m + " · " + info.hex.v} />
        <Row k="Mean FRP" v={info.hex.meanFrp.toFixed(1) + " MW"} />
        <Row k="Max FRP" v={info.hex.maxFrp.toFixed(1) + " MW"} />
        <Row k="Daytime detection share" v={info.hex.dayShare + " %"} />
      </details>
    );
  }
  return (
    <div>
      <div className="insp-title">{info.place}</div>
      <div className="insp-sub">{info.lat.toFixed(3)}°, {info.lon.toFixed(3)}° · {daylight} · local solar {formatHour(info.lst)}</div>
      {hexRows}
      <Sec>This 0.1° cell · {info.cell.id}</Sec>
      <Row k="Cell area (F04)" v={Math.round(info.cell.area) + " km²"} />
      <Row k="Ground (ESA WorldCover)" v={info.ground || "–"} />
      <Row k={"Fire cell-days · " + props.period} v={info.cell.days} />
      <Row k="Hot pixels" v={info.cell.n} />
      <Row k="Max FRP" v={maxFrp} />
      <Row k={props.mixLabelName} v={mixLabel} style={{ color: CLASS_COLORS[info.cell.mixKey] }} />
      <Sec>Within 50 km</Sec>
      <Row k="Hot pixels" v={info.near.n.toLocaleString()} />
      <Row k="MODIS · VIIRS" v={info.near.m + " · " + info.near.v} />
      <Row k="Night share" v={nightShare} />
      {nearest}
      <p className="insp-observation-note">This view shows loaded detections. Clear-sky coverage and harmonised rates are unavailable here.</p>
      <ModelSource rows={info.nearRows} cellId={info.cell.id + ":" + info.nearRows.length} />
      <div className="insp-actions">
        <button className="btn" onClick={() => navigate("/calendar/punjab_haryana")}>Open calendar</button>
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

  let lastRow = null;
  if (props.info && props.info.cellTimes.length > 0) {
    lastRow = <Row k="Loaded detection times (solar)" v={props.info.cellTimes.slice(0, 4).map(formatHour).join(" · ")} style={{ color: "var(--modis)" }} />;
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
      <section className="panel" aria-label="Typical satellite overpasses">
        <div className="panel-h">
          <span className="caps" style={{ color: "var(--text)" }}>Typical satellite overpasses</span>
        </div>
        <div className="panel-b">
          {OVERPASSES.map((row) => (
            <button className="srow srow-sat insp-satellite-button" type="button" key={row[0]}
              onMouseEnter={() => props.onSat && props.onSat(row[4])}
              onFocus={() => props.onSat && props.onSat(row[4])}
              onClick={() => props.onSat && props.onSat(row[4])}
              disabled={!props.onSat}>
              <span className="nm"><i style={{ background: row[1] }} />{row[0]}</span>
              <b>{row[2]} <span className="faint">· {row[3]}</span></b>
            </button>
          ))}
          {lastRow}
        </div>
      </section>
    </div>
  );
}
