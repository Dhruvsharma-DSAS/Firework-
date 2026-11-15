import * as THREE from "three";

const CACHE = { mats: null };
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

function seeded(seed) {
  let s = seed;
  return function next() {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

function canvasTexture(size, draw, srgb, repeat) {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  draw(c.getContext("2d"), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) {
    t.colorSpace = THREE.SRGBColorSpace;
  }
  t.repeat.set(repeat, repeat);
  return t;
}

function drawCrinkle(g, s) {
  const rnd = seeded(11);
  g.fillStyle = "rgb(128,128,128)";
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < 1500; i = i + 1) {
    const x = rnd() * s;
    const y = rnd() * s;
    const r = 6 + rnd() * 30;
    const n = 3 + Math.floor(rnd() * 3);
    const v = Math.floor(70 + rnd() * 120);
    g.fillStyle = "rgba(" + v + "," + v + "," + v + ",0.55)";
    g.beginPath();
    for (let k = 0; k < n; k = k + 1) {
      const a = (k / n) * Math.PI * 2 + rnd() * 0.8;
      const px = x + Math.cos(a) * r * (0.5 + rnd());
      const py = y + Math.sin(a) * r * (0.5 + rnd());
      if (k === 0) {
        g.moveTo(px, py);
      } else {
        g.lineTo(px, py);
      }
    }
    g.closePath();
    g.fill();
  }
  g.strokeStyle = "rgba(40,40,40,0.35)";
  g.lineWidth = 1.2;
  for (let i = 0; i < 70; i = i + 1) {
    let x = rnd() * s;
    let y = rnd() * s;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 4; k = k + 1) {
      x = x + (rnd() - 0.5) * 90;
      y = y + (rnd() - 0.5) * 90;
      g.lineTo(x, y);
    }
    g.stroke();
  }
}

function drawCells(g, s) {
  g.fillStyle = "#0a0d14";
  g.fillRect(0, 0, s, s);
  const n = 8;
  const c = s / n;
  const gap = 3;
  for (let i = 0; i < n; i = i + 1) {
    for (let j = 0; j < n; j = j + 1) {
      const x = i * c + gap / 2;
      const y = j * c + gap / 2;
      const w = c - gap;
      const gr = g.createLinearGradient(x, y, x + w, y + w);
      gr.addColorStop(0, "#173c9e");
      gr.addColorStop(0.5, "#0e2c80");
      gr.addColorStop(1, "#1b48b8");
      g.fillStyle = gr;
      g.fillRect(x, y, w, w);
      g.strokeStyle = "rgba(190,200,220,0.2)";
      g.lineWidth = 0.6;
      for (let k = 1; k < 10; k = k + 1) {
        g.beginPath();
        g.moveTo(x, y + (k * w) / 10);
        g.lineTo(x + w, y + (k * w) / 10);
        g.stroke();
      }
      g.fillStyle = "rgba(214,219,228,0.75)";
      g.fillRect(x + w * 0.3, y, 1.4, w);
      g.fillRect(x + w * 0.7, y, 1.4, w);
    }
  }
}

function drawTiles(g, s) {
  g.fillStyle = "#8d96a1";
  g.fillRect(0, 0, s, s);
  const n = 8;
  const c = s / n;
  for (let i = 0; i < n; i = i + 1) {
    for (let j = 0; j < n; j = j + 1) {
      const gr = g.createLinearGradient(i * c, j * c, i * c + c, j * c + c);
      gr.addColorStop(0, "#f1f5f9");
      gr.addColorStop(1, "#d3dbe4");
      g.fillStyle = gr;
      g.fillRect(i * c + 1.5, j * c + 1.5, c - 3, c - 3);
    }
  }
}

function drawLouver(g, s) {
  const n = 10;
  const c = s / n;
  for (let i = 0; i < n; i = i + 1) {
    const gr = g.createLinearGradient(0, i * c, 0, i * c + c);
    gr.addColorStop(0, "#c3c9d0");
    gr.addColorStop(0.55, "#7d848d");
    gr.addColorStop(1, "#22262b");
    g.fillStyle = gr;
    g.fillRect(0, i * c, s, c);
  }
}

function materials() {
  if (CACHE.mats) {
    return CACHE.mats;
  }
  const crinkle = canvasTexture(512, drawCrinkle, false, 0.7);
  const cells = canvasTexture(512, drawCells, true, 1);
  const tiles = canvasTexture(256, drawTiles, true, 1.6);
  const louver = canvasTexture(128, drawLouver, true, 1.4);
  function std(o) {
    return new THREE.MeshStandardMaterial(o);
  }
  CACHE.mats = {
    gold: std({ color: 0xd9a843, metalness: 1, roughness: 0.5, roughnessMap: crinkle, bumpMap: crinkle, bumpScale: 2.4 }),
    goldDark: std({ color: 0xa9741f, metalness: 1, roughness: 0.52, roughnessMap: crinkle, bumpMap: crinkle, bumpScale: 2.4 }),
    silver: std({ color: 0xd9dee4, metalness: 1, roughness: 0.46, roughnessMap: crinkle, bumpMap: crinkle, bumpScale: 2.2 }),
    black: std({ color: 0x17191d, metalness: 0.35, roughness: 0.62, bumpMap: crinkle, bumpScale: 1.6 }),
    alu: std({ color: 0xb9bec5, metalness: 1, roughness: 0.34 }),
    aluDark: std({ color: 0x5f656e, metalness: 0.9, roughness: 0.42 }),
    fitting: std({ color: 0xcf9b3c, metalness: 1, roughness: 0.24 }),
    white: std({ color: 0xe7ebef, metalness: 0, roughness: 0.55 }),
    radiator: std({ map: tiles, metalness: 0.55, roughness: 0.14 }),
    louver: std({ map: louver, metalness: 0.8, roughness: 0.3 }),
    solar: new THREE.MeshPhysicalMaterial({ map: cells, metalness: 0.3, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.06 }),
    solarBack: std({ color: 0x30343b, metalness: 0.5, roughness: 0.6 }),
    lens: new THREE.MeshPhysicalMaterial({ color: 0x0c1018, metalness: 0.2, roughness: 0.04, clearcoat: 1, iridescence: 1, iridescenceIOR: 1.6, iridescenceThicknessRange: [180, 620] }),
    cavity: std({ color: 0x050607, metalness: 0, roughness: 1 }),
    mirror: std({ color: 0xeef3fa, metalness: 1, roughness: 0.05 }),
    cable: std({ color: 0x3b5b8c, metalness: 0.1, roughness: 0.55 }),
    fpa: std({ color: 0xe0b354, metalness: 1, roughness: 0.18 }),
    board: std({ color: 0x1d5a3c, metalness: 0.2, roughness: 0.6 }),
  };
  return CACHE.mats;
}

function worldUV(geo) {
  const p = geo.attributes.position;
  const n = geo.attributes.normal;
  const uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i = i + 1) {
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    const az = Math.abs(n.getZ(i));
    let u = p.getX(i);
    let v = p.getY(i);
    if (ax >= ay && ax >= az) {
      u = p.getZ(i);
      v = p.getY(i);
    } else if (ay >= az) {
      u = p.getX(i);
      v = p.getZ(i);
    }
    uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;
  return geo;
}

function rot(m, x, y, z) {
  m.rotation.set(x, y, z);
  return m;
}

function place(m, x, y, z) {
  m.position.set(x || 0, y || 0, z || 0);
  return m;
}

function box(w, h, d, mat, x, y, z) {
  return place(new THREE.Mesh(worldUV(new THREE.BoxGeometry(w, h, d)), mat), x, y, z);
}

function cyl(rt, rb, h, mat, x, y, z, seg, open) {
  return place(new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 28, 1, Boolean(open)), mat), x, y, z);
}

function ball(r, mat, x, y, z) {
  return place(new THREE.Mesh(new THREE.SphereGeometry(r, 32, 20), mat), x, y, z);
}

function strut(a, b, r, mat) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), mat);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(Y_AXIS, dir.normalize());
  return m;
}

function v3(x, y, z) {
  return new THREE.Vector3(x, y, z);
}

function cable(points, r, mat) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => v3(p[0], p[1], p[2])));
  return new THREE.Mesh(new THREE.TubeGeometry(curve, 32, r, 6), mat);
}

