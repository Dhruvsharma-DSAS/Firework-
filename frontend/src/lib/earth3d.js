import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { buildAqua, buildSuomiNPP, buildTerra, buildNOAA21 } from "./satModels.js";
import { DIAGRAMS } from "./diagrams.js";

const EARTH_R = 10;
const SPIN_DEG_S = 1.1;
const FOV = 38;
export const SAT_SPAN = 18;
let ACTIVE_FLEET = null;

export function activeSatPose(id) {
  if (!ACTIVE_FLEET) {
    return null;
  }
  const s = ACTIVE_FLEET.find((f) => f.def.id === id);
  if (!s) {
    return null;
  }
  return { pos: s.pivot.position.clone(), quat: s.pivot.quaternion.clone(), scale: s.pivot.scale.x };
}

export const VIEWS = [
  { cx: 0.73, cy: 0.54, r: 0.33, yaw: 0 },
  { cx: 0.84, cy: 0.74, r: 0.52, yaw: 0.5 },
  { cx: 0.8, cy: 1.22, r: 0.85, yaw: 1.2 },
  { cx: 0.84, cy: 1.14, r: 0.56, yaw: 1.9 },
  { cx: 0.88, cy: 1.12, r: 0.52, yaw: 2.5 },
  { cx: 0.88, cy: 0.32, r: 0.3, yaw: 3.0 },
  { cx: 0.74, cy: 0.6, r: 0.42, yaw: 3.6 },
];

const SATS = [
  { id: "modis", build: buildAqua, color: "#ffb547", radius: 12.4, inc: 108, raan: 240, period: 44, phase: 3.7, dashed: true, side: 1, pose: [0.42, -2.25, 0.05], swathKm: 2330 },
  { id: "terra", decor: true, build: buildTerra, color: "#ffb547", radius: 12.9, inc: 97, raan: 300, period: 47, phase: 1.3, dashed: false, side: 1, pose: [0.42, -2.25, 0.05], swathKm: 2330 },
  { id: "noaa20", decor: true, build: () => buildSuomiNPP({ noaa20: true }), color: "#3dd6f5", radius: 13.9, inc: 100, raan: 150, period: 56, phase: 2.5, dashed: false, side: -1, pose: [0.4, -2.2, 0.05], swathKm: 3040 },
  { id: "noaa21", decor: true, build: buildNOAA21, color: "#7fe3ff", radius: 14.5, inc: 99, raan: 95, period: 61, phase: 5.1, dashed: false, side: -1, pose: [0.4, -2.2, 0.05], swathKm: 3040 },
  { id: "viirs", build: buildSuomiNPP, color: "#3dd6f5", radius: 13.4, inc: 99, raan: 205, period: 52, phase: 0.9, dashed: false, side: -1, pose: [0.4, -2.2, 0.05], swathKm: 3040 },
];

function smooth(t) {
  return t * t * (3 - 2 * t);
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

function loadTex(url) {
  return new Promise((resolve) => {
    new THREE.TextureLoader().load(url, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      resolve(t);
    }, undefined, () => resolve(null));
  });
}

export function llToVec(lat, lon, r) {
  const phi = ((90 - lat) * Math.PI) / 180;
  const th = ((lon + 180) * Math.PI) / 180;
  return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(th), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(th));
}

function normaliseModel(root) {
  const holder = new THREE.Group();
  if (!root) {
    return holder;
  }
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  const boxAll = new THREE.Box3().setFromObject(root);
  boxAll.getSize(size);
  boxAll.getCenter(center);
  const longest = Math.max(size.x, size.y, size.z) || 1;
  const k = SAT_SPAN / longest;
  root.position.copy(center).multiplyScalar(-k);
  root.scale.setScalar(k);
  holder.add(root);
  return holder;
}

export const EARTH_VS = `
varying vec2 vUv; varying vec3 vN; varying vec3 vW; varying vec3 vO;
void main(){ vUv=uv; vO=normalize(position); vN=normalize(mat3(modelMatrix)*normal); vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`;

export const EARTH_FS = `
uniform sampler2D day; uniform sampler2D night; uniform sampler2D water; uniform vec3 sun; uniform vec3 camPos; uniform float cloudT;
varying vec2 vUv; varying vec3 vN; varying vec3 vW; varying vec3 vO;
float h3(vec3 p){ p=fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float n3(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.-2.*f);
 return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
            mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm(vec3 p){ float a=.5; float s=0.; for(int i=0;i<5;i++){ s+=a*n3(p); p*=2.03; a*=.5; } return s; }
void main(){
  vec3 n=normalize(vN); float d=dot(n,normalize(sun));
  float k=smoothstep(-0.18,0.22,d);
  vec3 dc=texture2D(day,vUv).rgb;
  vec3 nt=texture2D(night,vUv).rgb; float lt=dot(nt,vec3(.3,.59,.11));
  vec3 nc=vec3(1.0,0.62,0.28)*lt*1.6+vec3(1.0,0.88,0.65)*pow(lt,2.)*2.6;
  vec3 q=vO*3.2+vec3(cloudT,0.,cloudT*.4);
  float cl=smoothstep(.52,.78,fbm(q+fbm(q*1.7)*.6));
  vec3 v=normalize(camPos-vW);
  float wm=texture2D(water,vUv).r;
  vec3 h=normalize(normalize(sun)+v); float spec=pow(max(dot(n,h),0.),60.)*wm*0.9*k;
  vec3 dayc=mix(dc,vec3(1.),cl*0.8)*(0.25+0.75*max(d,0.))+vec3(1.0,0.92,0.8)*spec;
  vec3 nightc=nc*(1.-cl*0.6)+dc*0.006+cl*vec3(0.006,0.009,0.02);
  vec3 col=mix(nightc,dayc,k);
  float twi=exp(-pow(d*6.,2.)); col+=vec3(0.9,0.38,0.12)*twi*0.05*k;
  float fr=pow(1.-max(dot(n,v),0.),5.0);
  col+=vec3(0.30,0.55,1.0)*fr*(0.04+0.96*smoothstep(-0.25,0.4,d))*0.8;
  gl_FragColor=vec4(col,1.);
  #include <colorspace_fragment>
}`;

