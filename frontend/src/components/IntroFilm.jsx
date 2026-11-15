import { useEffect, useState } from "react";

const SCENES = [
  { at: 0, eyebrow: "Since 2000 · MODIS", text: "NASA satellites watch every fire on Earth." },
  { at: 3.2, eyebrow: "Since 2012 · VIIRS", text: "A sharper eye joined — and counts more fire." },
  { at: 6.4, eyebrow: "MODIS × VIIRS · 2000 → 2026", text: "Five satellites, two sensors. One trusted record of fire." },
];
const END = 9.6;
const SCALE = 6.2 / END;
const ONCE = { pending: window.location.pathname === "/" };

export function introPending() {
  return ONCE.pending;
}

function sceneIndex(t) {
  let idx = 0;
  SCENES.forEach((s, i) => {
    if (t >= s.at) {
      idx = i;
    }
  });
  return idx;
}

export default function IntroFilm(props) {
  const [idx, setIdx] = useState(0);
  const [over, setOver] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [live, setLive] = useState(false);

  useEffect(() => {
    ONCE.pending = false;
    document.body.classList.add("intro-on");
    return () => document.body.classList.remove("intro-on");
  }, []);

  useEffect(() => {
    const canvas = document.getElementById("intro-canvas");
    if (!canvas) {
      return undefined;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let stopped = false;
    let S = null;
    let raf = 0;
    let start = 0;
    let last = -1;
    let speed = 1.35;
    let clock = 0;
    let prev = 0;

    function resize() {
      if (S) {
        S.setSize(window.innerWidth, window.innerHeight);
      }
    }

    function onSkip() {
      speed = 4;
    }

    function tick(now) {
      if (stopped) {
        return;
      }
      if (start === 0) {
        start = now;
        prev = now;
      }
      clock = Math.min(END, clock + ((now - prev) / 1000) * speed);
      prev = now;
      S.frame(clock * SCALE);
      const i = sceneIndex(clock);
      if (i !== last) {
        last = i;
        setIdx(i);
      }
      if (clock >= END) {
        window.dispatchEvent(new CustomEvent("intro-landed", { detail: END * SCALE }));
        setOver(true);
        return;
      }
      raf = requestAnimationFrame(tick);
    }

    import("../lib/introScene.js")
      .then((kit) => kit.createIntroScene(canvas))
      .then((s) => {
        if (stopped) {
          s.dispose();
          return;
        }
        S = s;
        resize();
        setLive(true);
        if (reduce) {
          S.frame(6.2);
          window.dispatchEvent(new CustomEvent("intro-landed", { detail: 6.2 }));
          setIdx(SCENES.length - 1);
          setOver(true);
          return;
        }
        raf = requestAnimationFrame(tick);
      })
      .catch(() => setOver(true));

    window.addEventListener("resize", resize);
    window.addEventListener("intro-skip", onSkip);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("intro-skip", onSkip);
      if (S) {
        S.dispose();
      }
    };
  }, []);

  const finished = over && props.ready;

  useEffect(() => {
    if (!finished) {
      return undefined;
    }
    document.body.classList.remove("intro-on");
    const id = setTimeout(() => props.onDone(), 700);
    return () => clearTimeout(id);
  }, [finished]);

  function skip() {
    setSkipped(true);
    window.dispatchEvent(new Event("intro-skip"));
  }

  const scene = SCENES[idx];
  let cls = "intro s" + idx;
  if (live) {
    cls = cls + " live";
  }
  if (finished) {
    cls = cls + " gone";
  }

  let brand = null;
  if (idx === SCENES.length - 1) {
    brand = (
      <div className="intro-brand">
        <img src="/logo_ribbon_anim.svg" alt="" />
        <div><b>FIREWORK</b><small>CHRONOS · FIRE RECORD</small></div>
      </div>
    );
  }

  let copy = <div className="intro-wait"><span className="dot" />Loading the Earth…</div>;
  if (live) {
    copy = (
      <div className="intro-copy" key={idx}>
        {brand}
        <span className="intro-eyebrow">{scene.eyebrow}</span>
        <h2>{scene.text}</h2>
      </div>
    );
  }
  if (over && !props.ready) {
    copy = <div className="intro-wait"><span className="dot" />Loading live NASA FIRMS fires…</div>;
  }

  const bars = SCENES.map((s, i) => {
    let c = "";
    if (live && i < idx) {
      c = "done";
    } else if (live && i === idx) {
      c = "on";
    }
    return <span key={i} className={c}><i /></span>;
  });

  let skipBtn = null;
  if (!skipped) {
    skipBtn = (
      <button className="intro-skip" onClick={skip} aria-label="Skip the introduction">
        <span>Skip intro</span>
        <i aria-hidden="true"><svg viewBox="0 0 16 16" width="12" height="12"><path d="M3 3.5v9l6-4.5zM9.5 3.5v9l5.5-4.5z" fill="currentColor" /></svg></i>
      </button>
    );
  }

  return (
    <div className={cls} role="dialog" aria-label="FIREWORK CHRONOS introduction">
      <canvas id="intro-canvas" className="intro-canvas" />
      <div className="intro-vignette" />
      {copy}
      <div className="intro-bars">{bars}</div>
      {skipBtn}
    </div>
  );
}