function dish(radius, depth, mat) {
  const pts = [];
  for (let i = 0; i <= 24; i = i + 1) {
    const r = (radius * i) / 24;
    pts.push(new THREE.Vector2(r, depth * (r / radius) * (r / radius)));
  }
  const geo = new THREE.LatheGeometry(pts, 48);
  return new THREE.Mesh(geo, mat);
}

function frameBars(group, w, h, d, t, mat, cx, cy, cz) {
  [-1, 1].forEach((a) => {
    [-1, 1].forEach((b) => {
      group.add(box(w + t, t, t, mat, cx, cy + (a * h) / 2, cz + (b * d) / 2));
      group.add(box(t, h + t, t, mat, cx + (a * w) / 2, cy, cz + (b * d) / 2));
      group.add(box(t, t, d + t, mat, cx + (a * w) / 2, cy + (b * h) / 2, cz));
    });
  });
}

function solarPanel(group, w, d, M, x, y, z) {
  const back = M.solarBack;
  group.add(place(new THREE.Mesh(worldUV(new THREE.BoxGeometry(w, 0.035, d)), [back, back, M.solar, back, back, back]), x, y, z));
  group.add(box(w + 0.04, 0.05, 0.04, M.fitting, x, y, z - d / 2));
  group.add(box(w + 0.04, 0.05, 0.04, M.fitting, x, y, z + d / 2));
  group.add(box(0.04, 0.05, d, M.fitting, x - w / 2, y, z));
  group.add(box(0.04, 0.05, d, M.fitting, x + w / 2, y, z));
  [-0.3, 0.3].forEach((fx) => {
    [-0.3, 0.3].forEach((fz) => {
      group.add(box(0.09, 0.05, 0.09, M.fitting, x + fx * w, y + 0.01, z + fz * d));
    });
  });
}

function cooler(group, M, x, y, z, r, steps) {
  for (let i = 0; i < steps; i = i + 1) {
    const rb = r * (1 - i * 0.22);
    const rt = rb * 1.18;
    const f = cyl(rt, rb, 0.13, M.mirror, 0, 0, 0, 4, true);
    f.material = M.mirror;
    f.rotation.y = Math.PI / 4;
    const holder = new THREE.Group();
    holder.add(f);
    const rim = cyl(rt * 1.02, rt * 1.02, 0.02, M.fitting, 0, 0.07, 0, 4, true);
    rim.rotation.y = Math.PI / 4;
    holder.add(rim);
    holder.rotation.x = -Math.PI / 2;
    holder.position.set(x, y, z - 0.065 - i * 0.12);
    group.add(holder);
  }
  const back = box(r * 1.5, r * 1.5, 0.03, M.cavity, x, y, z - 0.01);
  group.add(back);
}

function aperture(group, M, r, x, y, z) {
  group.add(cyl(r, r, 0.1, M.cavity, x, y, z));
  group.add(cyl(r * 1.12, r * 1.12, 0.025, M.alu, x, y - 0.05, z, 28, true));
}

function beam(points, color) {
  const mat = new THREE.LineBasicMaterial({ color: color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map((p) => v3(p[0], p[1], p[2]))), mat);
  return { line: line, mat: mat };
}

function newRig() {
  return { root: new THREE.Group(), parts: [], shells: [], beams: [], spinners: [], reveal: 0 };
}

function addPart(rig, spec) {
  const g = new THREE.Group();
  rig.root.add(g);
  rig.parts.push({
    id: spec.id,
    name: spec.name,
    line: spec.line,
    main: Boolean(spec.main),
    color: spec.color || "#c9d3df",
    group: g,
    dir: v3(spec.dir[0], spec.dir[1], spec.dir[2]),
    delay: spec.delay,
    anchor: v3(spec.anchor[0], spec.anchor[1], spec.anchor[2]),
    base: new THREE.Vector3(),
    sub: (spec.sub || []).map((s) => ({ name: s[0], line: s[1], anchor: v3(s[2][0], s[2][1], s[2][2]) })),
    k: 0,
  });
  return g;
}

function shellOf(rig, mat) {
  const m = mat.clone();
  rig.shells.push(m);
  return m;
}

function busShell(group, M, L, H, W, faces) {
  group.add(box(L, 0.04, W, faces.top, 0, H / 2, 0));
  group.add(box(L, 0.04, W, faces.bottom, 0, -H / 2, 0));
  group.add(box(0.04, H, W, faces.end, -L / 2, 0, 0));
  group.add(box(0.04, H, W, faces.end, L / 2, 0, 0));
  group.add(box(L, H, 0.04, faces.side, 0, 0, W / 2));
  group.add(box(L - 0.1, H - 0.1, 0.02, M.aluDark, 0, 0, W / 2 - 0.04));
  group.add(box(L - 0.1, 0.03, W - 0.1, M.aluDark, 0, 0.05, 0));
  frameBars(group, L, H, W, 0.07, M.alu, 0, 0, 0);
}

function sidePanel(group, M, L, H, W, skin) {
  const z = -W / 2;
  group.add(box(L - 0.06, H - 0.06, 0.04, skin, 0, 0, z));
  group.add(box(L * 0.34, H * 0.52, 0.02, M.radiator, -L * 0.2, H * 0.08, z - 0.03));
  group.add(box(L * 0.14, H * 0.3, 0.02, M.louver, L * 0.28, H * 0.12, z - 0.03));
  group.add(box(L * 0.2, H * 0.18, 0.02, M.silver, L * 0.16, -H * 0.3, z - 0.03));
  for (let i = 0; i < 6; i = i + 1) {
    group.add(box(0.05, 0.05, 0.03, M.fitting, -L * 0.42 + i * L * 0.168, H * 0.44, z - 0.035));
    group.add(box(0.05, 0.05, 0.03, M.fitting, -L * 0.42 + i * L * 0.168, -H * 0.44, z - 0.035));
  }
}

function avionics(group, M, L, H, W) {
  const n = Math.max(3, Math.round(L / 1.3));
  const span = L * 0.72;
  for (let i = 0; i < n; i = i + 1) {
    const x = -span / 2 + (i * span) / (n - 1);
    group.add(box(0.7, H * 0.18, 0.42, M.aluDark, x, H * 0.27, -W * 0.22));
    group.add(box(0.5, H * 0.1, 0.02, M.board, x, H * 0.27, -W * 0.22 - 0.22));
    group.add(box(0.12, 0.06, 0.05, M.fitting, x - 0.18, H * 0.33, -W * 0.22 - 0.235));
    group.add(box(0.12, 0.06, 0.05, M.fitting, x + 0.18, H * 0.33, -W * 0.22 - 0.235));
  }
  group.add(box(0.9, H * 0.22, 0.45, M.alu, L * 0.3, -H * 0.05, -W * 0.18));
  for (let i = 0; i < 5; i = i + 1) {
    group.add(cyl(0.07, 0.07, H * 0.21, M.white, L * 0.3 - 0.32 + i * 0.16, -H * 0.05, -W * 0.18 - 0.24));
  }
  for (let i = 0; i < 4; i = i + 1) {
    const w = cyl(0.2, 0.2, 0.1, M.aluDark, -L * 0.3 + (i % 2) * 0.5, -H * 0.12 + Math.floor(i / 2) * 0.3, -W * 0.2);
    w.rotation.x = Math.PI / 2;
    group.add(w);
    const hub = cyl(0.06, 0.06, 0.12, M.fitting, -L * 0.3 + (i % 2) * 0.5, -H * 0.12 + Math.floor(i / 2) * 0.3, -W * 0.2);
    hub.rotation.x = Math.PI / 2;
    group.add(hub);
  }
}

function propulsion(group, M, x, y, z, r, thrusters) {
  group.add(ball(r, M.alu, x, y, z));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.01, 0.025, 8, 48), M.fitting);
  ring.position.set(x, y, z);
  ring.rotation.x = Math.PI / 2;
  group.add(ring);
  thrusters.forEach((t) => {
    const n = cyl(0.04, 0.09, 0.18, M.aluDark, t[0], t[1], t[2], 18, true);
    n.rotation.x = Math.PI;
    group.add(n);
    group.add(cyl(0.05, 0.05, 0.08, M.fitting, t[0], t[1] + 0.12, t[2]));
    group.add(cable([[x, y - r, z], [(x + t[0]) / 2, y - r - 0.1, (z + t[2]) / 2], [t[0], t[1] + 0.16, t[2]]], 0.015, M.alu));
  });
}

