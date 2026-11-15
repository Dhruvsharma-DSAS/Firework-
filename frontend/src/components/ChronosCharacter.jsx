import { useEffect, useState } from "react";

const EYE_L = [47, 61];
const EYE_R = [73, 61];
const MOUTH_Y = 75;

export const EXPRESSIONS = {
  neutral: { l: [6, 9, 9, 0], r: [6, 9, 9, 0], m: [60, 6, 3, 1], look: [0, 0], tilt: 0 },
  happy: { l: [7, 10, -3, 0], r: [7, 10, -3, 0], m: [60, 8, 7, 2], look: [0, 0], tilt: -3 },
  thinking: { l: [6, 8, 8, 0], r: [6, 8, 8, 0], m: [65, 4, 1, -1], look: [3, -3], tilt: 4 },
  confused: { l: [6, 10, 10, 0], r: [6, 4, 4, 0], m: [60, 6, 2, -2], look: [-1, 0], tilt: 9 },
  excited: { l: [7, 13, 13, 0], r: [7, 13, 13, 0], m: [60, 8, 9, -1], look: [0, -1], tilt: -2 },
  funny: { l: [7, 5, -2, 0], r: [7, 10, -3, 0], m: [62, 8, 7, 1], look: [1, 0], tilt: -6 },
  surprised: { l: [7, 14, 14, 0], r: [7, 14, 14, 0], m: [60, 3, 5, -5], look: [0, -1], tilt: 0 },
  curious: { l: [6, 13, 9, 0], r: [6, 8, 8, 0], m: [62, 4, 2, 0], look: [-2, 0], tilt: 6 },
  listening: { l: [6, 11, 11, 0], r: [6, 11, 11, 0], m: [60, 5, 3, 1], look: [0, 1], tilt: -2 },
  sleepy: { l: [6, 2, 5, 0], r: [6, 2, 5, 0], m: [60, 4, 1, 0], look: [0, 1], tilt: 3 },
  concerned: { l: [6, 7, 10, -14], r: [6, 7, 10, 14], m: [60, 6, -4, -1], look: [0, 1], tilt: 0 },
};

function eyePath(c, e) {
  const x = c[0];
  const y = c[1];
  return "M " + (x - e[0]) + " " + y + " Q " + x + " " + (y - 2 * e[1]) + " " + (x + e[0]) + " " + y + " Q " + x + " " + (y + 2 * e[2]) + " " + (x - e[0]) + " " + y + " Z";
}

function mouthPath(m) {
  return "M " + (m[0] - m[1]) + " " + MOUTH_Y + " Q " + m[0] + " " + (MOUTH_Y + 2 * m[2]) + " " + (m[0] + m[1]) + " " + MOUTH_Y + " Q " + m[0] + " " + (MOUTH_Y + 2 * m[3]) + " " + (m[0] - m[1]) + " " + MOUTH_Y + " Z";
}

const ORBIT = { cx: 60, cy: 66, rx: 55, ry: 15, tilt: -12 };

function Satellite(props) {
  return (
    <g id={props.id} className="cx-sat" style={{ display: "none" }}>
      <rect x="-10" y="-2.4" width="6.6" height="4.8" rx="0.6" fill="#315db5" stroke="#9cc0ff" strokeWidth="0.35" />
      <path d="M-7.8 -2.4v4.8M-5.6 -2.4v4.8M-10 0h6.6" stroke="#9cc0ff" strokeWidth="0.25" strokeOpacity="0.8" />
      <rect x="3.4" y="-2.4" width="6.6" height="4.8" rx="0.6" fill="#315db5" stroke="#9cc0ff" strokeWidth="0.35" />
      <path d="M5.6 -2.4v4.8M7.8 -2.4v4.8M3.4 0h6.6" stroke="#9cc0ff" strokeWidth="0.25" strokeOpacity="0.8" />
      <path d="M-3.4 0h-0.6M3.4 0h0.6" stroke="#cfd8e3" strokeWidth="0.6" />
      <rect x="-2.8" y="-2.8" width="5.6" height="5.6" rx="0.9" fill="#d9a843" stroke="#ffe2a8" strokeWidth="0.4" />
      <rect x="-2.8" y="-2.8" width="2.4" height="5.6" rx="0.9" fill="#ffffff" fillOpacity="0.18" />
      <path d="M0 -2.8v-2" stroke="#cfd8e3" strokeWidth="0.45" />
      <circle cx="0" cy="-5.2" r="0.9" fill="#e5edf6" />
      <circle cx="1.4" cy="1.4" r="0.55" fill="#35cbe8" />
    </g>
  );
}

