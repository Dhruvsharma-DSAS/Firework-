import { useState } from "react";
import "../styles/calendar-heatmap.css";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const RAMP = [[22, 32, 58], [74, 42, 58], [154, 59, 59], [224, 112, 58], [255, 196, 107], [255, 241, 201]];

export function rampColor(t) {
  const x = Math.max(0, Math.min(1, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  const f = x - i;
  const rgb = [0, 1, 2].map((k) => Math.round(RAMP[i][k] + f * (RAMP[i + 1][k] - RAMP[i][k])));
  return "rgb(" + rgb.join(",") + ")";
}

export default function CalendarHeatmap(props) {
  const [focusCell, setFocusCell] = useState(null);
  const cell = props.cell || 30;
  const left = 46;
  const top = 22;
  const width = left + 12 * cell + 44;
  const height = top + props.years.length * (cell * 0.62) + 10;
  const rowH = cell * 0.62;
  const seamIndex = props.years.indexOf(props.seamYear);
  let tabRow = 0;
  let tabMonth = 0;
  if (focusCell && props.years.includes(focusCell.year)) {
    tabRow = props.years.indexOf(focusCell.year);
    tabMonth = focusCell.month;
  } else if (props.selected && props.years.includes(props.selected.year)) {
    tabRow = props.years.indexOf(props.selected.year);
    tabMonth = props.selected.month;
  }

  function handleKey(event, row, month, value) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      props.onSelect({ year: props.years[row], month, value });
      return;
    }
    let nextRow = row;
    let nextMonth = month;
    if (event.key === "ArrowUp") {
      nextRow = Math.max(0, row - 1);
    } else if (event.key === "ArrowDown") {
      nextRow = Math.min(props.years.length - 1, row + 1);
    } else if (event.key === "ArrowLeft") {
      nextMonth = Math.max(0, month - 1);
    } else if (event.key === "ArrowRight") {
      nextMonth = Math.min(MONTHS.length - 1, month + 1);
    } else {
      return;
    }
    event.preventDefault();
    const next = event.currentTarget.ownerSVGElement.querySelector('[data-cell="' + nextRow + "-" + nextMonth + '"]');
    if (next) {
      next.focus();
    }
  }
  return (
    <div className="cal-wrap">
      <svg width={width} height={height} role="group" aria-label="Calendar heatmap. Use arrow keys to browse and Enter or Space to select.">
        <defs>
          <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="#141b2b" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="#5b6780" strokeWidth="2" />
          </pattern>
        </defs>
        {MONTHS.map((m, i) => (
          <text key={"m" + i} x={left + i * cell + cell / 2} y={14} fill="var(--dim)" fontSize="11" textAnchor="middle" fontFamily="var(--font-mono)" aria-hidden="true">{m.slice(0, 3)}</text>
        ))}
        {props.years.map((year, yi) => (
          <g key={year}>
            <text x={left - 8} y={top + yi * rowH + rowH * 0.72} fill="var(--dim)" fontSize="10.5" textAnchor="end" fontFamily="var(--font-mono)" aria-hidden="true">{year}</text>
            {MONTHS.map((m, mi) => {
              const value = props.values[yi][mi];
              let fill = "url(#hatch)";
              let label = m + " " + year + ": value unavailable";
              if (value !== null && value !== undefined) {
                fill = rampColor(Math.sqrt(value / props.maxValue));
                label = m + " " + year + ": " + value.toFixed(1) + " " + props.unit;
              }
              const selected = Boolean(props.selected && props.selected.year === year && props.selected.month === mi);
              let stroke = "none";
              if (selected) {
                stroke = "#ffffff";
              }
              let tabIndex = -1;
              if (yi === tabRow && mi === tabMonth) {
                tabIndex = 0;
              }
              return (
                <rect
                  key={mi}
                  className="cell"
                  x={left + mi * cell + 1}
                  y={top + yi * rowH + 1}
                  width={cell - 2}
                  height={rowH - 2}
                  rx="2"
                  fill={fill}
                  stroke={stroke}
                  strokeWidth="2"
                  role="button"
                  tabIndex={tabIndex}
                  data-cell={yi + "-" + mi}
                  aria-label={label}
                  aria-pressed={selected}
                  onFocus={() => setFocusCell({ year, month: mi })}
                  onClick={() => props.onSelect({ year, month: mi, value })}
                  onKeyDown={(event) => handleKey(event, yi, mi, value)}
                >
                  <title>{label}</title>
                </rect>
              );
            })}
          </g>
        ))}
        {seamIndex > 0 && (
          <g aria-hidden="true" className="cal-seam-marker">
            <line x1={left - 4} x2={left + 12 * cell} y1={top + seamIndex * rowH} y2={top + seamIndex * rowH} stroke="var(--viirs)" strokeDasharray="5 4" strokeWidth="1.5" />
            <text x={left + 12 * cell + 4} y={top + seamIndex * rowH + 4} fill="var(--viirs)" fontSize="10" fontFamily="var(--font-mono)">{props.seamYear}</text>
          </g>
        )}
      </svg>
    </div>
  );
}