function ceres(rig, group, M, x, y, z, phase) {
  group.add(cyl(0.2, 0.22, 0.14, M.alu, x, y - 0.07, z));
  const az = new THREE.Group();
  az.position.set(x, y - 0.14, z);
  group.add(az);
  az.add(box(0.34, 0.06, 0.34, M.aluDark, 0, -0.03, 0));
  const el = new THREE.Group();
  el.position.set(0, -0.24, 0);
  az.add(el);
  el.add(box(0.3, 0.34, 0.26, M.gold, 0, 0, 0));
  const hood = cyl(0.13, 0.13, 0.3, M.goldDark, 0, 0.0, 0, 28);
  hood.rotation.x = Math.PI / 2;
  el.add(hood);
  const eye = cyl(0.06, 0.06, 0.06, M.lens, 0, -0.17, 0.02);
  el.add(eye);
  rig.spinners.push({ obj: az, axis: "y", speed: 0.35, mode: "spin", phase: phase });
  rig.spinners.push({ obj: el, axis: "x", speed: 0.95, mode: "osc", amp: 0.7, phase: phase });
}

function antennaHat(group, M, x, y, z, down) {
  let s = 1;
  if (down) {
    s = -1;
  }
  group.add(cyl(0.025, 0.025, 0.3, M.alu, x, y + s * 0.15, z));
  group.add(cyl(0.13, 0.02, 0.05, M.white, x, y + s * 0.32, z));
}

function starTracker(group, M, x, y, z, tiltX, tiltZ) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.set(tiltX, 0, tiltZ);
  g.add(box(0.2, 0.16, 0.2, M.black, 0, 0.08, 0));
  g.add(cyl(0.09, 0.09, 0.14, M.aluDark, 0, 0.23, 0));
  g.add(cyl(0.17, 0.1, 0.24, M.black, 0, 0.42, 0, 28, true));
  g.add(cyl(0.07, 0.07, 0.02, M.lens, 0, 0.31, 0));
  group.add(g);
}

function fpaRow(group, M, x, y, z, tints, along) {
  tints.forEach((tint, i) => {
    const px = x + along[0] * i;
    const pz = z + along[1] * i;
    group.add(box(0.13, 0.13, 0.08, M.fpa, px, y, pz));
    group.add(box(0.08, 0.08, 0.01, new THREE.MeshBasicMaterial({ color: tint }), px, y, pz - 0.046));
    group.add(cable([[px, y + 0.06, pz], [px, y + 0.18, pz + 0.05], [px + 0.1, y + 0.24, pz + 0.12]], 0.012, M.cable));
  });
}

function modisPart(rig, M, mx, my, mz, bot) {
  const mw = 1.05;
  const mh = 0.95;
  const md = 1.5;
  const modis = addPart(rig, {
    id: "modis",
    main: true,
    color: "#ffb547",
    name: "MODIS · Moderate Resolution Imaging Spectroradiometer",
    line: "36 bands · 2,330 km swath · fire bands 21/22 (4 µm) and 31 (11 µm) at 1 km",
    dir: [0, -2.5, -0.9],
    delay: 0.08,
    anchor: [mx + mw / 2, my - mh / 2, mz - md / 2],
    sub: [
      ["Scan mirror", "Light from the ground enters through the nadir slot and hits a double-sided mirror spinning at 20.3 rpm. Each turn sweeps a 2,330 km line across track.", [mx, my - 0.2, mz]],
      ["Telescope", "An off-axis afocal telescope with a 17.8 cm aperture gathers the light and passes it on as a parallel beam.", [mx + 0.32, my + 0.2, mz + 0.22]],
      ["Focal planes ×4", "Filters split the beam onto four detector arrays — VIS, NIR, SWIR/MWIR, LWIR — for 36 bands. Fire uses the 4 µm bands 21/22 and the 11 µm band 31.", [mx - 0.34, my + 0.12, mz + 0.45]],
      ["Radiative cooler", "A passive cooler facing cold space keeps the infrared detectors near 83 K, so a hot pixel stands out from the background.", [mx - 0.1, my - 0.05, mz - md / 2 - 0.3]],
      ["Blackbody", "Every scan also looks at an on-board blackbody of known temperature, so each pixel's brightness can be turned into a true temperature.", [mx + 0.38, my - 0.1, mz - 0.42]],
    ],
  });
  const ms = shellOf(rig, M.silver);
  const mb = shellOf(rig, M.black);
  modis.add(box(mw, mh, md, ms, mx, my, mz));
  modis.add(box(mw * 0.45, mh * 0.95, md * 1.005, mb, mx + mw * 0.26, my, mz));
  frameBars(modis, mw, mh, md, 0.04, M.alu, mx, my, mz);
  [-1, 1].forEach((a) => {
    [-1, 1].forEach((b) => {
      modis.add(cyl(0.05, 0.07, 0.08, M.fitting, mx + a * 0.4, my + mh / 2 + 0.04, mz + b * 0.6));
    });
  });
  modis.add(box(0.62, 0.02, 1.15, M.cavity, mx, my - mh / 2 - 0.012, mz));
  const door = box(0.62, 0.025, 0.42, M.black, mx, my - mh / 2 - 0.16, mz + 0.75);
  door.rotation.x = 0.9;
  modis.add(door);
  modis.add(box(0.4, 0.3, 0.02, M.white, mx + mw / 2 + 0.012, my + 0.1, mz + 0.35));
  cooler(modis, M, mx - 0.1, my - 0.05, mz - md / 2, 0.32, 3);
  const mirrorPivot = new THREE.Group();
  mirrorPivot.position.set(mx, my - 0.2, mz);
  mirrorPivot.add(box(0.5, 0.02, 0.36, M.mirror, 0, 0, 0));
  mirrorPivot.add(rot(cyl(0.03, 0.03, 0.6, M.fitting, 0, 0, 0), 0, 0, Math.PI / 2));
  modis.add(mirrorPivot);
  rig.spinners.push({ obj: mirrorPivot, axis: "x", speed: 2.13, mode: "spin", phase: 0 });
  const prim = dish(0.2, 0.06, M.mirror);
  prim.position.set(mx + 0.32, my + 0.2, mz + 0.22);
  prim.rotation.z = Math.PI / 2;
  modis.add(prim);
  const sec = dish(0.07, 0.025, M.mirror);
  sec.position.set(mx - 0.05, my + 0.2, mz + 0.22);
  sec.rotation.z = -Math.PI / 2;
  modis.add(sec);
  fpaRow(modis, M, mx - 0.34, my + 0.12, mz + 0.62, [0x4f7dff, 0x8a5cff, 0xffa53d, 0xff4d5e], [0, -0.17]);
  for (let i = 0; i < 6; i = i + 1) {
    modis.add(box(0.02, 0.26, 0.3, M.cavity, mx + 0.32 + i * 0.03, my - 0.1, mz - 0.42));
  }
  modis.add(box(0.3, 0.25, 0.02, M.board, mx + 0.1, my + 0.25, mz - 0.55));
  modis.add(box(0.3, 0.25, 0.02, M.board, mx + 0.1, my + 0.25, mz - 0.6));
  const mbeam = beam([[mx, my - 1.4, mz], [mx, my - 0.2, mz], [mx + 0.3, my + 0.2, mz + 0.22], [mx - 0.05, my + 0.2, mz + 0.22], [mx - 0.34, my + 0.12, mz + 0.45]], 0xffb547);
  modis.add(mbeam.line);
  rig.beams.push(mbeam.mat);
  modis.add(cable([[mx + 0.3, my + mh / 2, mz - 0.6], [mx + 0.6, bot - 0.05, mz - 0.7], [mx + 1.2, bot - 0.04, -0.9]], 0.022, M.cable));
  return modis;
}

