import { GuideCue } from "../components/PageGuide.jsx";
import { useEffect, useState } from "react";
import GlobeView from "../components/GlobeView.jsx";
import StatusChip from "../components/StatusChip.jsx";
import Badge from "../components/Badge.jsx";
import "../styles/pagedoc.css";
import "../styles/yourdata.css";

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_ROWS = 20000;
const SAMPLE_URL = "/data/studio_sample_firms.csv";
const GUIDE_URL = "/learn/pdf/FIREWORK_Data_Studio_Guide.pdf";
const SHEET_URL = "/data/studio_dataset_README_example.txt";

const DOWNLOADS = [
  {
    href: SAMPLE_URL, file: "studio_sample_firms.csv", type: "CSV", color: "var(--viirs)", kicker: "Try it first",
    title: "Sample fire file",
    text: "Real NASA FIRMS detections you can drop straight back into the studio to see every step work.",
    points: ["200 rows · VIIRS S-NPP", "Punjab + Haryana, Oct 2013", "Exact FIRMS column names"],
    meta: "12 KB · .csv",
    icon: <svg viewBox="0 0 24 24" width="22" height="22"><rect x="3.5" y="4.5" width="17" height="15" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M3.5 9.5h17M3.5 14.5h17M9.5 4.5v15M15 4.5v15" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>,
  },
  {
    href: GUIDE_URL, file: "FIREWORK_Data_Studio_Guide.pdf", type: "PDF", color: "var(--modis)", kicker: "Read before you upload",
    title: "The Data Studio guide",
    text: "How a fire file must look, which columns are needed and what happens to it — in the same format as the formula PDFs.",
    points: ["Rows and columns, explained", "5 format rules · common mistakes", "The 10 steps and the cleaned CSV"],
    meta: "4 pages · A4 · .pdf",
    icon: <svg viewBox="0 0 24 24" width="22" height="22"><path d="M6 3h8l4 4v14H6z M14 3v4h4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><path d="M9 12h6M9 15h6M9 18h4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>,
  },
  {
    href: SHEET_URL, file: "README_example.txt", type: "TXT", color: "var(--user)", kicker: "Share it honestly",
    title: "Example dataset sheet",
    text: "A filled-in README to copy and keep next to your CSV, so anyone can tell where the points came from.",
    points: ["Source, period and area", "Time zone, units and limits", "Status label and licence"],
    meta: "1 page · plain text · .txt",
    icon: <svg viewBox="0 0 24 24" width="22" height="22"><path d="M5 4h14v16H5z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><path d="M8 8h8M8 11.5h8M8 15h5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /><path d="M15 15.5l1.5 1.5 3-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  },
];


const STEPS = [
  ["Upload", "Drop or choose a CSV. It is read by your browser; nothing is uploaded to a server.", true],
  ["Inspect", "See the header and the first rows exactly as they were read, so you can spot a wrong separator or shifted columns.", true],
  ["Validate", "Every row is checked: coordinates must be numbers inside −90…90 and −180…180. Bad and empty rows are counted, never silently fixed.", true],
  ["Map columns", "Tell the studio which column is latitude, longitude, date, time and FRP. FIRMS names are recognised automatically.", true],
  ["Parameters", "Choose the match radius and time window used to compare your points with NASA FIRMS detections.", false],
  ["Preview", "Valid points are drawn on the globe in violet so you can see at once whether they land where you expect.", true],
  ["Run", "Send the cleaned points to the backend comparison job (POST /api/studio/compare).", false],
  ["Formulas", "Apply the same cell-day, local-solar-time and exchange-rate formulas (F01–F07) used for the fire record.", false],
  ["Compare", "Match each of your points to MODIS and VIIRS pixels and report hits, misses and distance, with lineage.", false],
  ["Export", "Download the cleaned, validated points as a tidy CSV with standard column names.", true],
];

const COLUMNS = [
  ["latitude", "Required", "Decimal degrees, WGS84, north positive. −90 to 90.", "30.11401", "lat, y"],
  ["longitude", "Required", "Decimal degrees, WGS84, east positive. −180 to 180.", "75.33974", "lon, lng, long, x"],
  ["acq_date", "Recommended", "Date of the observation, YYYY-MM-DD, in UTC.", "2013-10-17", "date, datetime"],
  ["acq_time", "Optional", "Time in UTC as HHMM. Used to compute local solar time (UTC + longitude / 15).", "0707", "time, utc"],
  ["frp", "Optional", "Fire radiative power in megawatts. Sets the height of each spike on the globe.", "4.28", "power"],
  ["confidence", "Optional", "Kept as written. VIIRS uses l / n / h, MODIS uses 0–100; they are never converted to a probability.", "n", "—"],
  ["satellite, instrument, daynight", "Optional", "Kept for your own reference; not needed for the globe.", "N, VIIRS, D", "—"],
];

const EXAMPLE = [
  ["30.11401", "75.33974", "2013-10-17", "707", "N", "VIIRS", "n", "4.28", "D"],
  ["30.74212", "76.5129", "2013-10-17", "707", "N", "VIIRS", "n", "3.43", "D"],
  ["31.52659", "75.67731", "2013-10-17", "707", "N", "VIIRS", "n", "3.58", "D"],
];

function splitLine(line, sep) {
  return line.split(sep).map((cell) => cell.trim().replace(/^"|"$/g, ""));
}

function guessColumn(headers, names) {
  const found = headers.find((h) => names.indexOf(h.toLowerCase()) >= 0);
  if (found) {
    return found;
  }
  return "";
}

function formatBytes(n) {
  if (n >= 1024 * 1024) {
    return (n / (1024 * 1024)).toFixed(1) + " MB";
  }
  if (n >= 1024) {
    return Math.round(n / 1024) + " KB";
  }
  return n + " bytes";
}

function padTime(value) {
  const digits = String(value || "").replace(/[^0-9]/g, "");
  if (digits.length === 0 || digits.length > 4) {
    return "";
  }
  return digits.padStart(4, "0");
}

export default function Studio() {
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState(0);
  const [isSample, setIsSample] = useState(false);
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [totalLines, setTotalLines] = useState(0);
  const [latCol, setLatCol] = useState("");
  const [lonCol, setLonCol] = useState("");
  const [dateCol, setDateCol] = useState("");
  const [timeCol, setTimeCol] = useState("");
  const [frpCol, setFrpCol] = useState("");
  const [message, setMessage] = useState("");
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    document.title = "Data Studio · FIREWORK CHRONOS";
  }, []);

  function parseText(text, name, size, sample) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) {
      setMessage("The file needs a header row and at least one data row.");
      return;
    }
    let sep = ",";
    if (lines[0].split(";").length > lines[0].split(",").length) {
      sep = ";";
    }
    if (lines[0].split("\t").length > lines[0].split(sep).length) {
      sep = "\t";
    }
    const head = splitLine(lines[0], sep);
    const body = lines.slice(1, MAX_ROWS + 1).map((l) => splitLine(l, sep));
    setFileName(name);
    setFileSize(size);
    setIsSample(sample);
    setHeaders(head);
    setRows(body);
    setTotalLines(lines.length - 1);
    setLatCol(guessColumn(head, ["latitude", "lat", "y"]));
    setLonCol(guessColumn(head, ["longitude", "lon", "lng", "long", "x"]));
    setDateCol(guessColumn(head, ["acq_date", "date", "datetime"]));
    setTimeCol(guessColumn(head, ["acq_time", "time", "utc"]));
    setFrpCol(guessColumn(head, ["frp", "power"]));
    setMessage("");
  }

  function readFile(file) {
    if (!file) {
      return;
    }
    if (!/\.(csv|tsv|txt)$/i.test(file.name)) {
      setMessage("Only .csv, .tsv or .txt files can be read. “" + file.name + "” looks like something else.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setMessage("“" + file.name + "” is " + formatBytes(file.size) + ". The limit is 25 MB — split the file, or ask for the API import.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => parseText(String(reader.result), file.name, file.size, false);
    reader.onerror = () => setMessage("The browser could not read this file.");
    reader.readAsText(file);
  }

  function onPick(event) {
    readFile(event.target.files[0]);
    event.target.value = "";
  }

  function onDrop(event) {
    event.preventDefault();
    setDragging(false);
    readFile(event.dataTransfer.files[0]);
  }

  function onDragOver(event) {
    event.preventDefault();
    setDragging(true);
  }

  function loadSample() {
    fetch(SAMPLE_URL)
      .then((r) => r.text())
      .then((text) => parseText(text, "studio_sample_firms.csv", text.length, true))
      .catch(() => setMessage("The sample file could not be loaded."));
  }

  function reset() {
    setFileName("");
    setHeaders([]);
    setRows([]);
    setTotalLines(0);
    setIsSample(false);
    setMessage("");
  }

  const latIndex = headers.indexOf(latCol);
  const lonIndex = headers.indexOf(lonCol);
  const dateIndex = headers.indexOf(dateCol);
  const timeIndex = headers.indexOf(timeCol);
  const frpIndex = headers.indexOf(frpCol);
  const valid = [];
  let badCoords = 0;
  let missing = 0;
  let dated = 0;
  rows.forEach((r, i) => {
    if (latIndex < 0 || lonIndex < 0) {
      return;
    }
    if (r[latIndex] === "" || r[lonIndex] === "" || r[latIndex] === undefined || r[lonIndex] === undefined) {
      missing = missing + 1;
      return;
    }
    const lat = Number(r[latIndex]);
    const lon = Number(r[lonIndex]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      badCoords = badCoords + 1;
      return;
    }
    let date = "";
    if (dateIndex >= 0 && /^\d{4}-\d{2}-\d{2}/.test(r[dateIndex] || "")) {
      date = r[dateIndex].slice(0, 10);
      dated = dated + 1;
    }
    let utc = "";
    let lmst = null;
    if (timeIndex >= 0) {
      utc = padTime(r[timeIndex]);
    }
    if (utc) {
      const hours = Number(utc.slice(0, 2)) + Number(utc.slice(2)) / 60;
      lmst = (((hours + lon / 15) % 24) + 24) % 24;
    }
    let frp = 1;
    if (frpIndex >= 0 && r[frpIndex] !== "" && Number.isFinite(Number(r[frpIndex]))) {
      frp = Number(r[frpIndex]);
    }
    valid.push({ id: "u" + i, lat: lat, lon: lon, date: date, utc: utc, lmst: lmst, dn: "D", platform: "user", sensor: "USER", frp: frp, conf: "user", cls: "USER", country: "" });
  });

  function exportCsv() {
    const lines = ["latitude,longitude,acq_date,acq_time_utc,local_solar_hour,frp_mw"];
    valid.forEach((p) => {
      let solar = "";
      if (p.lmst !== null) {
        solar = p.lmst.toFixed(2);
      }
      let frp = "";
      if (frpIndex >= 0) {
        frp = String(p.frp);
      }
      lines.push([p.lat, p.lon, p.date, p.utc, solar, frp].join(","));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName.replace(/\.(csv|tsv|txt)$/i, "") + "_cleaned.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  let status = "SIMULATED";
  if (valid.length > 0) {
    status = "USER";
  }
  let step = 1;
  if (rows.length > 0) {
    step = 4;
  }
  if (valid.length > 0) {
    step = 6;
  }

  let dropCls = "yd-drop";
  if (dragging) {
    dropCls = "yd-drop over";
  }

  let errorBox = null;
  if (message) {
    errorBox = <div className="pd-aside red yd-note" role="alert">{message}</div>;
  }

  let side = (
    <div>
      <label htmlFor="studio-file" className={dropCls} onDragOver={onDragOver} onDragEnter={onDragOver} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
        <svg className="yd-drop-icon" viewBox="0 0 48 48" aria-hidden="true">
          <path d="M14 6h14l10 10v26H14z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M28 6v10h10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M26 36V22m-6 6 6-6 6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <b>Drop a CSV file here</b>
        <span className="yd-drop-or">or</span>
        <span className="pd-btn solid">Choose a file</span>
        <small>.csv, .tsv or .txt · up to 25 MB · first 20,000 rows are read</small>
      </label>
      <input id="studio-file" className="pd-sr" type="file" accept=".csv,.tsv,.txt,text/csv" onChange={onPick} />
      {errorBox}
      <div className="yd-or">
        <span>No file to hand?</span>
        <button type="button" className="pd-link" onClick={loadSample}>Load the sample — 200 real FIRMS pixels</button>
      </div>
      <p className="yd-privacy">Your file is read by this browser only. It is not uploaded, not stored, and never sent to an AI model. Reloading the page clears it.</p>
    </div>
  );

  if (fileName) {
    let sampleNote = null;
    if (isSample) {
      sampleNote = <div className="pd-aside blue yd-note">Sample file: 200 pixels from the NASA FIRMS VIIRS S-NPP standard-processing archive, Punjab–Haryana, 16–20 October 2013. <Badge kind="OFFICIAL_DOCUMENTED" text="NASA FIRMS archive" /></div>;
    }
    let truncated = null;
    if (totalLines > MAX_ROWS) {
      truncated = <div className="pd-aside amber yd-note">The file has {totalLines.toLocaleString()} data rows; only the first {MAX_ROWS.toLocaleString()} were read.</div>;
    }
    let mapHint = null;
    if (latIndex < 0 || lonIndex < 0) {
      mapHint = <div className="pd-aside amber yd-note">Choose the latitude and longitude columns to put the points on the globe.</div>;
    }
    let badCls = "";
    if (badCoords > 0) {
      badCls = "warn";
    }
    let missCls = "";
    if (missing > 0) {
      missCls = "warn";
    }
    side = (
      <div className="yd-loaded">
        <div className="yd-file">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v13H7z M14 3v5h5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
          <div>
            <b>{fileName}</b>
            <span>{formatBytes(fileSize)} · {headers.length} columns · {rows.length.toLocaleString()} rows read</span>
          </div>
          <button type="button" className="pd-btn small" onClick={reset}>Replace</button>
        </div>
        {sampleNote}
        {truncated}
        {errorBox}

        <h3 className="yd-h3"><i>4</i> Map columns</h3>
        <div className="yd-map">
          {[["Latitude", latCol, setLatCol, true], ["Longitude", lonCol, setLonCol, true], ["Date (UTC)", dateCol, setDateCol, false], ["Time (UTC, HHMM)", timeCol, setTimeCol, false], ["FRP (MW)", frpCol, setFrpCol, false]].map((m) => {
            let label = m[0];
            if (m[3]) {
              label = m[0] + " · required";
            }
            return (
              <label className="pd-field" key={m[0]}>
                <span>{label}</span>
                <select className="pd-select" value={m[1]} onChange={(event) => m[2](event.target.value)}>
                  <option value="">Not in this file</option>
                  {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
            );
          })}
        </div>
        {mapHint}

        <h3 className="yd-h3"><i>3</i> Validation</h3>
        <div className="pd-figures yd-figs">
          <div><b>{valid.length.toLocaleString()}</b><span>valid points on the globe</span></div>
          <div><b>{dated.toLocaleString()}</b><span>with a readable date</span></div>
          <div><b className={badCls}>{badCoords.toLocaleString()}</b><span>impossible coordinates</span></div>
          <div><b className={missCls}>{missing.toLocaleString()}</b><span>missing coordinates</span></div>
        </div>

        <h3 className="yd-h3"><i>10</i> Export</h3>
        <div className="yd-export">
          <button type="button" className="pd-btn solid" onClick={exportCsv} disabled={valid.length === 0}>Download cleaned CSV</button>
          <span>{valid.length.toLocaleString()} rows · standard column names · local solar hour added when the time is known</span>
        </div>
      </div>
    );
  }

  let inspect = null;
  if (fileName) {
    const mapped = [latCol, lonCol, dateCol, timeCol, frpCol];
    inspect = (
      <section className="pd-sec">
        <div className="pd-margin"><b>Step 2</b><span>Inspect</span></div>
        <div className="pd-col">
          <h2>The first rows, exactly as read</h2>
          <p>Highlighted columns are the ones mapped above. If every value sits in one column, the separator was not recognised — save the file with commas.</p>
          <div className="pd-table-wrap">
            <table className="pd-table yd-inspect">
              <thead>
                <tr>
                  <th>#</th>
                  {headers.map((h, j) => {
                    let cls = "";
                    if (h && mapped.indexOf(h) >= 0) {
                      cls = "on";
                    }
                    return <th key={h + j} className={cls}>{h}</th>;
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 6).map((r, i) => (
                  <tr key={i}>
                    <td className="yd-rn">{i + 1}</td>
                    {headers.map((h, j) => {
                      let cls = "";
                      if (h && mapped.indexOf(h) >= 0) {
                        cls = "on";
                      }
                      return <td key={h + j} className={cls}>{r[j]}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="pd yd">
      <header className="pd-head ph" style={{ "--ph": "var(--user)" }}>
        <div>
          <div className="eyebrow">Your data · Data Studio</div>
          <h1 className="ph-title">Data <em>Studio</em></h1>
          <p className="ph-q">Put your own fire points on the Earth</p>
          <GuideCue selector=".pd-sec" />
          <p className="pd-lead">Bring a table of locations — field reports, a FIRMS download, a list of burn sites — and see it on the same globe as the satellite record. Everything happens in your browser.</p>
        </div>
        <div className="pd-tags"><StatusChip status={status} /></div>
      </header>

      <ol className="yd-rail" aria-label="Studio steps">
        {STEPS.map((s, i) => {
          let cls = "yd-step";
          if (i + 1 === step) {
            cls = "yd-step now";
          } else if (i + 1 < step && s[2]) {
            cls = "yd-step done";
          } else if (!s[2]) {
            cls = "yd-step later";
          }
          return <li key={s[0]} className={cls}><i>{i + 1}</i><span>{s[0]}</span></li>;
        })}
      </ol>

      <div className="yd-bench">
        <div className="yd-globe">
          <GlobeView hostId="studio-globe" points={valid} layers={{ points: true, density: valid.length > 300, rings: false, borders: true }} colorBy="class" basemap="bluemarble" autoRotate={valid.length === 0} pointRadius={0.25} startLat={22} startLng={76} />
          <div className="yd-globe-cap">
            <span><i className="yd-dot" /> Your points</span>
            <span>{valid.length.toLocaleString()} shown</span>
          </div>
        </div>
        <div className="yd-side">{side}</div>
      </div>

      {inspect}

      <section className="pd-sec">
        <div className="pd-margin"><b>File format</b><span>What the studio reads</span></div>
        <div className="pd-col">
          <h2>A plain table with one row per point</h2>
          <p>The first row must name the columns. Any spreadsheet can save this as <b>CSV</b>. A file downloaded from NASA FIRMS works as it is — its column names are recognised automatically.</p>
          <div className="pd-table-wrap">
            <table className="pd-table yd-cols">
              <thead><tr><th>Column</th><th>Needed</th><th>What it holds</th><th>Example</th><th>Also accepted</th></tr></thead>
              <tbody>
                {COLUMNS.map((c) => {
                  let need = "yd-need opt";
                  if (c[1] === "Required") {
                    need = "yd-need req";
                  } else if (c[1] === "Recommended") {
                    need = "yd-need rec";
                  }
                  return (
                    <tr key={c[0]}>
                      <td><code>{c[0]}</code></td>
                      <td><span className={need}>{c[1]}</span></td>
                      <td>{c[2]}</td>
                      <td><code>{c[3]}</code></td>
                      <td className="yd-alias">{c[4]}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <h3 className="yd-h3 plain">Example</h3>
          <div className="pd-table-wrap">
            <table className="pd-table yd-example">
              <thead><tr>{["latitude", "longitude", "acq_date", "acq_time", "satellite", "instrument", "confidence", "frp", "daynight"].map((h) => <th key={h}><code>{h}</code></th>)}</tr></thead>
              <tbody>
                {EXAMPLE.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}><code>{c}</code></td>)}</tr>)}
              </tbody>
            </table>
          </div>
          <p className="yd-caption">Three rows of the sample file — real VIIRS S-NPP detections over Punjab, 17 October 2013.</p>

          <div className="yd-rules">
            <div><b>Separator</b><span>Comma, semicolon or tab. Detected from the header row.</span></div>
            <div><b>Numbers</b><span>Use a dot for decimals (30.114, not 30,114). Decimal degrees, not degrees-minutes-seconds.</span></div>
            <div><b>Size</b><span>Up to 25 MB. The first 20,000 data rows are read; a longer file is flagged, not silently cut.</span></div>
            <div><b>Empty values</b><span>Left empty and counted. A missing value is never turned into 0.</span></div>
          </div>

          <div className="yd-dlgrid">
            {DOWNLOADS.map((d) => (
              <a key={d.href} className="yd-dlcard" href={d.href} download={d.file} style={{ "--dl": d.color }}>
                <span className="yd-dlcard-top">
                  <span className="yd-dlcard-ico" aria-hidden="true">{d.icon}</span>
                  <span className="yd-dlcard-type">{d.type}</span>
                </span>
                <span className="yd-dlcard-k">{d.kicker}</span>
                <b>{d.title}</b>
                <span className="yd-dlcard-text">{d.text}</span>
                <span className="yd-dlcard-list">
                  {d.points.map((pt) => <span key={pt}>{pt}</span>)}
                </span>
                <span className="yd-dlcard-foot">
                  <span>{d.meta}</span>
                  <span className="yd-dlcard-go">Download<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M12 4v11m-5-5 5 5 5-5M5 20h14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
                </span>
              </a>
            ))}
          </div>
        </div>
      </section>

      <section className="pd-sec">
        <div className="pd-margin"><b>Ten steps</b><span>Upload → Export</span></div>
        <div className="pd-col">
          <h2>What each step does</h2>
          <p>Six steps run in your browser today. The four that match your points against NASA FIRMS need the comparison service, which is still being built (milestone M7); they are marked as planned rather than faked.</p>
          <ol className="yd-steplist">
            {STEPS.map((s, i) => {
              let tag = <span className="yd-tag now">Works now</span>;
              if (!s[2]) {
                tag = <span className="yd-tag later">Planned · M7</span>;
              }
              return (
                <li key={s[0]}>
                  <i>{String(i + 1).padStart(2, "0")}</i>
                  <div><b>{s[0]}</b><span>{s[1]}</span></div>
                  {tag}
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      <p className="pd-caveat"><b>About your points.</b> Uploaded points are shown as they were written. The studio checks that coordinates are possible, not that they are right. A FIRMS hot spot is a pixel, not a fire.</p>
    </div>
  );
}
