import { useEffect, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { buildAqua, buildSuomiNPP, buildTerra, buildNOAA21 } from "../lib/satModels.js";

const BUILDERS = {
  terra: () => buildTerra(),
  aqua: () => buildAqua(),
  snpp: () => buildSuomiNPP(),
  noaa20: () => buildSuomiNPP({ noaa20: true }),
  noaa21: () => buildNOAA21(),
};

const SENSOR_ID = { terra: "modis", aqua: "modis", snpp: "viirs", noaa20: "viirs", noaa21: "viirs" };
const MAX_MARKS = 6;

function meshBounds(root) {
  const box = new THREE.Box3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (o.isMesh) {
      box.expandByObject(o);
    }
  });
  return box;
}

export default function SatViewer(props) {
  const satId = props.satId;
  const hostId = "satviewer-" + satId;
  const [parts, setParts] = useState([]);
  const [apart, setApart] = useState(false);
  const [inside, setInside] = useState(false);
  const [picked, setPicked] = useState("");
  const [full, setFull] = useState(false);
  const [api, setApi] = useState(null);

  useEffect(() => {
    const host = document.getElementById(hostId);
    if (!host || !BUILDERS[satId]) {
      return undefined;
    }
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    const sun = new THREE.DirectionalLight(0xfff3e0, 2.4);
    sun.position.set(8, 10, 6);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0x8fc8ff, 0.7);
    fill.position.set(-6, -3, -8);
    scene.add(fill);
    const rig = BUILDERS[satId]();
    const root = rig.root;
    scene.add(root);
    rig.update(0, 0, 0);
    const box = meshBounds(root);
    const center = box.getCenter(new THREE.Vector3());
    const radius = box.getSize(new THREE.Vector3()).length() * 0.5;
    root.position.sub(center);
    const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 400);
    const home = new THREE.Vector3(radius * 1.25, radius * 0.7, radius * 1.85);
    camera.position.copy(home);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.6;
    controls.minDistance = radius * 0.6;
    controls.maxDistance = radius * 5;
    controls.addEventListener("start", () => {
      controls.autoRotate = false;
    });
    const state = { explode: 0, explodeTo: 0, open: 0, openTo: 0, picked: "", inside: false, alive: true, w: 300, h: 200 };
    function size() {
      state.w = host.clientWidth || 300;
      state.h = host.clientHeight || 200;
      renderer.setSize(state.w, state.h, false);
      camera.aspect = state.w / state.h;
      camera.updateProjectionMatrix();
    }
    size();
    const observer = new ResizeObserver(size);
    observer.observe(host);
    const tmp = new THREE.Vector3();
    function project(part, local) {
      tmp.copy(local).add(part.group.position).sub(part.base);
      root.localToWorld(tmp);
      tmp.project(camera);
      return { x: (tmp.x * 0.5 + 0.5) * state.w, y: (-tmp.y * 0.5 + 0.5) * state.h, behind: tmp.z > 1 };
    }
    function hide(id) {
      const el = document.getElementById(id);
      if (el) {
        el.style.opacity = "0";
      }
    }
    function drawCallout() {
      const label = document.getElementById(hostId + "-label");
      const line = document.getElementById(hostId + "-line");
      const dot = document.getElementById(hostId + "-dot");
      const part = rig.parts.find((p) => p.id === state.picked);
      if (!label || !line || !dot) {
        return;
      }
      if (!part || state.inside) {
        label.style.opacity = "0";
        line.style.opacity = "0";
        dot.style.opacity = "0";
        return;
      }
      const a = project(part, part.anchor);
      let lx = a.x + 70;
      let shift = "0";
      if (a.x > state.w * 0.55) {
        lx = a.x - 70;
        shift = "-100%";
      }
      const ly = Math.max(26, Math.min(state.h - 26, a.y - 46));
      label.style.opacity = "1";
      label.style.transform = "translate(" + lx + "px," + ly + "px) translate(" + shift + ",-50%)";
      line.setAttribute("x1", String(a.x));
      line.setAttribute("y1", String(a.y));
      line.setAttribute("x2", String(lx));
      line.setAttribute("y2", String(ly));
      line.style.opacity = "1";
      dot.setAttribute("cx", String(a.x));
      dot.setAttribute("cy", String(a.y));
      dot.style.opacity = "1";
    }
    function drawMarks() {
      const sensor = rig.parts.find((p) => p.id === SENSOR_ID[satId]);
      for (let i = 0; i < MAX_MARKS; i = i + 1) {
        const el = document.getElementById(hostId + "-m" + i);
        if (!el) {
          continue;
        }
        if (!state.inside || !sensor || !sensor.sub[i] || state.open < 0.5) {
          el.style.opacity = "0";
          continue;
        }
        const m = project(sensor, sensor.sub[i].anchor);
        el.style.opacity = "1";
        el.style.transform = "translate(" + m.x + "px," + m.y + "px) translate(-50%,-50%)";
      }
    }
    const clock = new THREE.Clock();
    function frame() {
      if (!state.alive) {
        return;
      }
      const dt = Math.min(0.05, clock.getDelta());
      state.explode = state.explode + (state.explodeTo - state.explode) * Math.min(1, dt * 4);
      state.open = state.open + (state.openTo - state.open) * Math.min(1, dt * 4);
      rig.update(state.explode, clock.elapsedTime, state.open);
      rig.parts.forEach((p) => {
        if (p.id === state.picked && p.dir.lengthSq() > 0) {
          p.group.position.addScaledVector(p.dir, 0.45);
        }
      });
      controls.update();
      renderer.render(scene, camera);
      drawCallout();
      drawMarks();
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    hide(hostId + "-label");
    setParts(rig.parts.map((p) => ({ id: p.id, name: p.name, line: p.line, main: p.main, sub: p.sub })));
    setApi(() => ({
      apart: (on) => {
        state.explodeTo = Number(Boolean(on));
      },
      inside: (on) => {
        state.openTo = Number(Boolean(on));
        state.inside = Boolean(on);
      },
      pick: (id) => {
        state.picked = id;
      },
      reset: () => {
        camera.position.copy(home);
        controls.target.set(0, 0, 0);
        controls.autoRotate = true;
      },
    }));
    return () => {
      state.alive = false;
      observer.disconnect();
      controls.dispose();
      env.dispose();
      pmrem.dispose();
      root.traverse((o) => {
        if (o.geometry) {
          o.geometry.dispose();
        }
      });
      renderer.dispose();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  }, [satId, hostId]);

  useEffect(() => {
    if (api) {
      api.apart(apart);
    }
  }, [api, apart]);

  useEffect(() => {
    if (api) {
      api.inside(inside);
    }
  }, [api, inside]);

  useEffect(() => {
    if (api) {
      api.pick(picked);
    }
  }, [api, picked]);

  useEffect(() => {
    function onChange() {
      setFull(Boolean(document.fullscreenElement));
    }
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    setApart(false);
    setInside(false);
    setPicked("");
  }, [satId]);

  function toggleFull() {
    const el = document.getElementById(hostId + "-wrap");
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else if (el && el.requestFullscreen) {
      el.requestFullscreen();
    }
  }

  function pickPart(id) {
    setInside(false);
    if (picked === id) {
      setPicked("");
    } else {
      setPicked(id);
    }
  }

  function toggleInside() {
    setPicked("");
    setInside(!inside);
  }

  const sensorId = SENSOR_ID[satId];
  const sensor = parts.find((p) => p.id === sensorId);
  const current = parts.find((p) => p.id === picked);
  let sensorName = "sensor";
  if (sensor) {
    sensorName = sensor.name.split(" ·")[0];
  }

  let detail = (
    <div className="sv-detail sv-empty">
      <b>Pick a part</b>
      <span>Choose a part below to pull it out with a pointer line, or open {sensorName} to see how a fire reaches its detectors. Drag the model to turn it, scroll to zoom.</span>
    </div>
  );
  if (inside && sensor) {
    detail = (
      <div className="sv-detail">
        <b>Inside {sensorName}</b>
        <span>{sensor.line}</span>
        <ol className="sv-subs">
          {sensor.sub.slice(0, MAX_MARKS).map((s, i) => (
            <li key={s.name}><em>{i + 1}</em><div><b>{s.name}</b><span>{s.line}</span></div></li>
          ))}
        </ol>
      </div>
    );
  } else if (current) {
    detail = (
      <div className="sv-detail">
        <b>{current.name}</b>
        <span>{current.line}</span>
      </div>
    );
  }

  let apartCls = "";
  if (apart) {
    apartCls = "on";
  }
  let insideCls = "";
  if (inside) {
    insideCls = "on";
  }
  let wrapCls = "sv";
  if (full) {
    wrapCls = "sv sv-full";
  }
  let calloutText = "";
  if (current) {
    calloutText = current.name.split(" ·")[0];
  }

  let fullHead = null;
  if (full) {
    fullHead = (
      <div className="sv-fhead">
        <div>
          <small>{props.role}</small>
          <h3>{props.name}</h3>
        </div>
        <button type="button" className="sv-exit" onClick={toggleFull}>✕ Close <kbd>esc</kbd></button>
      </div>
    );
  }
  let fullLabel = "Open full screen";
  let fullIcon = "⤢";
  if (full) {
    fullLabel = "Close full screen";
    fullIcon = "✕";
  }

  return (
    <div className={wrapCls} id={hostId + "-wrap"}>
      <div className="sv-view">
        <div className="sv-stage" id={hostId} />
        <svg className="sv-lines" aria-hidden="true">
          <line id={hostId + "-line"} />
          <circle id={hostId + "-dot"} r="4" />
        </svg>
        <div className="sv-callout" id={hostId + "-label"}>{calloutText}</div>
        {Array.from({ length: MAX_MARKS }).map((_, i) => (
          <span key={i} className="sv-mark" id={hostId + "-m" + i}>{i + 1}</span>
        ))}
        <div className="sv-bar">
          <button type="button" className={apartCls} onClick={() => setApart(!apart)} aria-pressed={apart}>Take apart</button>
          <button type="button" className={insideCls} onClick={toggleInside} aria-pressed={inside}>Inside {sensorName}</button>
          <span className="sv-sep" />
          <button type="button" onClick={() => api && api.reset()} title="Reset view" aria-label="Reset view">⟲</button>
          <button type="button" onClick={toggleFull} title={fullLabel} aria-label={fullLabel}>{fullIcon}</button>
        </div>
      </div>
      <div className="sv-side">
        {fullHead}
        <div className="sv-cap">Parts</div>
        <div className="sv-parts">
          {parts.filter((p) => p.id !== "bus").map((p) => {
            let cls = "sv-part";
            if (p.id === picked) {
              cls = "sv-part on";
            }
            if (p.main) {
              cls = cls + " key";
            }
            return (
              <button type="button" key={p.id} className={cls} onClick={() => pickPart(p.id)} aria-pressed={p.id === picked}>
                {p.name.split(" ·")[0]}
              </button>
            );
          })}
        </div>
        {detail}
      </div>
    </div>
  );
}