function viirsPart(rig, M, vx, vy, vz, bot) {
  const vw = 1.3;
  const vh = 0.85;
  const vd = 1.15;
  const viirs = addPart(rig, {
    id: "viirs",
    main: true,
    color: "#3dd6f5",
    name: "VIIRS · Visible Infrared Imaging Radiometer Suite",
    line: "22 bands · 3,040 km swath · fire bands I4 (3.74 µm) and I5 (11.45 µm) at 375 m",
    dir: [-0.2, -2.3, -1.0],
    delay: 0.08,
    anchor: [vx - vw / 2, vy - vh / 2, vz - vd / 2],
    sub: [
      ["Rotating telescope", "Instead of a flat mirror, the whole telescope spins: one turn every 1.78 s sweeps a 3,040 km line across track.", [vx, vy - 0.55, vz - 0.25]],
      ["Half-angle mirror", "A mirror spinning at exactly half speed cancels the image rotation, so the light lands steady on the detectors.", [vx + 0.25, vy - 0.05, vz + 0.1]],
      ["Focal planes", "Three focal planes — VisNIR, S/MWIR and LWIR — read 22 bands. Fire uses I4 (3.74 µm) and I5 (11.45 µm) at 375 m.", [vx - 0.4, vy + 0.15, vz + 0.4]],
      ["Cryoradiator", "A stepped passive cooler pointed at cold space holds the infrared detectors near 80 K.", [vx + 0.1, vy, vz - vd / 2 - 0.35]],
      ["Blackbody · solar diffuser", "Each scan views a blackbody and a solar diffuser, so every pixel is calibrated to temperature and reflectance.", [vx + 0.55, vy - 0.1, vz + 0.35]],
    ],
  });
  const vs = shellOf(rig, M.silver);
  const vb = shellOf(rig, M.black);
  viirs.add(box(vw, vh, vd, vs, vx, vy, vz));
  viirs.add(box(vw * 0.35, vh * 0.96, vd * 1.004, vb, vx - vw * 0.32, vy, vz));
  frameBars(viirs, vw, vh, vd, 0.04, M.alu, vx, vy, vz);
  [-1, 1].forEach((a) => {
    [-1, 1].forEach((b) => {
      viirs.add(cyl(0.05, 0.07, 0.08, M.fitting, vx + a * 0.5, vy + vh / 2 + 0.04, vz + b * 0.45));
    });
  });
  const rta = new THREE.Group();
  rta.position.set(vx, vy - 0.5, vz - 0.25);
  const drum = cyl(0.3, 0.3, 0.6, M.black, 0, 0, 0, 40);
  drum.rotation.z = Math.PI / 2;
  rta.add(drum);
  rta.add(box(0.45, 0.04, 0.16, M.cavity, 0, -0.29, 0));
  rta.add(rot(cyl(0.31, 0.31, 0.03, M.alu, 0.3, 0, 0, 40), 0, 0, Math.PI / 2));
  rta.add(rot(cyl(0.31, 0.31, 0.03, M.alu, -0.3, 0, 0, 40), 0, 0, Math.PI / 2));
  viirs.add(rta);
  rig.spinners.push({ obj: rta, axis: "x", speed: 3.53, mode: "spin", phase: 0 });
  const hoodHalf = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.66, 40, 1, true, 0, Math.PI), M.black);
  hoodHalf.position.set(vx, vy - 0.5, vz - 0.25);
  hoodHalf.rotation.set(0, 0, Math.PI / 2);
  viirs.add(hoodHalf);
  cooler(viirs, M, vx + 0.1, vy, vz - vd / 2, 0.38, 3);
  const ham = new THREE.Group();
  ham.position.set(vx + 0.25, vy - 0.05, vz + 0.1);
  ham.add(box(0.26, 0.02, 0.22, M.mirror, 0, 0, 0));
  ham.add(rot(cyl(0.025, 0.025, 0.34, M.fitting, 0, 0, 0), 0, 0, Math.PI / 2));
  viirs.add(ham);
  rig.spinners.push({ obj: ham, axis: "x", speed: 1.765, mode: "spin", phase: 0 });
  const aft1 = dish(0.14, 0.04, M.mirror);
  aft1.position.set(vx + 0.05, vy + 0.2, vz + 0.3);
  aft1.rotation.z = -Math.PI / 2;
  viirs.add(aft1);
  const aft2 = dish(0.1, 0.03, M.mirror);
  aft2.position.set(vx - 0.2, vy + 0.25, vz + 0.12);
  aft2.rotation.z = Math.PI / 2;
  viirs.add(aft2);
  fpaRow(viirs, M, vx - 0.4, vy + 0.15, vz + 0.55, [0x4f7dff, 0xffa53d, 0xff4d5e], [0, -0.18]);
  viirs.add(box(0.02, 0.3, 0.3, M.white, vx + 0.55, vy - 0.1, vz + 0.35));
  for (let i = 0; i < 5; i = i + 1) {
    viirs.add(box(0.2, 0.02, 0.24, M.cavity, vx + 0.45, vy - 0.3 + i * 0.035, vz - 0.35));
  }
  viirs.add(box(0.36, 0.26, 0.02, M.board, vx - 0.05, vy + 0.22, vz - 0.45));
  const vbeam = beam([[vx, vy - 1.6, vz - 0.25], [vx, vy - 0.5, vz - 0.25], [vx + 0.25, vy - 0.05, vz + 0.1], [vx + 0.05, vy + 0.2, vz + 0.3], [vx - 0.2, vy + 0.25, vz + 0.12], [vx - 0.4, vy + 0.15, vz + 0.4]], 0x3dd6f5);
  viirs.add(vbeam.line);
  rig.beams.push(vbeam.mat);
  viirs.add(cable([[vx + 0.4, vy + vh / 2, vz + 0.5], [vx + 0.8, bot - 0.04, vz + 0.6], [0.1, bot - 0.04, 0.0]], 0.02, M.cable));
  return viirs;
}

function atmsCrisPart(rig, M, ox, oy, oz) {
  const base = new THREE.Vector3(ox, oy, oz);
  const atms = addPart(rig, { id: "atms", name: "ATMS · Advanced Technology Microwave Sounder", line: "22 microwave channels · temperature and moisture through cloud", dir: [1.4, -1.4, 0.9], delay: 0.18, anchor: [1.0, -1.75, 0.85] });
  atms.add(box(0.75, 0.6, 0.7, M.gold, 0.62, -1.27, 0.45));
  frameBars(atms, 0.75, 0.6, 0.7, 0.03, M.alu, 0.62, -1.27, 0.45);
  [0.42, 0.82].forEach((x, i) => {
    const d = new THREE.Group();
    d.position.set(x, -1.66, 0.45);
    const c = cyl(0.16, 0.16, 0.3, M.alu, 0, 0, 0, 32);
    c.rotation.z = Math.PI / 2;
    d.add(c);
    d.add(box(0.24, 0.03, 0.16, M.cavity, 0, -0.155, 0));
    atms.add(d);
    rig.spinners.push({ obj: d, axis: "x", speed: 2.35, mode: "spin", phase: i * 1.3 });
  });

  const cris = addPart(rig, { id: "cris", name: "CrIS · Cross-track Infrared Sounder", line: "Michelson interferometer · 1,305 infrared channels", dir: [1.5, -1.5, -0.9], delay: 0.21, anchor: [1.0, -1.7, -0.85] });
  cris.add(box(0.8, 0.74, 0.72, M.silver, 0.6, -1.32, -0.45));
  frameBars(cris, 0.8, 0.74, 0.72, 0.03, M.alu, 0.6, -1.32, -0.45);
  aperture(cris, M, 0.16, 0.6, -1.72, -0.45);
  cris.add(cyl(0.12, 0.12, 0.02, M.lens, 0.6, -1.75, -0.45));
  cooler(cris, M, 0.75, -1.3, -0.81, 0.2, 2);
  atms.position.add(base);
  cris.position.add(base);
  return [atms, cris];
}

