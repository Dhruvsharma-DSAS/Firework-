import { useEffect, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { buildAqua, buildSuomiNPP, buildTerra, buildNOAA21 } from "../lib/satModels.js";

const R = 10;
const FLEET = [
  { id: "terra", build: () => buildTerra(), raan: -0.9, phase: 0.6, color: 0xffb547 },
  { id: "aqua", build: () => buildAqua(), raan: 0.35, phase: 2.2, color: 0xffd27a },
  { id: "snpp", build: () => buildSuomiNPP(), raan: 1.25, phase: 3.9, color: 0x38e8ff },
  { id: "noaa20", build: () => buildSuomiNPP({ noaa20: true }), raan: 1.6, phase: 5.0, color: 0x7ff0ff },
  { id: "noaa21", build: () => buildNOAA21(), raan: 1.95, phase: 0.2, color: 0x9fd8ff },
];

function orbitPoint(raan, angle, radius) {
  const p = new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
  p.applyAxisAngle(new THREE.Vector3(0, 1, 0), raan);
  p.applyAxisAngle(new THREE.Vector3(1, 0, 0), 0.14);
  return p;
}

function satRig(def) {
  const rig = def.build();
  rig.update(0, 0, 0);
  const box = new THREE.Box3().setFromObject(rig.root);
  const size = box.getSize(new THREE.Vector3()).length();
  rig.root.position.sub(box.getCenter(new THREE.Vector3()));
  const holder = new THREE.Group();
  holder.add(rig.root);
  holder.scale.setScalar(1.6 / size);
  return holder;
}

export default function FleetView(props) {
  const [api, setApi] = useState(null);

  useEffect(() => {
    const host = document.getElementById("fleet-host");
    if (!host) {
      return undefined;
    }
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.5;
    const sun = new THREE.DirectionalLight(0xfff3e0, 2.2);
    sun.position.set(30, 18, 24);
    scene.add(sun);
    scene.add(new THREE.AmbientLight(0x50607a, 0.6));
    const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 2000);
    camera.position.set(0, 9, 42);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.minDistance = 4;
    controls.maxDistance = 90;
    const earth = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 64), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 }));
    new THREE.TextureLoader().load("/textures/earth-blue-marble.jpg", (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      earth.material.map = t;
      earth.material.needsUpdate = true;
    });
    scene.add(earth);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(R * 1.03, 64, 48), new THREE.MeshBasicMaterial({ color: 0x4fb8ff, transparent: true, opacity: 0.12, side: THREE.BackSide }));
    scene.add(glow);
    const stars = new THREE.BufferGeometry();
    const pts = [];
    for (let i = 0; i < 2500; i = i + 1) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(600 + Math.random() * 300);
      pts.push(v.x, v.y, v.z);
    }
    stars.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    scene.add(new THREE.Points(stars, new THREE.PointsMaterial({ color: 0xbfd2f0, size: 1, sizeAttenuation: false })));
    const items = FLEET.map((def, i) => {
      const radius = R * (1.28 + i * 0.05);
      const ring = [];
      for (let a = 0; a <= 128; a = a + 1) {
        ring.push(orbitPoint(def.raan, (a / 128) * Math.PI * 2, radius));
      }
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ring), new THREE.LineBasicMaterial({ color: def.color, transparent: true, opacity: 0.35 }));
      scene.add(line);
      const model = satRig(def);
      scene.add(model);
      return { def, radius, line, model, angle: def.phase };
    });
    const state = { focus: "", fly: 0, from: new THREE.Vector3(), to: new THREE.Vector3(), tFrom: new THREE.Vector3(), tTo: new THREE.Vector3(), alive: true };
    function place(dt) {
      items.forEach((it) => {
        if (!state.focus) {
          it.angle = it.angle + dt * 0.06;
        }
        const p = orbitPoint(it.def.raan, it.angle, it.radius);
        it.model.position.copy(p);
        it.model.lookAt(0, 0, 0);
        let opacity = 0.35;
        if (state.focus === it.def.id) {
          opacity = 0.9;
        }
        it.line.material.opacity = opacity;
      });
    }
    function focus(id) {
      state.focus = id;
      state.from.copy(camera.position);
      state.tFrom.copy(controls.target);
      if (!id) {
        state.to.set(0, 9, 42);
        state.tTo.set(0, 0, 0);
      } else {
        const it = items.find((x) => x.def.id === id);
        const p = it.model.position.clone();
        const out = p.clone().normalize();
        state.to.copy(p).addScaledVector(out, 3.2).add(new THREE.Vector3(0, 1.2, 0));
        state.tTo.copy(p);
      }
      state.fly = 0.0001;
    }
    function size() {
      const w = host.clientWidth || 600;
      const h = host.clientHeight || 400;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    size();
    const observer = new ResizeObserver(size);
    observer.observe(host);
    let last = performance.now();
    let raf = 0;
    function tick(now) {
      if (!state.alive) {
        return;
      }
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      place(dt);
      earth.rotation.y = earth.rotation.y + dt * 0.01;
      if (state.fly > 0) {
        state.fly = Math.min(1, state.fly + dt / 1.4);
        const e = state.fly * state.fly * (3 - 2 * state.fly);
        camera.position.lerpVectors(state.from, state.to, e);
        controls.target.lerpVectors(state.tFrom, state.tTo, e);
        if (state.fly >= 1) {
          state.fly = 0;
        }
      }
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    setApi(() => ({ focus }));
    return () => {
      state.alive = false;
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  }, []);

  useEffect(() => {
    if (api) {
      api.focus(props.focus || "");
    }
  }, [api, props.focus]);

  return <div id="fleet-host" className="fleet-host" aria-label="3D view of the five fire satellites around Earth. Drag to turn, scroll to zoom." />;
}
