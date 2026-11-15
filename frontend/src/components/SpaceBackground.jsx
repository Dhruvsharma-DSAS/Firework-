import { useEffect, useState } from "react";

const ANCHOR_IDS = ["top", "how", "service", "satpin@0", "satpin@0.5", "calendar", "mission"];
const SLOT_IDS = [["modis", "dossier-modis"], ["viirs", "dossier-viirs"]];

function maxScroll() {
  return Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
}

function scrollProgress() {
  return Math.min(1, Math.max(0, window.scrollY / maxScroll()));
}

function smooth(t) {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

function ramp(v, a, b) {
  return smooth((v - a) / (b - a));
}

function stages(t) {
  return {
    x: ramp(t, 0.16, 0.36) * (1 - ramp(t, 0.86, 0.94)),
    r: ramp(t, 0.56, 0.66) * (1 - ramp(t, 0.78, 0.84)),
  };
}

function readAnchors() {
  const max = maxScroll();
  const vh = window.innerHeight;
  const list = [];
  let prev = 0;
  ANCHOR_IDS.forEach((key, i) => {
    const parts = key.split("@");
    const el = document.getElementById(parts[0]);
    let p = prev;
    if (i === 0) {
      p = 0;
    } else if (el) {
      const r = el.getBoundingClientRect();
      let y = r.top + window.scrollY - vh * 0.35;
      if (parts.length > 1) {
        y = r.top + window.scrollY - vh * 0.6 + Math.max(0, r.height - vh) * Number(parts[1]);
      }
      p = y / max;
    }
    if (p < prev) {
      p = prev;
    }
    if (p > 1) {
      p = 1;
    }
    list.push(p);
    prev = p;
  });
  return list;
}

function readPinned() {
  const pin = document.getElementById("satpin");
  if (!pin) {
    return null;
  }
  const stick = pin.querySelector(".satpin-stick");
  if (!stick || getComputedStyle(stick).position !== "sticky") {
    return null;
  }
  const vh = window.innerHeight;
  const r = pin.getBoundingClientRect();
  const range = Math.max(1, r.height - vh);
  const u = -r.top / range;
  const sr = stick.getBoundingClientRect();
  const leave = smooth((vh * 0.2 - (sr.top + sr.height / 2)) / (vh * 0.45));
  const m = stages(u / 0.5);
  const v = stages((u - 0.5) / 0.5);
  return {
    modis: smooth((u + 0.2) / 0.2) * (1 - ramp(u / 0.5, 0.93, 1.0)),
    viirs: ramp((u - 0.5) / 0.5, 0.0, 0.09) * (1 - leave),
    modisX: m.x,
    viirsX: v.x,
    modisR: m.r,
    viirsR: v.r,
  };
}

function readSlots() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const slots = {};
  const pinned = readPinned();
  SLOT_IDS.forEach((pair) => {
    const box = document.querySelector("#" + pair[1] + " .vis");
    if (!box) {
      return;
    }
    const r = box.getBoundingClientRect();
    const cy = r.top + r.height / 2;
    const enter = smooth((vh - cy) / (vh * 0.5));
    const leave = smooth((vh * 0.2 - cy) / (vh * 0.45));
    let e = enter * (1 - leave);
    let x = 0;
    let open = 0;
    if (pinned) {
      e = pinned[pair[0]];
      x = pinned[pair[0] + "X"];
      open = pinned[pair[0] + "R"];
    }
    const slot = { x: (r.left + r.width / 2) / vw, y: cy / vh, w: r.width / vw, h: r.height / vh, e: e, explode: x, reveal: open };
    if (pinned && vw > 900) {
      const t = smooth(x * 1.7);
      slot.x = slot.x + (0.62 - slot.x) * t;
      slot.y = slot.y + (0.5 - slot.y) * t;
      slot.w = slot.w + (0.36 - slot.w) * t;
      slot.h = slot.h + (0.62 - slot.h) * t;
    }
    slots[pair[0]] = slot;
  });
  return slots;
}