export function buildAqua() {
  const M = materials();
  const rig = newRig();
  const L = 6.4;
  const H = 2.5;
  const W = 2.6;
  const top = H / 2;
  const bot = -H / 2;

  const bus = addPart(rig, { id: "bus", name: "Spacecraft bus · TRW T330", line: "Structure, power, data handling and pointing for six instruments", dir: [0, 0, 0], delay: 0, anchor: [-2.9, top, 0.9] });
  busShell(bus, M, L, H, W, { top: M.black, bottom: M.silver, end: M.gold, side: M.gold });
  bus.add(box(L * 0.55, 0.02, W * 0.6, M.radiator, 0.4, top + 0.025, 0.15));
  bus.add(box(0.02, H * 0.55, W * 0.5, M.louver, -L / 2 - 0.025, 0.15, 0));
  bus.add(box(0.02, H * 0.6, W * 0.55, M.radiator, L / 2 + 0.025, 0.1, 0));

  const skin = addPart(rig, { id: "skin", name: "Thermal skin · multi-layer insulation", line: "Crinkled gold MLI and mirror-tile radiators keep the electronics near room temperature", dir: [-1.2, 2.6, -1.3], delay: 0.04, anchor: [1.9, 0.75, -W / 2 - 0.04] });
  sidePanel(skin, M, L, H, W, M.gold);

  const av = addPart(rig, { id: "avionics", name: "Avionics · computer, battery, wheels", line: "Command & data handling, power regulation, battery and reaction wheels", dir: [0, 0, -1.55], delay: 0.3, anchor: [1.0, H * 0.36, -W * 0.22 - 0.22] });
  avionics(av, M, L, H, W);

  const prop = addPart(rig, { id: "prop", name: "Propulsion · hydrazine", line: "Tank and thrusters for orbit control — fuel is nearly spent, so Aqua now drifts", dir: [0, -0.1, -2.4], delay: 0.38, anchor: [-0.6, -0.05, 0.25] });
  propulsion(prop, M, -0.6, -0.55, 0.3, 0.5, [[-3.1, bot + 0.05, 1.05], [-3.1, bot + 0.05, -1.05]]);

  modisPart(rig, M, -1.6, -1.76, -0.25, bot);

  const am = addPart(rig, { id: "amsre", name: "AMSR-E · JAXA microwave radiometer", line: "1.6 m reflector spun at 40 rpm until 2011 · sea ice, rain, soil moisture", dir: [0.5, 2.3, 0.4], delay: 0.14, anchor: [3.3, 2.9, 0] });
  const amG = new THREE.Group();
  amG.position.set(2.25, top, 0);
  am.add(amG);
  amG.add(cyl(0.6, 0.62, 0.55, M.gold, 0, 0.3, 0));
  amG.add(cyl(0.63, 0.63, 0.04, M.alu, 0, 0.58, 0));
  amG.add(cyl(0.64, 0.64, 0.04, M.alu, 0, 0.04, 0));
  const feedDir = v3(0.35, 0.94, 0).normalize();
  for (let i = 0; i < 6; i = i + 1) {
    const hx = -0.12 + (i % 3) * 0.12;
    const hz = -0.07 + Math.floor(i / 3) * 0.14;
    const h = cyl(0.05, 0.03, 0.22, M.alu, hx, 0.7, hz, 16, true);
    h.quaternion.setFromUnitVectors(Y_AXIS, feedDir);
    amG.add(h);
  }
  const dishPos = v3(0.55, 1.45, 0);
  const phi = 2.57;
  const dg = new THREE.Group();
  dg.position.copy(dishPos);
  dg.rotation.z = phi;
  const reflector = dish(0.8, 0.26, new THREE.MeshStandardMaterial({ color: 0xe9ecef, metalness: 0.1, roughness: 0.45, side: THREE.DoubleSide }));
  dg.add(reflector);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.025, 8, 64), M.alu);
  rim.position.y = 0.26;
  rim.rotation.x = Math.PI / 2;
  dg.add(rim);
  amG.add(dg);
  function rimPoint(a) {
    return v3(0.8 * Math.cos(a), 0.26, 0.8 * Math.sin(a)).applyAxisAngle(Z_AXIS, phi).add(dishPos);
  }
  amG.add(strut(v3(0.4, 0.58, 0.3), rimPoint(Math.PI), 0.03, M.alu));
  amG.add(strut(v3(0.4, 0.58, -0.3), rimPoint(Math.PI), 0.03, M.alu));
  amG.add(strut(v3(-0.2, 0.58, 0.42), rimPoint(Math.PI / 2), 0.03, M.alu));
  amG.add(strut(v3(-0.2, 0.58, -0.42), rimPoint(-Math.PI / 2), 0.03, M.alu));

  const airs = addPart(rig, { id: "airs", name: "AIRS · Atmospheric Infrared Sounder", line: "2,378 infrared channels · temperature and humidity profiles", dir: [0.2, -1.8, -1.0], delay: 0.18, anchor: [0.85, -2.05, -1.0] });
  airs.add(box(1.1, 0.8, 1.2, M.gold, 0.3, -1.66, -0.4));
  frameBars(airs, 1.1, 0.8, 1.2, 0.035, M.alu, 0.3, -1.66, -0.4);
  const airsScan = cyl(0.17, 0.17, 0.55, M.black, 0.3, -2.1, -0.4);
  airsScan.rotation.z = Math.PI / 2;
  airs.add(airsScan);
  airs.add(box(0.42, 0.02, 0.14, M.cavity, 0.3, -2.27, -0.4));
  const airsRad = box(0.8, 0.02, 0.7, M.radiator, 0.3, -1.4, -1.25);
  airsRad.rotation.x = -0.5;
  airs.add(airsRad);

  const a1 = addPart(rig, { id: "amsua1", name: "AMSU-A1 · microwave sounder", line: "Channels 3–15 · temperature through cloud", dir: [1.7, -1.4, 0.2], delay: 0.21, anchor: [2.85, -2.0, 0.95] });
  a1.add(box(0.8, 0.75, 0.85, M.silver, 2.45, -1.63, 0.55));
  frameBars(a1, 0.8, 0.75, 0.85, 0.03, M.alu, 2.45, -1.63, 0.55);
  aperture(a1, M, 0.17, 2.3, -2.04, 0.4);
  aperture(a1, M, 0.17, 2.62, -2.04, 0.72);

  const a2 = addPart(rig, { id: "amsua2", name: "AMSU-A2 · HSB", line: "AMSU-A2 channels 1–2 · HSB humidity sounder from Brazil (failed 2003)", dir: [1.6, -1.2, -1.3], delay: 0.24, anchor: [2.85, -1.9, -0.9] });
  a2.add(box(0.75, 0.62, 0.7, M.gold, 2.45, -1.56, -0.5));
  frameBars(a2, 0.75, 0.62, 0.7, 0.03, M.alu, 2.45, -1.56, -0.5);
  aperture(a2, M, 0.24, 2.45, -1.9, -0.5);
  a2.add(box(0.45, 0.5, 0.5, M.silver, 1.5, -1.5, -0.95));
  aperture(a2, M, 0.13, 1.5, -1.8, -0.95);

  const ce = addPart(rig, { id: "ceres", name: "CERES FM3 · FM4", line: "Two broadband scanners for Earth's radiation budget", dir: [-1.9, -1.3, 0], delay: 0.27, anchor: [-2.75, -1.95, 0.75] });
  ceres(rig, ce, M, -2.75, bot, 0.75, 0);
  ceres(rig, ce, M, -2.75, bot, -0.75, 1.6);

  const sa = addPart(rig, { id: "solar", name: "Solar array", line: "One sun-tracking wing · charges the battery for the night half of each 99-min orbit", dir: [-0.5, 0.3, 2.3], delay: 0.31, anchor: [-2.6, 0.9, 7.0] });
  sa.add(strut(v3(-2.6, 0.6, W / 2), v3(-2.6, 0.6, 2.7), 0.06, M.alu));
  sa.add(rot(cyl(0.18, 0.18, 0.3, M.aluDark, -2.6, 0.6, W / 2 + 0.15), Math.PI / 2, 0, 0));
  const wing = new THREE.Group();
  wing.position.set(-2.6, 0.6, 0);
  wing.rotation.z = 0.45;
  sa.add(wing);
  for (let r = 0; r < 5; r = r + 1) {
    for (let c = 0; c < 2; c = c + 1) {
      solarPanel(wing, 1.45, 1.45, M, -0.75 + c * 1.5, 0, 3.5 + r * 1.52);
    }
    wing.add(box(3.05, 0.04, 0.06, M.alu, 0, -0.03, 2.74 + r * 1.52));
  }
  wing.add(box(0.07, 0.07, 7.7, M.alu, 0, -0.05, 6.5));

  const co = addPart(rig, { id: "comms", name: "Antennas · X-band and S-band", line: "Science downlink and direct broadcast to Earth · commands and telemetry", dir: [0.9, -1.3, -1.2], delay: 0.34, anchor: [3.0, -1.9, -1.0] });
  co.add(cyl(0.09, 0.02, 0.32, M.white, 3.0, bot - 0.22, -1.0));
  co.add(cyl(0.12, 0.12, 0.06, M.alu, 3.0, bot - 0.04, -1.0));
  antennaHat(co, M, -2.9, bot, -1.0, true);

  const at = addPart(rig, { id: "attitude", name: "Star trackers · GPS", line: "Measure pointing and position so every pixel is geolocated", dir: [0.2, 1.6, -0.9], delay: 0.36, anchor: [1.0, 1.95, -0.95] });
  starTracker(at, M, 1.0, top, -0.95, -0.35, 0.25);
  starTracker(at, M, 1.45, top, -0.95, -0.35, -0.25);
  antennaHat(at, M, -2.9, top, -1.0, false);
  at.add(cyl(0.09, 0.09, 0.05, M.white, -1.6, top + 0.05, 0.8));

  rig.info = {
    title: "Aqua",
    subtitle: "NASA Earth Observing System · carries MODIS",
    specs: [["Launched", "4 May 2002"], ["Orbit", "705 km · sun-synchronous"], ["Equator crossing", "~13:30 local, ascending"], ["Science end", "Sep 2027 (NASA plan)"]],
    insideTitle: "Inside MODIS",
    insideIntro: "How a fire reaches the detectors — follow the light, one step at a time.",
    outerImgs: [["/img/sheets/terra_xray.webp", "Terra exploded x-ray · Aqua's twin, same MODIS"]],
    innerImgs: [["/img/sheets/modis_cutaway.webp", "MODIS cutaway · aperture, scan mirror, telescope, detectors"]],
  };
  return finish(rig);
}

