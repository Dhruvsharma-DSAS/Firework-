import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Badge from "../components/Badge.jsx";
import "../styles/pagedoc.css";
import "../styles/yourdata.css";

const SLOTS = [
  ["robust_z", "Robust z vs normal", "How unusual this season is against the region’s own 2012–2025 record (median and MAD, so one extreme year cannot set the scale)."],
  ["cell_days_per_valid_day", "Fire cell-days per valid day", "Burning activity divided by the days the satellites actually had a clear view, so a cloudy month does not look quiet."],
  ["blind_spot_flag", "Blind-spot flag", "Raised when burning is likely to fall between overpasses or under cloud, so the count is a floor, not a total."],
];

function prettyRegion(id) {
  return id.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" – ");
}

export default function Brief() {
  const params = useParams();
  const navigate = useNavigate();
  const region = params.id || "world";
  const name = prettyRegion(region);

  useEffect(() => {
    document.title = "Brief · " + name + " · FIREWORK CHRONOS";
  }, [name]);

  return (
    <div className="pd yd yd-brief">
      <header className="pd-head yd-noprint ph" style={{ "--ph": "var(--user)" }}>
        <div>
          <div className="eyebrow">Your data · Brief</div>
          <h1 className="ph-title">Region <em>brief</em></h1>
          <p className="ph-q">A one-page brief for {name}</p>
          <p className="pd-lead">A printable summary a district officer or a journalist can read in two minutes: one headline, three numbers, what they mean, and where they came from.</p>
        </div>
        <div className="pd-tags"><Badge kind="SIMULATED_DEMO" text="Template · no run report yet" /></div>
      </header>

      <div className="yd-brief-grid">
        <aside className="yd-brief-how yd-noprint">
          <h2 className="pd-h2">How a brief is made</h2>
          <ol className="pd-steps">
            <li><b>The pipeline runs</b><span>The archive pipeline computes the region’s numbers and writes them, with their method version and run hash, to <code className="pd-code">RunReport.json</code>.</span></li>
            <li><b>Numbers fill the template</b><span>Each slot on the page is linked to one field in that file. No number is typed by hand.</span></li>
            <li><b>Words are written around them</b><span>A fixed template writes the sentences. An AI model may later translate them, but it never creates or edits a number — every figure in the text must exist in the report.</span></li>
            <li><b>Print or save as PDF</b><span>The brief prints on one A4 page with sources and the life-safety caveat.</span></li>
          </ol>
          <div className="pd-aside amber yd-brief-state"><b>Why the page is empty.</b> No run report has been produced for {name} yet, so the slots show which field will go where instead of inventing figures.</div>
          <div className="yd-brief-links">
            <button type="button" className="pd-btn small" onClick={() => navigate("/calendar/" + region)}>See the {name} calendar</button>
            <button type="button" className="pd-btn small" onClick={() => navigate("/validation")}>How results are tested</button>
          </div>
        </aside>

        <article className="yd-paper" aria-label={"Research brief template for " + name}>
          <div className="yd-paper-top">
            <span>FIREWORK CHRONOS · Research brief</span>
            <span className="yd-paper-tag">Template preview</span>
          </div>
          <div className="yd-paper-region">{name}</div>
          <h2 className="yd-paper-h">
            <span className="yd-slot-line">Headline written from RunReport.json</span>
          </h2>
          <div className="yd-paper-figs">
            {SLOTS.map((s) => (
              <div key={s[0]} className="yd-paper-fig">
                <div className="yd-slot">—</div>
                <b>{s[1]}</b>
                <code>{s[0]}</code>
              </div>
            ))}
          </div>
          <h3>What it means</h3>
          <p className="yd-paper-p">Sentences here are filled from the computed numbers only. For example: “Burning this season sat <span className="yd-slot-inline">robust_z</span> robust deviations from a normal year, counted only on days the satellites could see the ground.”</p>
          <dl className="yd-paper-dl">
            {SLOTS.map((s) => (
              <div key={s[0]}>
                <dt>{s[1]}</dt>
                <dd>{s[2]}</dd>
              </div>
            ))}
          </dl>
          <p className="yd-paper-warn"><b>Not for life-safety decisions.</b> Satellite fire detections have limited accuracy and miss fires under cloud, between passes, or below detection size.</p>
          <p className="yd-paper-src">Sources: NASA FIRMS (VIIRS 375 m, MODIS Collection 6.1) · exposure: MOD14A1 / VNP14A1 · method version, run hash and generated date are printed here from RunReport.json.</p>
          <div className="yd-paper-foot yd-noprint">
            <button type="button" className="pd-btn small solid" onClick={() => window.print()}>Print / save as PDF</button>
            <span>Prints this page only, on A4.</span>
          </div>
        </article>
      </div>
    </div>
  );
}
