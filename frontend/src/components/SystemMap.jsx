import { useNavigate } from "react-router-dom";

export const STAGES = [
  ["observe", "Observe"],
  ["count", "Count"],
  ["calibrate", "Calibrate"],
  ["uncertainty", "Bound"],
  ["test", "Test"],
  ["explain", "Explain"],
];

export const PAGES = [
  ["explore", "Explorer", "/explore"],
  ["calendar", "Calendar", "/calendar/world"],
  ["sensors", "Sensor Lab", "/sensors"],
  ["validation", "Validation", "/validation"],
  ["sources", "Sources", "/sources"],
  ["blind", "Blind Spot", "/blind-spot"],
  ["brief", "Brief", "/brief/punjab_haryana"],
  ["formulas", "Formulas", "/formulas"],
];

export default function SystemMap(props) {
  const navigate = useNavigate();
  const stages = props.stages || [];
  const pages = props.pages || [];
  const sw = 112;
  const gap = 22;
  const pw = 86;
  const pgap = 8;

  return (
    <div className="sysmap">
      <svg className="sysmap-svg" viewBox="0 0 800 196" role="img" aria-label="Where this formula sits in the FIREWORK pipeline and on the website">
        <defs>
          <marker id="sysmap-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0 0L8 4L0 8z" className="sysmap-arrowhead" />
          </marker>
        </defs>
        <text x="0" y="14" className="sysmap-cap">Pipeline stage</text>
        {STAGES.map((s, i) => {
          const x = i * (sw + gap) + 2;
          let cls = "sysmap-stage";
          if (stages.indexOf(s[0]) >= 0) {
            cls = "sysmap-stage on";
          }
          let arrow = null;
          if (i < STAGES.length - 1) {
            arrow = <line x1={x + sw + 2} y1="46" x2={x + sw + gap - 3} y2="46" className="sysmap-link" markerEnd="url(#sysmap-arrow)" />;
          }
          return (
            <g key={s[0]}>
              <rect x={x} y="26" width={sw} height="40" rx="3" className={cls} />
              <text x={x + sw / 2} y="50" className="sysmap-label">{s[1]}</text>
              {arrow}
            </g>
          );
        })}
        <text x="0" y="104" className="sysmap-cap">Shown on</text>
        {PAGES.map((p, i) => {
          const x = i * (pw + pgap) + 2 + 12;
          let cls = "sysmap-page";
          if (pages.indexOf(p[0]) >= 0) {
            cls = "sysmap-page on";
          }
          return (
            <g key={p[0]} className="sysmap-go" onClick={() => navigate(p[2])} role="link" tabIndex={0} aria-label={p[1] + " page"} onKeyDown={(e) => { if (e.key === "Enter") { navigate(p[2]); } }}>
              <rect x={x} y="116" width={pw} height="56" rx="3" className={cls} />
              <text x={x + pw / 2} y="140" className="sysmap-label">{p[1]}</text>
              <text x={x + pw / 2} y="158" className="sysmap-route">{p[2].split("/")[1]}</text>
            </g>
          );
        })}
      </svg>
      <div className="sysmap-chips">
        <div>
          <span className="sysmap-chips-k">Pipeline stage</span>
          {STAGES.filter((s) => stages.indexOf(s[0]) >= 0).map((s) => <span key={s[0]} className="route-chip on">{s[1]}</span>)}
        </div>
        <div>
          <span className="sysmap-chips-k">Shown on</span>
          {PAGES.filter((p) => pages.indexOf(p[0]) >= 0).map((p) => <a key={p[0]} className="route-chip" href={p[2]} onClick={(e) => { e.preventDefault(); navigate(p[2]); }}>{p[1]}</a>)}
        </div>
      </div>
    </div>
  );
}