export function buildSuomiNPP(opts) {
  const noaa20 = Boolean(opts && opts.noaa20);
  const M = materials();
  const rig = newRig();
  const L = 3.0;
  const H = 1.9;
  const W = 1.8;
  const top = H / 2;
  const bot = -H / 2;

  const bus = addPart(rig, { id: "bus", name: "Spacecraft bus · Ball BCP-2000", line: "Structure, power, data handling and pointing", dir: [0, 0, 0], delay: 0, anchor: [-1.4, top, 0.6] });
  busShell(bus, M, L, H, W, { top: M.silver, bottom: M.gold, end: M.silver, side: M.black });
  bus.add(box(L * 0.6, 0.02, W * 0.55, M.radiator, 0.2, top + 0.025, 0.1));
  bus.add(box(0.02, H * 0.5, W * 0.5, M.louver, L / 2 + 0.025, 0.2, 0.2));

  const skin = addPart(rig, { id: "skin", name: "Thermal skin · MLI and radiators", line: "Silver MLI blankets and mirror-tile radiators dump heat to space", dir: [-0.8, 2.3, -1.1], delay: 0.04, anchor: [0.9, 0.55, -W / 2 - 0.04] });
  sidePanel(skin, M, L, H, W, M.silver);

  const av = addPart(rig, { id: "avionics", name: "Avionics · computer, battery, wheels", line: "Command & data handling, power control and reaction wheels", dir: [0, 0, -1.25], delay: 0.3, anchor: [0.5, H * 0.36, -W * 0.22 - 0.22] });
  avionics(av, M, L, H, W);

  const prop = addPart(rig, { id: "prop", name: "Propulsion · hydrazine", line: "Tank and thrusters hold the 824 km sun-synchronous orbit", dir: [0, -0.1, -2.0], delay: 0.38, anchor: [-0.5, -0.2, 0.25] });
  propulsion(prop, M, -0.5, -0.5, 0.3, 0.36, [[-1.45, bot + 0.05, 0.7], [-1.45, bot + 0.05, -0.7]]);

  viirsPart(rig, M, -0.75, -1.4, -0.3, bot);

  atmsCrisPart(rig, M, 0, 0, 0);

  const omps = addPart(rig, { id: "omps", name: "OMPS · Ozone Mapping and Profiler Suite", line: "Nadir and limb ozone measurements", dir: [1.6, 0.8, -0.6], delay: 0.24, anchor: [1.95, 0.7, -0.35] });
  omps.add(box(0.45, 0.42, 0.5, M.gold, 1.73, 0.45, -0.35));
  frameBars(omps, 0.45, 0.42, 0.5, 0.025, M.alu, 1.73, 0.45, -0.35);
  omps.add(box(0.3, 0.02, 0.06, M.cavity, 1.73, 0.23, -0.35));
  omps.add(box(0.02, 0.1, 0.25, M.cavity, 1.96, 0.5, -0.35));

  let ceresName = "CERES FM5";
  if (noaa20) {
    ceresName = "CERES FM6";
  }
  const ce = addPart(rig, { id: "ceres", name: ceresName, line: "Broadband scanner for Earth's radiation budget", dir: [-1.5, -1.3, 0.5], delay: 0.27, anchor: [-1.25, -1.4, 0.6] });
  ceres(rig, ce, M, -1.25, bot, 0.6, 0.5);

  const sa = addPart(rig, { id: "solar", name: "Solar array · one deployable wing", line: "Tracks the Sun through each 101-minute orbit", dir: [-0.3, 0.3, 1.8], delay: 0.31, anchor: [-0.2, 0.7, 4.3] });
  sa.add(strut(v3(-0.2, 0.25, W / 2), v3(-0.2, 0.25, 1.75), 0.05, M.alu));
  sa.add(rot(cyl(0.15, 0.15, 0.25, M.aluDark, -0.2, 0.25, W / 2 + 0.12), Math.PI / 2, 0, 0));
  const wing = new THREE.Group();
  wing.position.set(-0.2, 0.25, 0);
  wing.rotation.z = 0.4;
  sa.add(wing);
  for (let r = 0; r < 3; r = r + 1) {
    solarPanel(wing, 1.6, 1.62, M, 0, 0, 2.65 + r * 1.7);
    wing.add(box(0.5, 0.05, 0.1, M.fitting, 0, -0.02, 1.8 + r * 1.7));
  }
  wing.add(strut(v3(0, -0.02, 1.75), v3(-0.6, -0.02, 1.82), 0.03, M.alu));
  wing.add(strut(v3(0, -0.02, 1.75), v3(0.6, -0.02, 1.82), 0.03, M.alu));

  const co = addPart(rig, { id: "comms", name: "Antennas · X-band and S-band", line: "Stored science data and direct broadcast to Earth · commands", dir: [0.9, -1.2, 1.0], delay: 0.34, anchor: [1.25, -1.5, 0.75] });
  const gimbal = new THREE.Group();
  gimbal.position.set(1.25, bot - 0.15, 0.72);
  gimbal.add(cyl(0.05, 0.05, 0.3, M.alu, 0, 0.0, 0));
  const xd = dish(0.25, 0.08, new THREE.MeshStandardMaterial({ color: 0xeceff2, metalness: 0.2, roughness: 0.4, side: THREE.DoubleSide }));
  xd.position.set(0, -0.2, 0);
  xd.rotation.x = Math.PI + 0.3;
  gimbal.add(xd);
  gimbal.add(cyl(0.015, 0.015, 0.16, M.alu, 0, -0.28, 0.03));
  co.add(gimbal);
  antennaHat(co, M, -1.3, bot, -0.6, true);

  const at = addPart(rig, { id: "attitude", name: "Star trackers · GPS", line: "Measure pointing and position so every 375 m pixel is geolocated", dir: [-0.3, 1.5, -0.8], delay: 0.36, anchor: [-1.0, 1.4, -0.6] });
  starTracker(at, M, -1.0, top, -0.6, -0.4, 0.3);
  starTracker(at, M, -0.55, top, -0.6, -0.4, -0.3);
  antennaHat(at, M, 1.2, top, 0.6, false);
  at.add(cyl(0.08, 0.08, 0.05, M.white, 0.5, top + 0.05, -0.5));

  if (noaa20) {
    const ka = addPart(rig, { id: "ka", name: "Ka-band antenna · NOAA-20 addition", line: "High-rate 300 Mbit/s downlink that S-NPP does not have", dir: [-0.6, -1.2, 1.4], delay: 0.35, anchor: [-1.1, -1.5, 0.75] });
    const kg = new THREE.Group();
    kg.position.set(-1.1, bot - 0.12, 0.75);
    kg.add(cyl(0.05, 0.05, 0.24, M.alu, 0, 0, 0));
    const kd = dish(0.32, 0.1, new THREE.MeshStandardMaterial({ color: 0xf1f3f5, metalness: 0.15, roughness: 0.4, side: THREE.DoubleSide }));
    kd.position.set(0, -0.18, 0);
    kd.rotation.x = Math.PI - 0.35;
    kg.add(kd);
    kg.add(cyl(0.015, 0.015, 0.2, M.alu, 0, -0.3, 0.04));
    ka.add(kg);
  }

  rig.info = {
    title: "Suomi NPP",
    subtitle: "NASA–NOAA polar orbiter · carries VIIRS",
    specs: [["Launched", "28 Oct 2011"], ["Orbit", "824 km · sun-synchronous"], ["Equator crossing", "~13:30 local, ascending"], ["New data ends", "2 Nov 2026"]],
    insideTitle: "Inside VIIRS",
    insideIntro: "How a fire reaches the detectors — follow the light, one step at a time.",
    outerImgs: [["/img/sheets/npp_xray.webp", "Suomi NPP exploded x-ray · VIIRS, CrIS, ATMS, OMPS"]],
    innerImgs: [["/img/sheets/viirs_cutaway.webp", "VIIRS cutaway · rotating telescope, optics, detectors"]],
  };
  return finish(rig);
}