function markDocked(slots) {
  SLOT_IDS.forEach((pair) => {
    const el = document.getElementById(pair[1]);
    if (!el || !slots[pair[0]]) {
      return;
    }
    const value = slots[pair[0]].e;
    if (value > 0.82) {
      el.classList.add("docked");
    } else if (value < 0.45) {
      el.classList.remove("docked");
    }
    const opened = slots[pair[0]].explode;
    if (opened > 0.18 && window.innerWidth > 900) {
      el.classList.add("opened");
    } else if (opened < 0.1 || window.innerWidth <= 900) {
      el.classList.remove("opened");
    }
  });
}

export default function SpaceBackground(props) {
  const [scene, setScene] = useState(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const canvas = document.getElementById("space-canvas");
    if (!canvas) {
      return undefined;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let stopped = false;
    let S = null;
    let raf = 0;
    let last = 0;

    function sync(jump) {
      S.setAnchors(readAnchors());
      S.setScroll(scrollProgress());
      const slots = readSlots();
      S.setSlots(slots);
      if (jump) {
        S.frame(0, true);
      }
      markDocked(slots);
    }

    function resize() {
      if (S) {
        S.setSize(window.innerWidth, window.innerHeight);
        sync(true);
      }
    }

    function tick(now) {
      if (stopped) {
        return;
      }
      if (document.hidden) {
        last = now;
        raf = requestAnimationFrame(tick);
        return;
      }
      if (last === 0) {
        last = now;
      }
      const dt = (now - last) / 1000;
      last = now;
      sync(false);
      S.frame(dt, false);
      raf = requestAnimationFrame(tick);
    }

    function onScrollReduced() {
      if (S) {
        sync(true);
      }
    }

    function onScrollState() {
      setProgress(scrollProgress());
    }

    function onSkip() {
      if (S) {
        S.skipIntro();
      }
    }

    function onLanded(event) {
      if (S && S.setClock) {
        S.setClock(event.detail);
        S.frame(0, false);
      }
    }

    function onPointer(event) {
      if (S) {
        S.setPointer(event.clientX, event.clientY);
      }
    }

    import("../lib/earth3d.js")
      .then((kit) => kit.createEarthScene(canvas, { dpr: Math.min(window.devicePixelRatio || 1, 1.5), fires: props.fires, labelLayer: document.getElementById("sat-labels") }))
      .then((s) => {
        if (stopped) {
          s.dispose();
          return;
        }
        S = s;
        S.setSize(window.innerWidth, window.innerHeight);
        sync(true);
        setScene(() => s);
        if (props.onReady) {
          props.onReady();
        }
        if (reduce) {
          S.setAuto(false);
          window.addEventListener("scroll", onScrollReduced, { passive: true });
        } else {
          raf = requestAnimationFrame(tick);
        }
      })
      .catch((error) => {
        console.error("Earth scene failed", error);
        setScene(null);
        if (props.onReady) {
          props.onReady();
        }
      });

    window.addEventListener("resize", resize);
    window.addEventListener("scroll", onScrollState, { passive: true });
    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("intro-skip", onSkip);
    window.addEventListener("intro-landed", onLanded);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", onScrollReduced);
      window.removeEventListener("scroll", onScrollState);
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("intro-skip", onSkip);
      window.removeEventListener("intro-landed", onLanded);
      if (S) {
        S.dispose();
      }
    };
  }, []);

  useEffect(() => {
    if (scene && props.fires) {
      scene.setFires(props.fires);
    }
  }, [scene, props.fires]);

  let canvasOpacity = 0;
  if (scene) {
    canvasOpacity = 1;
  }
  let flareOpacity = 1 - progress * 3;
  if (flareOpacity < 0) {
    flareOpacity = 0;
  }
  let shade = 0.1 + Math.min(1, progress * 5) * 0.35;
  if (shade > 0.45) {
    shade = 0.45;
  }

  return (
    <>
      <div className="space-bg" aria-hidden="true">
        <canvas id="space-canvas" style={{ opacity: canvasOpacity }} />
        <div className="space-flare" style={{ opacity: flareOpacity }}><i /><b /><s /></div>
        <div className="space-shade" style={{ opacity: shade }} />
        <div className="space-left" />
      </div>
      <div className="sat-labels" id="sat-labels" />
    </>
  );
}