export default function ChronosCharacter(props) {
  const uid = props.uid;
  const [stage, setStage] = useState("");

  useEffect(() => {
    if (!props.welcome) {
      return undefined;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      return undefined;
    }
    const steps = [[0, "sleepy"], [650, "wake"], [1250, "enter"], [1800, "follow"], [3400, "surprised"], [4000, "funny"], [4800, ""]];
    const timers = steps.map((s) => setTimeout(() => setStage(s[1]), s[0]));
    return () => timers.forEach((t) => clearTimeout(t));
  }, [props.welcome]);

  useEffect(() => {
    if (!props.orbit) {
      return undefined;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let angle = 2.6;
    let last = performance.now();
    let raf = 0;
    let alive = true;
    const rad = (ORBIT.tilt * Math.PI) / 180;
    function frame(now) {
      if (!alive) {
        return;
      }
      const root = document.getElementById(uid + "-root");
      const front = document.getElementById(uid + "-sat-front");
      const back = document.getElementById(uid + "-sat-back");
      const track = document.getElementById(uid + "-track");
      if (!root || !front || !back) {
        raf = requestAnimationFrame(frame);
        return;
      }
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!document.hidden && !reduce) {
        angle = angle + dt * 0.85;
      }
      const ex = ORBIT.rx * Math.cos(angle);
      const ey = ORBIT.ry * Math.sin(angle);
      const x = ORBIT.cx + ex * Math.cos(rad) - ey * Math.sin(rad);
      const y = ORBIT.cy + ex * Math.sin(rad) + ey * Math.cos(rad);
      const depth = Math.sin(angle);
      const scale = 0.82 + 0.24 * depth;
      const hidden = root.getAttribute("data-sat") === "off";
      const t = "translate(" + x.toFixed(2) + " " + y.toFixed(2) + ") scale(" + scale.toFixed(3) + ") rotate(" + (ORBIT.tilt + Math.cos(angle) * 8).toFixed(1) + ")";
      front.setAttribute("transform", t);
      back.setAttribute("transform", t);
      if (hidden) {
        front.style.display = "none";
        back.style.display = "none";
      } else if (depth > 0) {
        front.style.display = "";
        back.style.display = "none";
      } else {
        front.style.display = "none";
        back.style.display = "";
      }
      if (track) {
        if (root.getAttribute("data-follow") === "on") {
          const dx = Math.max(-4, Math.min(4, (x - 60) / 9));
          const dy = Math.max(-3, Math.min(3, (y - 60) / 9));
          track.setAttribute("transform", "translate(" + dx.toFixed(2) + " " + dy.toFixed(2) + ")");
        } else {
          track.setAttribute("transform", "translate(0 0)");
        }
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [props.orbit, uid]);

  let exprName = props.expr || "happy";
  if (stage === "sleepy" || stage === "surprised" || stage === "funny") {
    exprName = stage;
  } else if (stage === "wake" || stage === "enter") {
    exprName = "neutral";
  } else if (stage === "follow") {
    exprName = "curious";
  }
  const ex = EXPRESSIONS[exprName] || EXPRESSIONS.happy;
  let satState = "on";
  if (stage === "sleepy" || stage === "wake") {
    satState = "off";
  }
  let follow = "off";
  if (stage === "follow") {
    follow = "on";
  }
  let cls = "cx-char cx-" + exprName;
  if (props.welcome) {
    cls = cls + " cx-welcome";
  }
  if (props.still) {
    cls = cls + " cx-still";
  }
  let orbitBack = null;
  let orbitFront = null;
  let satBack = null;
  let satFront = null;
  let sparks = null;
  if (props.orbit) {
    const a = ORBIT;
    orbitBack = <path className="cx-orbit back" d={"M " + (a.cx - a.rx) + " " + a.cy + " A " + a.rx + " " + a.ry + " 0 0 1 " + (a.cx + a.rx) + " " + a.cy} transform={"rotate(" + a.tilt + " " + a.cx + " " + a.cy + ")"} />;
    orbitFront = <path className="cx-orbit front" d={"M " + (a.cx + a.rx) + " " + a.cy + " A " + a.rx + " " + a.ry + " 0 0 1 " + (a.cx - a.rx) + " " + a.cy} transform={"rotate(" + a.tilt + " " + a.cx + " " + a.cy + ")"} />;
    satBack = <Satellite id={uid + "-sat-back"} />;
    satFront = <Satellite id={uid + "-sat-front"} />;
    sparks = (
      <g className="cx-sparks">
        <circle cx="14" cy="30" r="0.8" /><circle cx="104" cy="24" r="0.6" /><circle cx="110" cy="92" r="0.7" /><circle cx="10" cy="88" r="0.6" /><circle cx="96" cy="10" r="0.5" /><circle cx="26" cy="12" r="0.5" />
      </g>
    );
  }

  return (
    <svg id={uid + "-root"} className={cls} width={props.size} height={props.size} viewBox="-6 -6 132 132" data-sat={satState} data-follow={follow} aria-hidden="true">
      <defs>
        <linearGradient id={uid + "-shell"} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="#1d2f52" />
          <stop offset="0.55" stopColor="#0d1830" />
          <stop offset="1" stopColor="#060b18" />
        </linearGradient>
        <radialGradient id={uid + "-visor"} cx="0.5" cy="0.35" r="0.75">
          <stop offset="0" stopColor="#0b2340" />
          <stop offset="1" stopColor="#030a16" />
        </radialGradient>
        <radialGradient id={uid + "-halo"} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#35cbe8" stopOpacity="0.22" />
          <stop offset="1" stopColor="#35cbe8" stopOpacity="0" />
        </radialGradient>
        <filter id={uid + "-glow"} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="1.6" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      {sparks}
      <circle cx="60" cy="62" r="54" fill={"url(#" + uid + "-halo)"} className="cx-halo" />
      {orbitBack}
      {satBack}
      <ellipse cx="60" cy="112" rx="24" ry="3.5" fill="#000" opacity="0.35" className="cx-shadow" />
      <g className="cx-float">
        <g className="cx-head" style={{ transform: "rotate(" + ex.tilt + "deg)" }}>
          <rect x="15.5" y="54" width="7" height="18" rx="3.5" fill="#0c172c" stroke="#35cbe8" strokeOpacity="0.45" strokeWidth="0.8" />
          <rect x="17.8" y="58" width="2.4" height="10" rx="1.2" fill="#35cbe8" opacity="0.8" />
          <rect x="97.5" y="54" width="7" height="18" rx="3.5" fill="#0c172c" stroke="#35cbe8" strokeOpacity="0.45" strokeWidth="0.8" />
          <rect x="99.8" y="58" width="2.4" height="10" rx="1.2" fill="#35cbe8" opacity="0.8" />
          <rect x="21" y="32" width="78" height="64" rx="30" fill={"url(#" + uid + "-shell)"} stroke="#35cbe8" strokeOpacity="0.38" strokeWidth="1" />
          <path d="M32 40 Q44 33 60 33" stroke="#ffffff" strokeOpacity="0.22" strokeWidth="2.4" strokeLinecap="round" fill="none" />
          <rect x="29" y="41" width="62" height="46" rx="21" fill={"url(#" + uid + "-visor)"} stroke="#1c4558" strokeWidth="1" />
          <g className="cx-dial">
            <circle cx="60" cy="27" r="6.2" fill="#0c172c" stroke="#35cbe8" strokeOpacity="0.7" strokeWidth="1" />
            <path className="cx-hand" d="M60 27 L60 22.6" stroke="#f4ad45" strokeWidth="1.2" strokeLinecap="round" />
            <circle cx="60" cy="27" r="1" fill="#e5edf6" />
          </g>
          <g className="cx-face" filter={"url(#" + uid + "-glow)"}>
            <g className="cx-look" style={{ transform: "translate(" + ex.look[0] + "px, " + ex.look[1] + "px)" }}>
              <g id={uid + "-track"}>
                <g className="cx-eyes">
                  <path className="cx-eye" d={eyePath(EYE_L, ex.l)} style={{ transform: "rotate(" + ex.l[3] + "deg)" }} />
                  <path className="cx-eye" d={eyePath(EYE_R, ex.r)} style={{ transform: "rotate(" + ex.r[3] + "deg)" }} />
                </g>
              </g>
            </g>
            <path className="cx-mouth" d={mouthPath(ex.m)} />
          </g>
        </g>
      </g>
      {orbitFront}
      {satFront}
    </svg>
  );
}