function finish(rig) {
  rig.parts.forEach((p) => {
    p.base.copy(p.group.position);
  });
  rig.update = function update(explode, time, open) {
    rig.parts.forEach((p) => {
      const k = smooth(clamp01((explode - p.delay * 0.8) / 0.65));
      p.k = k;
      p.group.position.copy(p.base).addScaledVector(p.dir, k);
    });
    const reveal = smooth(clamp01(open || 0));
    rig.reveal = reveal;
    rig.shells.forEach((m) => {
      const o = 1 - 0.86 * reveal;
      m.opacity = o;
      const tr = o < 0.999;
      if (m.transparent !== tr) {
        m.transparent = tr;
        m.needsUpdate = true;
      }
      m.depthWrite = o > 0.6;
    });
    rig.beams.forEach((m) => {
      m.opacity = 0.75 * reveal;
    });
    rig.spinners.forEach((s) => {
      if (s.mode === "osc") {
        s.obj.rotation[s.axis] = Math.sin(time * s.speed + s.phase) * s.amp;
      } else {
        s.obj.rotation[s.axis] = time * s.speed + s.phase;
      }
    });
  };
  rig.update(0, 0, 0);
  return rig;
}


function misrCameras(group, M, x, y, z) {
  for (let i = 0; i < 9; i = i + 1) {
    const a = ((i - 4) / 4) * 1.22;
    const g = new THREE.Group();
    g.position.set(x - 0.48 + i * 0.12, y, z);
    g.rotation.z = a * 0.55;
    g.add(cyl(0.05, 0.05, 0.22, M.black, 0, -0.11, 0, 20));
    g.add(cyl(0.035, 0.035, 0.02, M.lens, 0, -0.225, 0, 20));
    group.add(g);
  }
}

export function buildTerra() {
  const M = materials();
  const rig = newRig();
  const L = 6.8;
  const H = 3.0;
  const W = 3.1;
  const top = H / 2;
  const bot = -H / 2;

  const bus = addPart(rig, { id: "bus", name: "Spacecraft bus · EOS AM-1 (Lockheed Martin)", line: "6.8 m long, 5,190 kg · power, pointing and data for five instruments", dir: [0, 0, 0], delay: 0, anchor: [-3.1, top, 1.1] });
  busShell(bus, M, L, H, W, { top: M.silver, bottom: M.gold, end: M.gold, side: M.gold });
  bus.add(box(L * 0.5, 0.02, W * 0.6, M.radiator, 0.6, top + 0.025, 0.2));
  bus.add(box(0.02, H * 0.55, W * 0.5, M.louver, -L / 2 - 0.025, 0.2, 0));
  bus.add(box(0.02, H * 0.5, W * 0.5, M.radiator, L / 2 + 0.025, 0.1, 0));

  const skin = addPart(rig, { id: "skin", name: "Thermal skin · multi-layer insulation", line: "Gold MLI and mirror radiators hold the instruments at their working temperature", dir: [-1.2, 2.6, -1.3], delay: 0.04, anchor: [2.0, 0.9, -W / 2 - 0.04] });
  sidePanel(skin, M, L, H, W, M.gold);

  const av = addPart(rig, { id: "avionics", name: "Avionics · computer, battery, wheels", line: "Command & data handling, power regulation, battery and reaction wheels", dir: [0, 0, -1.6], delay: 0.3, anchor: [1.0, H * 0.36, -W * 0.22 - 0.22] });
  avionics(av, M, L, H, W);

  const prop = addPart(rig, { id: "prop", name: "Propulsion · hydrazine", line: "Fuel nearly spent: Terra stopped holding its orbit in 2020 and now drifts earlier", dir: [0, -0.1, -2.4], delay: 0.38, anchor: [-0.8, -0.1, 0.3] });
  propulsion(prop, M, -0.8, -0.6, 0.3, 0.55, [[-3.3, bot + 0.05, 1.2], [-3.3, bot + 0.05, -1.2]]);

  modisPart(rig, M, -2.0, bot - 0.51, -0.4, bot);

  const misr = addPart(rig, { id: "misr", name: "MISR · Multi-angle Imaging SpectroRadiometer", line: "Nine cameras see each place from 70° forward to 70° aft · smoke-plume heights", dir: [0.2, -2.4, 0.9], delay: 0.12, anchor: [0.2, bot - 0.9, 0.8] });
  misr.add(box(1.3, 0.62, 0.95, M.silver, 0.2, bot - 0.31, 0.75));
  frameBars(misr, 1.3, 0.62, 0.95, 0.035, M.alu, 0.2, bot - 0.31, 0.75);
  misrCameras(misr, M, 0.2, bot - 0.62, 0.75);

  const aster = addPart(rig, { id: "aster", name: "ASTER · Japan's high-resolution imager", line: "15–90 m pixels · VNIR stereo pair, SWIR and TIR telescopes", dir: [1.6, -1.8, 0.4], delay: 0.15, anchor: [2.4, bot - 0.9, 0.2] });
  aster.add(box(0.8, 0.7, 0.75, M.gold, 1.7, bot - 0.35, 0.9));
  aster.add(rot(cyl(0.16, 0.16, 0.5, M.black, 1.55, bot - 0.75, 0.9), 0, 0, 0));
  aster.add(rot(cyl(0.14, 0.14, 0.5, M.black, 1.9, bot - 0.72, 0.9), 0, 0, -0.48));
  aster.add(box(0.7, 0.6, 0.65, M.silver, 2.65, bot - 0.3, 0.9));
  aster.add(cyl(0.14, 0.14, 0.4, M.black, 2.65, bot - 0.75, 0.9));
  aster.add(box(0.9, 0.75, 0.8, M.gold, 2.4, bot - 0.38, -0.55));
  aster.add(cyl(0.22, 0.22, 0.5, M.black, 2.4, bot - 0.95, -0.55));
  aster.add(cyl(0.15, 0.15, 0.02, M.lens, 2.4, bot - 1.2, -0.55));

  const mop = addPart(rig, { id: "mopitt", name: "MOPITT · carbon monoxide sounder", line: "Canada's instrument tracks CO from fires and pollution", dir: [-0.4, -1.8, -1.4], delay: 0.2, anchor: [0.4, bot - 0.7, -1.0] });
  mop.add(box(1.0, 0.55, 0.7, M.silver, 0.4, bot - 0.28, -0.85));
  frameBars(mop, 1.0, 0.55, 0.7, 0.03, M.alu, 0.4, bot - 0.28, -0.85);
  aperture(mop, M, 0.12, 0.2, bot - 0.6, -0.85);
  aperture(mop, M, 0.12, 0.6, bot - 0.6, -0.85);

  const ce = addPart(rig, { id: "ceres", name: "CERES FM1 · FM2", line: "Two broadband scanners for Earth's radiation budget", dir: [1.9, -1.3, 0], delay: 0.27, anchor: [3.1, bot - 0.5, 1.1] });
  ceres(rig, ce, M, 3.1, bot, 1.1, 0);
  ceres(rig, ce, M, 3.1, bot, -1.2, 1.6);

  const sa = addPart(rig, { id: "solar", name: "Solar array · one large wing", line: "About 5 kW · tracks the Sun through each 99-minute orbit", dir: [-0.5, 0.3, 2.4], delay: 0.31, anchor: [-2.6, 1.0, 8.0] });
  sa.add(strut(v3(-2.6, 0.7, W / 2), v3(-2.6, 0.7, 3.0), 0.07, M.alu));
  sa.add(rot(cyl(0.2, 0.2, 0.32, M.aluDark, -2.6, 0.7, W / 2 + 0.16), Math.PI / 2, 0, 0));
  const wing = new THREE.Group();
  wing.position.set(-2.6, 0.7, 0);
  wing.rotation.z = 0.5;
  sa.add(wing);
  for (let r = 0; r < 6; r = r + 1) {
    for (let c = 0; c < 3; c = c + 1) {
      solarPanel(wing, 1.45, 1.45, M, -1.5 + c * 1.5, 0, 3.8 + r * 1.52);
    }
    wing.add(box(4.55, 0.04, 0.06, M.alu, 0, -0.03, 3.04 + r * 1.52));
  }
  wing.add(box(0.08, 0.08, 9.2, M.alu, 0, -0.05, 7.4));

  const hga = addPart(rig, { id: "hga", name: "High-gain antenna · TDRSS link", line: "Sends science data up to NASA's relay satellites on a 3 m boom", dir: [0.8, 2.0, -0.8], delay: 0.34, anchor: [2.6, top + 3.0, -0.8] });
  hga.add(strut(v3(2.2, top, -0.8), v3(2.6, top + 2.6, -0.8), 0.05, M.alu));
  const hd = dish(0.75, 0.24, new THREE.MeshStandardMaterial({ color: 0xeef0f2, metalness: 0.15, roughness: 0.42, side: THREE.DoubleSide }));
  hd.position.set(2.6, top + 2.6, -0.8);
  hd.rotation.set(0.5, 0, -0.6);
  hga.add(hd);
  hga.add(cyl(0.12, 0.12, 0.12, M.aluDark, 2.6, top + 2.55, -0.8));

  const at = addPart(rig, { id: "attitude", name: "Star trackers · GPS", line: "Measure pointing and position so every pixel is geolocated", dir: [0.2, 1.6, -0.9], delay: 0.36, anchor: [0.8, top + 0.45, -1.1] });
  starTracker(at, M, 0.8, top, -1.1, -0.35, 0.25);
  starTracker(at, M, 1.25, top, -1.1, -0.35, -0.25);
  antennaHat(at, M, -3.1, top, -1.1, false);

  rig.info = { title: "Terra", subtitle: "NASA Earth Observing System flagship · carries MODIS" };
  return finish(rig);
}