export const ATMO_FS = `
uniform vec3 sun; uniform vec3 camPos; uniform float uPow; varying vec3 vN; varying vec3 vW; varying vec2 vUv; varying vec3 vO;
void main(){ vec3 n=normalize(vN); vec3 v=normalize(camPos-vW); float r=1.-abs(dot(n,v)); float a=pow(r,uPow); float s=smoothstep(-0.45,0.5,dot(n,normalize(sun)));
 vec3 c=mix(vec3(0.12,0.25,0.65),vec3(0.45,0.72,1.0),s); gl_FragColor=vec4(c*a*(0.25+1.3*s),a*(0.35+0.9*s)); }`;

function fireSprite() {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d");
  const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  rg.addColorStop(0, "rgba(255,255,255,1)");
  rg.addColorStop(0.25, "rgba(255,255,255,0.8)");
  rg.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = rg;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

const SWATH_N = 96;
const SWATH_TRAIL = 1.3;
const SWATH_VS = "attribute float fade; varying float vF; varying float vE; attribute float edge; void main(){ vF=fade; vE=edge; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }";
const SWATH_FS = "uniform vec3 color; uniform float alpha; varying float vF; varying float vE; void main(){ float rim=smoothstep(0.82,1.0,abs(vE)); float body=0.42+0.58*rim; gl_FragColor=vec4(color*body, vF*alpha*body); }";

function makeSwath(color) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array((SWATH_N + 1) * 2 * 3);
  const fade = new Float32Array((SWATH_N + 1) * 2);
  const edge = new Float32Array((SWATH_N + 1) * 2);
  const idx = [];
  for (let i = 0; i <= SWATH_N; i = i + 1) {
    const f = Math.pow(1 - i / SWATH_N, 1.6);
    fade[i * 2] = f;
    fade[i * 2 + 1] = f;
    edge[i * 2] = -1;
    edge[i * 2 + 1] = 1;
    if (i < SWATH_N) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("fade", new THREE.BufferAttribute(fade, 1));
  g.setAttribute("edge", new THREE.BufferAttribute(edge, 1));
  g.setIndex(idx);
  const mat = new THREE.ShaderMaterial({ uniforms: { color: { value: new THREE.Color(color) }, alpha: { value: 0.5 } }, vertexShader: SWATH_VS, fragmentShader: SWATH_FS, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  return { mesh: mesh, mat: mat, pos: pos };
}

const SW_D = new THREE.Vector3();
const SW_N = new THREE.Vector3();

function updateSwath(s, visible) {
  const sw = s.swath;
  sw.mat.uniforms.alpha.value = 0.55 * visible;
  sw.mesh.visible = visible > 0.01;
  if (!sw.mesh.visible) {
    return;
  }
  const half = s.def.swathKm / 2 / 6371;
  const ch = Math.cos(half);
  const sh = Math.sin(half);
  SW_N.crossVectors(s.basis.u, s.basis.v).normalize();
  for (let i = 0; i <= SWATH_N; i = i + 1) {
    const a = s.angle - (i / SWATH_N) * SWATH_TRAIL;
    SW_D.copy(s.basis.u).multiplyScalar(Math.cos(a)).addScaledVector(s.basis.v, Math.sin(a)).normalize();
    const r = 10.045;
    const k = i * 6;
    sw.pos[k] = (SW_D.x * ch + SW_N.x * sh) * r;
    sw.pos[k + 1] = (SW_D.y * ch + SW_N.y * sh) * r;
    sw.pos[k + 2] = (SW_D.z * ch + SW_N.z * sh) * r;
    sw.pos[k + 3] = (SW_D.x * ch - SW_N.x * sh) * r;
    sw.pos[k + 4] = (SW_D.y * ch - SW_N.y * sh) * r;
    sw.pos[k + 5] = (SW_D.z * ch - SW_N.z * sh) * r;
  }
  sw.mesh.geometry.attributes.position.needsUpdate = true;
}

function orbitBasis(incDeg, raanDeg) {
  const ax = new THREE.Vector3(1, 0, 0);
  const ay = new THREE.Vector3(0, 1, 0);
  const inc = (incDeg * Math.PI) / 180;
  const raan = (raanDeg * Math.PI) / 180;
  const u = new THREE.Vector3(1, 0, 0).applyAxisAngle(ax, inc).applyAxisAngle(ay, raan);
  const v = new THREE.Vector3(0, 0, 1).applyAxisAngle(ax, inc).applyAxisAngle(ay, raan);
  return { u: u, v: v };
}

const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl(tag, cls) {
  const el = document.createElementNS(SVG_NS, tag);
  el.setAttribute("class", cls);
  return el;
}

function splitName(name) {
  const parts = name.split(" · ");
  if (parts.length > 1) {
    return { code: parts[0], full: parts.slice(1).join(" · ") };
  }
  return { code: name, full: "" };
}

function pad(n) {
  if (n < 10) {
    return "0" + n;
  }
  return String(n);
}

function node(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) {
    el.className = cls;
  }
  if (text !== undefined) {
    el.textContent = text;
  }
  return el;
}

function sheetRow(it) {
  const li = node("li", "");
  const head = node("div", "sh-row");
  head.appendChild(node("span", "sh-n", it.idx));
  head.appendChild(node("b", "", it.code));
  li.appendChild(head);
  const body = node("div", "sh-body");
  if (it.full) {
    body.appendChild(node("small", "", it.full));
  }
  body.appendChild(node("p", "", it.line));
  li.appendChild(body);
  return li;
}

function spotDots(frame, spots, onIn, onOut) {
  spots.forEach((sp, i) => {
    const dot = node("button", "dg-dot");
    dot.type = "button";
    dot.style.left = sp[0] + "%";
    dot.style.top = sp[1] + "%";
    if (sp[0] > 60) {
      dot.classList.add("flip");
    }
    dot.appendChild(node("span", "", String(i + 1)));
    dot.appendChild(node("em", "", sp[2]));
    dot.setAttribute("aria-label", sp[2]);
    dot.addEventListener("mouseenter", () => onIn(sp, i));
    dot.addEventListener("focus", () => onIn(sp, i));
    dot.addEventListener("mouseleave", () => onOut());
    dot.addEventListener("blur", () => onOut());
    dot.addEventListener("click", (event) => event.stopPropagation());
    frame.appendChild(dot);
  });
}

function openLightbox(src, cap) {
  const back = node("div", "sat-lightbox");
  const fig = node("figure", "");
  const frame = node("div", "dg-frame");
  const img = node("img", "");
  img.src = src;
  img.alt = cap;
  frame.appendChild(img);
  fig.appendChild(frame);
  const info = node("figcaption", "", "");
  const title = node("b", "", cap);
  const text = node("span", "", "Point at a number to read that part · illustration, not an engineering drawing · click outside or Esc to close");
  info.appendChild(title);
  info.appendChild(text);
  fig.appendChild(info);
  spotDots(frame, DIAGRAMS[src] || [], (sp) => {
    title.textContent = sp[2] + " · " + sp[3];
    text.textContent = sp[4];
  }, () => {
    title.textContent = cap;
    text.textContent = "Point at a number to read that part · click outside or Esc to close";
  });
  back.appendChild(fig);
  function close() {
    back.remove();
    window.removeEventListener("keydown", onKey);
  }
  function onKey(event) {
    if (event.key === "Escape") {
      close();
    }
  }
  back.addEventListener("click", (event) => {
    if (event.target === back) {
      close();
    }
  });
  window.addEventListener("keydown", onKey);
  document.body.appendChild(back);
}

function gallery(list, items, mode) {
  const box = node("div", "sh-fig");
  if (!list || list.length === 0) {
    return box;
  }
  const main = node("div", "sh-main");
  const img = node("img", "");
  main.appendChild(img);
  const dots = node("div", "dg-layer");
  main.appendChild(dots);
  const zoom = node("button", "sh-zoom", "⤢ enlarge");
  zoom.type = "button";
  main.appendChild(zoom);
  const cap = node("small", "sh-cap", "");
  let current = 0;
  const thumbs = node("div", "sh-thumbs");
  function show(i) {
    current = i;
    img.src = list[i][0];
    img.alt = list[i][1];
    cap.textContent = list[i][1];
    Array.from(thumbs.children).forEach((t, j) => t.classList.toggle("on", j === i));
    dots.innerHTML = "";
    spotDots(dots, DIAGRAMS[list[i][0]] || [], (sp, k) => {
      items.diag = { mode: mode, idx: pad(k + 1), name: sp[2], tag: sp[3], text: sp[4], total: (DIAGRAMS[list[current][0]] || []).length };
      items.focus = "";
    }, () => {
      items.diag = null;
      items.focus = "";
    });
  }
  list.forEach((item, i) => {
    const t = node("button", "");
    t.type = "button";
    const ti = node("img", "");
    ti.src = item[0];
    ti.alt = "";
    t.appendChild(ti);
    t.addEventListener("mouseenter", () => show(i));
    t.addEventListener("click", () => show(i));
    thumbs.appendChild(t);
  });
  zoom.addEventListener("click", () => openLightbox(list[current][0], list[current][1]));
  img.addEventListener("click", () => openLightbox(list[current][0], list[current][1]));
  box.appendChild(main);
  box.appendChild(cap);
  if (list.length > 1) {
    box.appendChild(thumbs);
  }
  show(0);
  return box;
}

function focusCard(items, mode, hint) {
  const card = node("div", "sh-card");
  const top = node("div", "sh-card-top");
  const badge = node("span", "sh-badge", "");
  const of = node("span", "sh-of", "");
  top.appendChild(badge);
  top.appendChild(of);
  card.appendChild(top);
  const name = node("b", "sh-name", "");
  const full = node("div", "sh-full", "");
  const line = node("p", "sh-line", "");
  card.appendChild(name);
  card.appendChild(full);
  card.appendChild(line);
  const nav = node("div", "sh-nav");
  const prev = node("button", "", "←");
  prev.type = "button";
  prev.setAttribute("aria-label", "Previous part");
  const next = node("button", "", "→");
  next.type = "button";
  next.setAttribute("aria-label", "Next part");
  nav.appendChild(prev);
  nav.appendChild(node("span", "sh-hint", hint));
  nav.appendChild(next);
  card.appendChild(nav);
  function step(d) {
    const n = items.filter((it) => it.sub === (mode === "inner")).length;
    items.pick[mode] = (items.pick[mode] + d + n) % n;
    items.from = "nav";
  }
  prev.addEventListener("click", () => step(-1));
  next.addEventListener("click", () => step(1));
  return { el: card, badge: badge, of: of, name: name, full: full, line: line };
}

function fillCard(card, it, total) {
  card.badge.textContent = it.idx;
  card.of.textContent = "of " + pad(total);
  card.name.textContent = it.code;
  card.full.textContent = it.full;
  card.full.style.display = "";
  if (!it.full) {
    card.full.style.display = "none";
  }
  card.line.textContent = it.line;
}

function makeLabels(rig, def, layer) {
  const items = [];
  if (!layer) {
    return items;
  }
  const svg = svgEl("svg", "sat-svg");
  layer.appendChild(svg);
  const main = rig.parts.find((p) => p.main);
  const ordered = [main].concat(rig.parts.filter((p) => !p.main));
  ordered.forEach((p, i) => {
    const nm = splitName(p.name);
    items.push({ part: p, anchor: p.anchor, code: nm.code, full: nm.full, line: p.line, main: p.main, sub: false, idx: pad(i + 1), pi: i });
  });
  main.sub.forEach((sp, j) => {
    items.push({ part: main, anchor: sp.anchor, code: sp.name, full: "", line: sp.line, main: false, sub: true, idx: pad(j + 1), pi: j });
  });
  items.pick = { outer: 0, inner: 0 };
  items.from = "";
  const info = rig.info || { title: "", subtitle: "", specs: [], insideTitle: "", insideIntro: "" };
  const sheet = node("aside", "sat-sheet");
  sheet.style.setProperty("--c", def.color);
  const outer = node("section", "sh-outer");
  outer.appendChild(node("div", "sh-eye", "Spacecraft anatomy"));
  outer.appendChild(node("h3", "", info.title));
  outer.appendChild(node("p", "sh-sub", info.subtitle));
  const specs = node("dl", "sh-specs");
  info.specs.forEach((sp) => {
    const d = node("div", "");
    d.appendChild(node("dt", "", sp[0]));
    d.appendChild(node("dd", "", sp[1]));
    specs.appendChild(d);
  });
  outer.appendChild(specs);
  const outerCard = focusCard(items, "outer", "Point at any part of the satellite");
  outer.appendChild(outerCard.el);
  const outerList = node("ol", "sh-list");
  const inner = node("section", "sh-inner");
  inner.appendChild(node("div", "sh-eye", info.title + " · light path"));
  inner.appendChild(node("h3", "", info.insideTitle));
  inner.appendChild(node("p", "sh-sub", info.insideIntro));
  const innerCard = focusCard(items, "inner", "Follow the light, step by step");
  inner.appendChild(innerCard.el);
  const innerList = node("ol", "sh-list steps");
  sheet.appendChild(outer);
  sheet.appendChild(inner);
  layer.appendChild(sheet);
  const figs = node("aside", "sat-figs");
  figs.style.setProperty("--c", def.color);
  figs.appendChild(node("div", "sh-eye", "Reference diagrams"));
  const figOuter = gallery(info.outerImgs, items, "outer");
  figOuter.classList.add("fo");
  const figInner = gallery(info.innerImgs, items, "inner");
  figInner.classList.add("fi");
  figs.appendChild(figOuter);
  figs.appendChild(figInner);
  layer.appendChild(figs);
  items.forEach((it) => {
    const g = svgEl("g", "sat-g");
    g.style.setProperty("--c", def.color);
    if (!it.main && !it.sub) {
      g.classList.add("muted");
    }
    const lead = svgEl("path", "sat-lead");
    const ring = svgEl("circle", "sat-ring");
    ring.setAttribute("r", "5");
    const core = svgEl("circle", "sat-core");
    core.setAttribute("r", "1.8");
    const tick = svgEl("rect", "sat-node");
    tick.setAttribute("width", "5");
    tick.setAttribute("height", "5");
    g.appendChild(lead);
    g.appendChild(ring);
    g.appendChild(core);
    g.appendChild(tick);
    g.style.opacity = "0";
    svg.appendChild(g);
    const el = node("div", "sat-lab");
    if (it.main) {
      el.classList.add("main");
    }
    if (it.sub) {
      el.classList.add("sub");
    }
    el.style.setProperty("--c", def.color);
    el.appendChild(node("em", "", it.idx));
    el.appendChild(node("b", "", it.code));
    layer.appendChild(el);
    it.el = el;
    it.g = g;
    it.lead = lead;
    it.ring = ring;
    it.core = core;
    it.tick = tick;
    it.shown = false;
    it.side = 0;
    it.ty = null;
    it.row = sheetRow(it);
    let mode = "outer";
    if (it.sub) {
      mode = "inner";
    }
    el.addEventListener("mouseenter", () => {
      items.pick[mode] = it.pi;
      items.from = "label";
    });
    it.row.addEventListener("mouseenter", () => {
      items.pick[mode] = it.pi;
      items.from = "row";
    });
    if (it.sub) {
      innerList.appendChild(it.row);
    } else {
      outerList.appendChild(it.row);
    }
  });
  items.svg = svg;
  items.sheet = sheet;
  items.figs = figs;
  items.outerCard = outerCard;
  items.innerCard = innerCard;
  items.focus = "";
  return items;
}

const LABEL_P = new THREE.Vector3();
const LABEL_C = new THREE.Vector3();
const BOX_S = new THREE.Vector3();
const RAY = new THREE.Raycaster();
const NDC = new THREE.Vector2();

function pickAt(s, cam, pointer, live, mode, w, h) {
  const items = s.labels;
  if (!pointer.moved || pointer.x < items.sheet.offsetLeft + items.sheet.offsetWidth + 12) {
    return;
  }
  if (mode === "outer") {
    NDC.set((pointer.x / w) * 2 - 1, 1 - (pointer.y / h) * 2);
    RAY.setFromCamera(NDC, cam);
    let best = null;
    live.forEach((p) => {
      if (p.it.sub) {
        return;
      }
      const hit = RAY.intersectObject(p.it.part.group, true);
      if (hit.length > 0 && (best === null || hit[0].distance < best.d)) {
        best = { it: p.it, d: hit[0].distance };
      }
    });
    if (best) {
      items.pick.outer = best.it.pi;
      items.from = "model";
    }
    return;
  }
  let near = null;
  live.forEach((p) => {
    if (!p.it.sub) {
      return;
    }
    const d = Math.hypot(p.sx - pointer.x, p.sy - pointer.y);
    if (d < 70 && (near === null || d < near.d)) {
      near = { it: p.it, d: d };
    }
  });
  if (near) {
    items.pick.inner = near.it.pi;
    items.from = "model";
  }
}

function setLive(it, on) {
  let v = "none";
  if (on) {
    v = "auto";
  }
  if (it.el.style.pointerEvents !== v) {
    it.el.style.pointerEvents = v;
  }
}

function hideItem(it) {
  setLive(it, false);
  if (it.shown) {
    it.el.style.opacity = "0";
    it.g.style.opacity = "0";
    it.shown = false;
  }
  it.side = 0;
  it.ty = null;
}

function setFocus(items, mode, index) {
  let key = mode + ":" + index;
  if (items.diag) {
    key = key + ":diag:" + items.diag.name;
  }
  if (items.focus === key) {
    return;
  }
  items.focus = key;
  const pool = items.filter((it) => it.sub === (mode === "inner"));
  pool.forEach((it, i) => {
    const on = i === index;
    it.row.classList.toggle("on", on);
    it.row.classList.toggle("done", index >= 0 && i < index);
    it.el.classList.toggle("focus", on);
    it.el.classList.toggle("dim", index >= 0 && !on);
    it.g.classList.toggle("focus", on);
    it.g.classList.toggle("dim", index >= 0 && !on);
  });
  let card = items.outerCard;
  if (mode === "inner") {
    card = items.innerCard;
  }
  card.el.classList.toggle("diag", !!items.diag);
  if (items.diag && items.diag.mode === mode) {
    fillCard(card, { idx: items.diag.idx, code: items.diag.name, full: "On the diagram · " + items.diag.tag, line: items.diag.text }, items.diag.total);
    card.el.classList.remove("swap");
    void card.el.offsetWidth;
    card.el.classList.add("swap");
  } else if (index >= 0 && pool[index]) {
    fillCard(card, pool[index], pool.length);
    card.el.classList.remove("swap");
    void card.el.offsetWidth;
    card.el.classList.add("swap");
  }
  items.sheet.classList.toggle("mode-inner", mode === "inner");
  items.figs.classList.toggle("mode-inner", mode === "inner");
}

function layoutLabels(s, cam, w, h, pointer) {
  const items = s.labels;
  if (items.length === 0) {
    return;
  }
  const dockF = smooth(clamp01((s.dock - 0.7) / 0.25));
  if (dockF < 0.01 || s.explode < 0.02 || !s.slot || w < 900) {
    items.forEach(hideItem);
    items.sheet.style.opacity = "0";
    items.sheet.style.pointerEvents = "none";
    items.figs.style.opacity = "0";
    items.figs.style.pointerEvents = "none";
    s.box.visible = false;
    return;
  }
  const reveal = s.rig.reveal;
  let mode = "outer";
  if (reveal > 0.5) {
    mode = "inner";
  }
  const pool = items.filter((it) => it.sub === (mode === "inner"));
  const fi = Math.min(pool.length - 1, items.pick[mode]);
  setFocus(items, mode, fi);
  const sheetO = dockF * smooth(clamp01((s.explode - 0.3) / 0.4));
  items.sheet.style.opacity = String(sheetO);
  let sheetPE = "none";
  if (sheetO > 0.5) {
    sheetPE = "auto";
  }
  items.sheet.style.pointerEvents = sheetPE;
  items.figs.style.opacity = String(sheetO);
  items.figs.style.pointerEvents = sheetPE;
  const figBottom = items.figs.offsetTop + items.figs.offsetHeight + 28;
  const sheetRight = items.sheet.offsetLeft + items.sheet.offsetWidth;
  const bb = s.rig.box;
  const grow = 1.6 * s.explode;
  let minX = 1e9;
  let maxX = -1e9;
  for (let i = 0; i < 8; i = i + 1) {
    LABEL_C.set(bb.min.x - grow, bb.min.y - grow, bb.min.z - grow);
    if (i & 1) {
      LABEL_C.x = bb.max.x + grow;
    }
    if (i & 2) {
      LABEL_C.y = bb.max.y + grow;
    }
    if (i & 4) {
      LABEL_C.z = bb.max.z + grow;
    }
    s.rig.root.localToWorld(LABEL_C);
    LABEL_C.project(cam);
    const px = ((LABEL_C.x + 1) / 2) * w;
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
  }
  const colW = 176;
  const leftX = Math.max(minX - 30, sheetRight + colW + 28);
  const rightX = Math.min(maxX + 30, w - colW - 30);
  const live = [];
  let focusItem = null;
  items.forEach((it) => {
    let o = 0;
    if (it.sub) {
      o = smooth(clamp01((reveal - 0.5) / 0.4));
    } else {
      o = smooth(clamp01((it.part.k - 0.7) / 0.3)) * (1 - smooth(clamp01(reveal / 0.6)));
    }
    o = o * dockF;
    if (o < 0.01) {
      hideItem(it);
      return;
    }
    LABEL_P.copy(it.anchor);
    it.part.group.localToWorld(LABEL_P);
    if (it.el.classList.contains("focus")) {
      focusItem = { it: it, world: LABEL_P.clone() };
    }
    LABEL_P.project(cam);
    live.push({ it: it, sx: ((LABEL_P.x + 1) / 2) * w, sy: ((1 - LABEL_P.y) / 2) * h, o: o });
  });
  [false, true].forEach((isSub) => {
    const order = live.filter((p) => p.it.sub === isSub).sort((a, b) => a.sx - b.sx);
    const half = Math.ceil(order.length / 2);
    order.forEach((p, i) => {
      if (p.it.side === 0) {
        if (i < half) {
          p.it.side = -1;
        } else {
          p.it.side = 1;
        }
      }
    });
  });
  [-1, 1].forEach((side) => {
    const botY = h - 120;
    const group = live.filter((p) => p.it.side === side).sort((a, b) => a.sy - b.sy);
    if (group.length === 0) {
      return;
    }
    let topY = 92;
    if (side > 0) {
      topY = Math.min(figBottom, h * 0.45);
    }
    const fit = (botY - topY) / Math.max(1, group.length - 1);
    const gap = Math.min(64, Math.max(32, fit));
    let prev = -1e9;
    group.forEach((p) => {
      let y = Math.min(Math.max(p.sy, topY), botY);
      if (y < prev + gap) {
        y = prev + gap;
      }
      prev = y;
      p.ty = y;
    });
    const over = group[group.length - 1].ty - botY;
    if (over > 0) {
      group.forEach((p) => {
        p.ty = Math.max(topY, p.ty - over);
      });
    }
  });
  live.forEach((p) => {
    const it = p.it;
    if (it.ty === null) {
      it.ty = p.ty;
    } else {
      it.ty = it.ty + (p.ty - it.ty) * 0.22;
    }
    let tx = rightX;
    if (it.side < 0) {
      tx = leftX;
    }
    const ex = tx - it.side * 30;
    const ty = it.ty;
    it.lead.setAttribute("d", "M" + p.sx.toFixed(1) + " " + p.sy.toFixed(1) + " L" + ex.toFixed(1) + " " + ty.toFixed(1) + " L" + tx.toFixed(1) + " " + ty.toFixed(1));
    it.ring.setAttribute("cx", p.sx.toFixed(1));
    it.ring.setAttribute("cy", p.sy.toFixed(1));
    it.core.setAttribute("cx", p.sx.toFixed(1));
    it.core.setAttribute("cy", p.sy.toFixed(1));
    it.tick.setAttribute("x", (tx - 2.5).toFixed(1));
    it.tick.setAttribute("y", (ty - 2.5).toFixed(1));
    it.g.style.opacity = String(p.o);
    it.el.style.opacity = String(p.o);
    let shift = "translate(10px,-50%)";
    if (it.side < 0) {
      shift = "translate(calc(-100% - 10px),-50%)";
      it.el.classList.add("left");
    } else {
      it.el.classList.remove("left");
    }
    it.el.style.transform = "translate(" + tx.toFixed(1) + "px," + ty.toFixed(1) + "px) " + shift;
    it.shown = true;
    setLive(it, p.o > 0.5);
  });
  pickAt(s, cam, pointer, live, mode, w, h);
  if (focusItem) {
    if (focusItem.it.sub) {
      s.rig.root.getWorldScale(BOX_S);
      const side = 0.5 * BOX_S.x;
      s.box.box.setFromCenterAndSize(focusItem.world, BOX_S.set(side, side, side));
    } else {
      s.box.box.setFromObject(focusItem.it.part.group);
    }
    s.box.visible = true;
  } else {
    s.box.visible = false;
  }
}

export async function createEarthScene(canvas, options) {
  const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(options.dpr || 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const cam = new THREE.PerspectiveCamera(FOV, 16 / 10, 0.1, 3000);
  const viewDir = llToVec(14, 77, 1).normalize();

  scene.environment = envTex;
  const textures = await Promise.all(["/textures/earth-blue-marble.jpg", "/textures/earth-night.jpg", "/textures/earth-water.png"].map(loadTex));
  const labelLayer = options.labelLayer || null;

  const sunCam = new THREE.Vector3(0.62, 0.3, -1).normalize();
  const sun = new THREE.Vector3();
  const globe = new THREE.Group();
  scene.add(globe);
  const earthMat = new THREE.ShaderMaterial({
    uniforms: { day: { value: textures[0] }, night: { value: textures[1] }, water: { value: textures[2] }, sun: { value: sun }, camPos: { value: new THREE.Vector3() }, cloudT: { value: 0 } },
    vertexShader: EARTH_VS,
    fragmentShader: EARTH_FS,
  });
  globe.add(new THREE.Mesh(new THREE.SphereGeometry(EARTH_R, 192, 128), earthMat));
  const outer = new THREE.ShaderMaterial({ uniforms: { sun: { value: sun }, camPos: { value: new THREE.Vector3() }, uPow: { value: 2.2 } }, vertexShader: EARTH_VS, fragmentShader: ATMO_FS, transparent: true, blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false });
  const inner = new THREE.ShaderMaterial({ uniforms: { sun: { value: sun }, camPos: { value: new THREE.Vector3() }, uPow: { value: 7.0 } }, vertexShader: EARTH_VS, fragmentShader: ATMO_FS, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(10.35, 128, 96), outer));
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(10.06, 128, 96), inner));

  const starGeo = new THREE.BufferGeometry();
  const starPos = [];
  for (let i = 0; i < 4000; i = i + 1) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(900 + Math.random() * 400);
    starPos.push(v.x, v.y, v.z);
  }
  starGeo.setAttribute("position", new THREE.Float32BufferAttribute(starPos, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xaab8d8, size: 0.9, sizeAttenuation: false, transparent: true, opacity: 0.7 })));

  const fireMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: fireSprite() }, time: { value: 0 }, scale: { value: 1 } },
    vertexShader: "attribute float phase; attribute vec3 color; varying vec3 vC; varying float vA; uniform float time; uniform float scale; void main(){ vC=color; float p=0.5+0.5*sin(time*2.2+phase); vA=0.55+0.45*p; vec4 mv=modelViewMatrix*vec4(position,1.); gl_PointSize=scale*(6.5+5.0*p)/(-mv.z)*12.0; gl_Position=projectionMatrix*mv; }",
    fragmentShader: "uniform sampler2D map; varying vec3 vC; varying float vA; void main(){ vec4 t=texture2D(map,gl_PointCoord); gl_FragColor=vec4(vC*vA*1.4, t.a*vA); }",
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  let firePoints = null;
  function setFires(list) {
    if (firePoints) {
      globe.remove(firePoints);
      firePoints.geometry.dispose();
    }
    if (!list || list.length === 0) {
      firePoints = null;
      return;
    }
    const g = new THREE.BufferGeometry();
    const pos = [];
    const col = [];
    const c = new THREE.Color();
    list.forEach((f) => {
      const v = llToVec(f.lat, f.lon, 10.03);
      pos.push(v.x, v.y, v.z);
      c.set(f.color || "#ff7a3d");
      col.push(c.r, c.g, c.b);
    });
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    const phase = [];
    for (let i = 0; i < list.length; i = i + 1) {
      phase.push(Math.random() * 6.283);
    }
    g.setAttribute("phase", new THREE.Float32BufferAttribute(phase, 1));
    firePoints = new THREE.Points(g, fireMat);
    globe.add(firePoints);
  }
  setFires(options.fires);

  scene.add(new THREE.AmbientLight(0x223355, 0.4));
  const key = new THREE.DirectionalLight(0xfff4e0, 3.2);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffe2b0, 2.0);
  scene.add(fill);

  const fleet = SATS.map((def, index) => {
    const basis = orbitBasis(def.inc, def.raan);
    const ring = [];
    for (let i = 0; i <= 360; i = i + 1) {
      const a = (i * Math.PI) / 180;
      ring.push(basis.u.clone().multiplyScalar(def.radius * Math.cos(a)).add(basis.v.clone().multiplyScalar(def.radius * Math.sin(a))));
    }
    let lineMat = new THREE.LineBasicMaterial({ color: def.color, transparent: true, opacity: 0.45 });
    if (def.decor) {
      lineMat = new THREE.LineBasicMaterial({ color: 0xbfd8f0, transparent: true, opacity: 0.13, depthWrite: false });
    }
    if (def.dashed) {
      lineMat = new THREE.LineDashedMaterial({ color: def.color, dashSize: 0.12, gapSize: 0.22, transparent: true, opacity: 0.6 });
    }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ring), lineMat);
    if (def.dashed) {
      line.computeLineDistances();
    }
    scene.add(line);
    const swath = makeSwath(def.color);
    scene.add(swath.mesh);
    const box = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color(def.color));
    box.material.depthTest = false;
    box.material.transparent = true;
    box.material.opacity = 0.9;
    box.renderOrder = 20;
    box.visible = false;
    scene.add(box);
    const rig = def.build();
    rig.box = new THREE.Box3().setFromObject(rig.root);
    const main = rig.parts.find((p) => p.main);
    const focus = { part: main, center: new THREE.Box3().setFromObject(main.group).getCenter(new THREE.Vector3()) };
    const model = normaliseModel(rig.root);
    const pivot = new THREE.Group();
    pivot.add(model);
    scene.add(pivot);
    let labels = [];
    if (!def.decor) {
      labels = makeLabels(rig, def, labelLayer);
    }
    return { def: def, basis: basis, line: line, lineMat: lineMat, model: model, rig: rig, pivot: pivot, angle: def.phase, dock: 0, explode: 0, reveal: 0, slot: null, labels: labels, index: index, focus: focus, swath: swath, box: box };
  });

  ACTIVE_FLEET = fleet;
  const tmp = { up: new THREE.Vector3(), x: new THREE.Vector3(), z: new THREE.Vector3(), m: new THREE.Matrix4(), qa: new THREE.Quaternion(), qb: new THREE.Quaternion(), p: new THREE.Vector3(), h: new THREE.Vector3(), e: new THREE.Euler() };
  const yAxis = new THREE.Vector3(0, 1, 0);
  const st = { w: 1, h: 1, p: 0, target: 0, time: 0, auto: true, anchors: [0, 0.15, 0.33, 0.5, 0.62, 0.8, 1] };
  const pointer = { x: -1, y: -1, moved: false };
  const intro = { on: false, t: 0, dur: 6.2, speed: 1 };
  const introP0 = new THREE.Vector3();
  const introT0 = new THREE.Vector3();
  const introP1 = new THREE.Vector3();
  const introUp = new THREE.Vector3();
  const introSide = new THREE.Vector3();

  function sampleView(p) {
    const A = st.anchors;
    if (p <= A[0]) {
      return VIEWS[0];
    }
    if (p >= A[A.length - 1]) {
      return VIEWS[VIEWS.length - 1];
    }
    let i = 0;
    for (let k = 0; k < A.length - 1; k = k + 1) {
      if (p >= A[k] && p <= A[k + 1]) {
        i = k;
      }
    }
    const a = VIEWS[i];
    const b = VIEWS[i + 1];
    let t = 0;
    if (A[i + 1] > A[i]) {
      t = smooth(clamp01((p - A[i]) / (A[i + 1] - A[i])));
    }
    return { cx: a.cx + (b.cx - a.cx) * t, cy: a.cy + (b.cy - a.cy) * t, r: a.r + (b.r - a.r) * t, yaw: a.yaw + (b.yaw - a.yaw) * t };
  }

  function placeCamera(view) {
    const tanHalf = Math.tan(((FOV / 2) * Math.PI) / 180);
    const alpha = Math.atan(2 * view.r * tanHalf);
    const dist = EARTH_R / Math.sin(alpha);
    cam.position.copy(viewDir).multiplyScalar(dist);
    cam.up.set(0, 1, 0);
    cam.lookAt(0, 0, 0);
    cam.aspect = st.w / st.h;
    cam.setViewOffset(st.w, st.h, st.w / 2 - view.cx * st.w, st.h / 2 - view.cy * st.h, st.w, st.h);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    sun.copy(sunCam).applyQuaternion(cam.quaternion).normalize();
    key.position.copy(sun).multiplyScalar(100);
    fill.position.copy(cam.position).multiplyScalar(3).add(new THREE.Vector3(0, 20, 0));
    earthMat.uniforms.camPos.value.copy(cam.position);
    outer.uniforms.camPos.value.copy(cam.position);
    inner.uniforms.camPos.value.copy(cam.position);
    return dist;
  }

  function orbitPose(s) {
    const b = s.basis;
    const r = s.def.radius;
    tmp.p.copy(b.u).multiplyScalar(r * Math.cos(s.angle)).addScaledVector(b.v, r * Math.sin(s.angle));
    tmp.up.copy(tmp.p).normalize();
    tmp.x.crossVectors(tmp.up, sun);
    if (tmp.x.lengthSq() < 1e-6) {
      tmp.x.set(1, 0, 0);
    }
    tmp.x.normalize();
    tmp.z.crossVectors(tmp.x, tmp.up).normalize();
    tmp.m.makeBasis(tmp.x, tmp.up, tmp.z);
    tmp.qa.setFromRotationMatrix(tmp.m);
  }

  function heroPose(s, camDist) {
    const slot = s.slot;
    const depth = Math.max(8, (camDist - EARTH_R) * 0.55);
    const ndcX = slot.x * 2 - 1;
    const ndcY = -(slot.y * 2 - 1);
    tmp.h.set(ndcX, ndcY, 0.5).unproject(cam).sub(cam.position).normalize();
    const dist = depth / Math.max(0.2, tmp.h.dot(new THREE.Vector3().copy(cam.position).negate().normalize()));
    tmp.h.multiplyScalar(dist).add(cam.position);
    const visH = 2 * depth * Math.tan(((FOV / 2) * Math.PI) / 180);
    const wantSpan = Math.min(slot.w * visH * (st.w / st.h), slot.h * visH) * 0.82;
    const scale = wantSpan / SAT_SPAN;
    const wob = Math.sin(st.time * 0.5 + s.def.phase) * 0.12 * (1 - smooth(clamp01(s.explode * 3)));
    tmp.e.set(s.def.pose[0] + wob * 0.5, s.def.pose[1] + wob + s.explode * 0.5, s.def.pose[2], "XYZ");
    tmp.qb.setFromEuler(tmp.e).premultiply(cam.quaternion);
    return scale * (1 - 0.08 * s.explode);
  }

  function placeFleet(camDist) {
    fleet.forEach((s) => {
      orbitPose(s);
      const orbitPos = tmp.p.clone();
      let scale = 0.075;
      let dock = s.dock;
      if (!s.slot) {
        dock = 0;
      }
      if (dock > 0.001) {
        const heroScale = heroPose(s, camDist);
        const e = smooth(dock);
        s.pivot.position.copy(orbitPos).lerp(tmp.h, e);
        s.pivot.quaternion.copy(tmp.qa).slerp(tmp.qb, e);
        scale = 0.075 + (heroScale - 0.075) * e;
        const arc = Math.sin(e * Math.PI) * 3;
        s.pivot.position.addScaledVector(orbitPos.clone().normalize(), arc);
      } else {
        s.pivot.position.copy(orbitPos);
        s.pivot.quaternion.copy(tmp.qa);
      }
      const zoom = smooth(s.rig.reveal) * smooth(dock);
      if (zoom > 0.001) {
        const root = s.rig.root;
        tmp.h.copy(s.focus.center).addScaledVector(s.focus.part.dir, s.focus.part.k).multiplyScalar(root.scale.x).add(root.position);
        s.model.position.copy(tmp.h).multiplyScalar(-zoom);
        scale = scale * (1 + 2.3 * zoom);
      } else {
        s.model.position.set(0, 0, 0);
      }
      s.pivot.scale.setScalar(scale);
      if (s.def.decor) {
        s.lineMat.opacity = 0.13;
        updateSwath(s, 0);
      } else {
        s.lineMat.opacity = (0.55 - 0.3 * dock);
        updateSwath(s, 1 - smooth(clamp01(dock * 2)));
      }
    });
  }

  function applyIntro(view) {
    const k = smooth(clamp01(intro.t / intro.dur));
    const near = 1 - smooth(clamp01((intro.t - 3.6) / (intro.dur - 3.6)));
    const s = fleet[fleet.length - 1];
    orbitPose(s);
    introUp.copy(tmp.p).normalize();
    introSide.crossVectors(introUp, viewDir).normalize();
    introP0.copy(tmp.p).addScaledVector(introUp, 2.3).addScaledVector(introSide, -3.0).addScaledVector(viewDir, 2.2);
    introT0.copy(tmp.p).addScaledVector(introUp, -1.6).addScaledVector(introSide, -0.9);
    introP1.copy(cam.position);
    const m = 1 - near;
    cam.position.lerpVectors(introP0, introP1, m);
    const target = introT0.clone().lerp(new THREE.Vector3(0, 0, 0), m);
    cam.up.set(0, 1, 0);
    cam.lookAt(target);
    cam.setViewOffset(st.w, st.h, (st.w / 2 - view.cx * st.w) * m, (st.h / 2 - view.cy * st.h) * m, st.w, st.h);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    earthMat.uniforms.camPos.value.copy(cam.position);
    outer.uniforms.camPos.value.copy(cam.position);
    inner.uniforms.camPos.value.copy(cam.position);
    return k;
  }

  function startIntro() {
    intro.on = true;
    intro.t = 0;
    intro.speed = 1;
  }

  function skipIntro() {
    intro.speed = 5;
  }

  function setClock(t) {
    st.time = t;
  }

  function setSize(w, h) {
    st.w = Math.max(1, w);
    st.h = Math.max(1, h);
    renderer.setSize(st.w, st.h, false);
  }

  function setScroll(p) {
    st.target = clamp01(p);
  }

  function setAnchors(list) {
    if (list && list.length === VIEWS.length) {
      st.anchors = list;
    }
  }

  function setSlots(slots) {
    fleet.forEach((s) => {
      const slot = slots[s.def.id];
      if (slot) {
        s.slot = slot;
        s.targetDock = slot.e;
        s.targetExplode = slot.explode || 0;
        s.targetReveal = slot.reveal || 0;
      } else {
        s.slot = null;
        s.targetDock = 0;
        s.targetExplode = 0;
        s.targetReveal = 0;
      }
    });
  }

  function setPointer(x, y) {
    pointer.x = x;
    pointer.y = y;
    pointer.moved = true;
  }

  function getDock() {
    const out = {};
    fleet.forEach((s) => {
      out[s.def.id] = s.dock;
    });
    return out;
  }

  function setAuto(on) {
    st.auto = on;
  }

  function frame(dt, jump) {
    const step = Math.min(dt, 0.1);
    const k = 1 - Math.exp(-step / 0.35);
    if (jump) {
      st.p = st.target;
    } else {
      st.p = st.p + (st.target - st.p) * k;
    }
    fleet.forEach((s) => {
      const target = s.targetDock || 0;
      const targetX = s.targetExplode || 0;
      if (jump) {
        s.dock = target;
        s.explode = targetX;
        s.reveal = s.targetReveal || 0;
      } else {
        s.dock = s.dock + (target - s.dock) * (1 - Math.exp(-step / 0.18));
        s.explode = s.explode + (targetX - s.explode) * (1 - Math.exp(-step / 0.22));
        s.reveal = s.reveal + ((s.targetReveal || 0) - s.reveal) * (1 - Math.exp(-step / 0.25));
      }
      s.rig.update(s.explode, st.time, s.reveal);
      if (st.auto && s.dock < 0.98) {
        s.angle = s.angle + ((step * 2 * Math.PI) / s.def.period) * (1 - s.dock);
      }
    });
    if (st.auto) {
      st.time = st.time + step;
    }
    const view = sampleView(st.p);
    const spin = (st.time * SPIN_DEG_S * Math.PI) / 180;
    globe.quaternion.setFromAxisAngle(yAxis, spin + view.yaw);
    earthMat.uniforms.cloudT.value = st.time * 0.012;
    fireMat.uniforms.time.value = st.time;
    fireMat.uniforms.scale.value = renderer.getPixelRatio();
    const camDist = placeCamera(view);
    placeFleet(camDist);
    if (intro.on) {
      intro.t = intro.t + step * intro.speed;
      applyIntro(view);
      if (intro.t >= intro.dur) {
        intro.on = false;
      }
    }
    scene.updateMatrixWorld(true);
    fleet.forEach((s) => layoutLabels(s, cam, st.w, st.h, pointer));
    pointer.moved = false;
    renderer.render(scene, cam);
  }

  function dispose() {
    if (ACTIVE_FLEET === fleet) {
      ACTIVE_FLEET = null;
    }
    renderer.dispose();
    pmrem.dispose();
    fleet.forEach((s) => {
      s.labels.forEach((it) => it.el.remove());
      if (s.labels.svg) {
        s.labels.svg.remove();
      }
      if (s.labels.sheet) {
        s.labels.sheet.remove();
        s.labels.figs.remove();
      }
    });
  }

  return { frame: frame, setSize: setSize, setScroll: setScroll, setAnchors: setAnchors, setSlots: setSlots, getDock: getDock, setAuto: setAuto, setFires: setFires, setPointer: setPointer, startIntro: startIntro, skipIntro: skipIntro, setClock: setClock, dispose: dispose };
}