export function buildNOAA21() {
  const M = materials();
  const rig = newRig();
  const L = 3.0;
  const H = 1.9;
  const W = 1.8;
  const top = H / 2;
  const bot = -H / 2;

  const bus = addPart(rig, { id: "bus", name: "Spacecraft bus · Northrop Grumman LEOStar-3", line: "Same bus family as Landsat 8 and 9 · 2,930 kg at launch", dir: [0, 0, 0], delay: 0, anchor: [-1.4, top, 0.6] });
  busShell(bus, M, L, H, W, { top: M.silver, bottom: M.silver, end: M.black, side: M.silver });
  bus.add(box(L * 0.7, 0.02, W * 0.6, M.radiator, 0, top + 0.025, 0.05));
  bus.add(box(0.02, H * 0.6, W * 0.55, M.radiator, -L / 2 - 0.025, 0.1, 0));
  bus.add(box(0.02, H * 0.5, W * 0.5, M.louver, L / 2 + 0.025, 0.15, 0.1));

  const skin = addPart(rig, { id: "skin", name: "Thermal skin · silver MLI and radiators", line: "Reflective blankets and mirror radiators shed heat to space", dir: [-0.8, 2.3, -1.1], delay: 0.04, anchor: [0.9, 0.55, -W / 2 - 0.04] });
  sidePanel(skin, M, L, H, W, M.silver);

  const av = addPart(rig, { id: "avionics", name: "Avionics · computer, battery, wheels", line: "Command & data handling, power control and reaction wheels", dir: [0, 0, -1.25], delay: 0.3, anchor: [0.5, H * 0.36, -W * 0.22 - 0.22] });
  avionics(av, M, L, H, W);

  const prop = addPart(rig, { id: "prop", name: "Propulsion · hydrazine", line: "Eight 22 N thrusters hold the 833 km orbit", dir: [0, -0.1, -2.0], delay: 0.38, anchor: [-0.5, -0.2, 0.25] });
  propulsion(prop, M, -0.5, -0.5, 0.3, 0.36, [[-1.45, bot + 0.05, 0.7], [-1.45, bot + 0.05, -0.7]]);

  viirsPart(rig, M, -0.75, -1.4, -0.3, bot);
  atmsCrisPart(rig, M, 0, 0, 0);

  const omps = addPart(rig, { id: "omps", name: "OMPS-Limb · ozone profiler", line: "Looks sideways through the atmosphere's edge for ozone layers", dir: [1.4, 1.0, 0.8], delay: 0.24, anchor: [1.2, top + 0.4, 0.55] });
  omps.add(box(0.5, 0.36, 0.42, M.gold, 1.15, top + 0.18, 0.55));
  frameBars(omps, 0.5, 0.36, 0.42, 0.025, M.alu, 1.15, top + 0.18, 0.55);
  omps.add(box(0.02, 0.18, 0.28, M.cavity, 1.41, top + 0.2, 0.55));

  const sa = addPart(rig, { id: "solar", name: "Solar array · one wing, five panels", line: "4,450 W · tracks the Sun through each 101-minute orbit", dir: [-0.2, 0.3, 2.0], delay: 0.31, anchor: [0.3, 0.6, 6.0] });
  sa.add(strut(v3(0.3, 0.35, W / 2), v3(0.3, 0.35, 1.9), 0.05, M.alu));
  sa.add(rot(cyl(0.15, 0.15, 0.25, M.aluDark, 0.3, 0.35, W / 2 + 0.12), Math.PI / 2, 0, 0));
  const wing = new THREE.Group();
  wing.position.set(0.3, 0.35, 0);
  wing.rotation.z = -0.35;
  sa.add(wing);
  for (let r = 0; r < 5; r = r + 1) {
    solarPanel(wing, 1.5, 1.32, M, 0, 0, 2.7 + r * 1.38);
  }
  wing.add(box(0.06, 0.06, 7.0, M.alu, 0, -0.05, 5.4));

  const ka = addPart(rig, { id: "ka", name: "Ka-band antenna", line: "300 Mbit/s science downlink", dir: [0.9, -1.2, 1.0], delay: 0.34, anchor: [1.3, -1.5, 0.75] });
  const kg = new THREE.Group();
  kg.position.set(1.3, bot - 0.15, 0.75);
  kg.add(cyl(0.05, 0.05, 0.3, M.alu, 0, 0, 0));
  const kd = dish(0.3, 0.09, new THREE.MeshStandardMaterial({ color: 0xeceff2, metalness: 0.2, roughness: 0.4, side: THREE.DoubleSide }));
  kd.position.set(0, -0.2, 0);
  kd.rotation.x = Math.PI + 0.3;
  kg.add(kd);
  ka.add(kg);
  antennaHat(ka, M, -1.3, bot, -0.6, true);

  const at = addPart(rig, { id: "attitude", name: "Star trackers · GPS", line: "Measure pointing and position so every 375 m pixel is geolocated", dir: [-0.3, 1.5, -0.8], delay: 0.36, anchor: [-1.0, 1.4, -0.6] });
  starTracker(at, M, -1.0, top, -0.6, -0.4, 0.3);
  starTracker(at, M, -0.55, top, -0.6, -0.4, -0.3);

  rig.info = { title: "NOAA-21", subtitle: "NOAA–NASA JPSS-2 · carries VIIRS" };
  return finish(rig);
}
