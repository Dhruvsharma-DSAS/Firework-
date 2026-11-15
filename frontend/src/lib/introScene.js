import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { buildSuomiNPP } from "./satModels.js";
import { EARTH_VS, EARTH_FS, ATMO_FS, VIEWS, llToVec, SAT_SPAN, activeSatPose } from "./earth3d.js";

const FOV = 38;
const EARTH_R = 10;
const SPIN = (1.1 * Math.PI) / 180;
export const INTRO_END = 6.2;

function loadTex(url) {
  return new Promise((resolve) => {
    new THREE.TextureLoader().load(url, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      resolve(t);
    }, undefined, () => resolve(null));
  });
}

function ease(t) {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

export async function createIntroScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const cam = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.05, 3000);
  const tex = await Promise.all(["/textures/earth-blue-marble.jpg", "/textures/earth-night.jpg", "/textures/earth-water.png"].map(loadTex));

  const viewDir = llToVec(14, 77, 1).normalize();
  const up = new THREE.Vector3(0, 1, 0).addScaledVector(viewDir, -viewDir.y).normalize();
  const right = new THREE.Vector3().crossVectors(up, viewDir).normalize();
  const sunCam = new THREE.Vector3(0.62, 0.3, -1).normalize();
  const sun = new THREE.Vector3();

  const globe = new THREE.Group();
  scene.add(globe);
  const mat = new THREE.ShaderMaterial({
    uniforms: { day: { value: tex[0] }, night: { value: tex[1] }, water: { value: tex[2] }, sun: { value: sun }, camPos: { value: new THREE.Vector3() }, cloudT: { value: 0 } },
    vertexShader: EARTH_VS,
    fragmentShader: EARTH_FS,
  });
  globe.add(new THREE.Mesh(new THREE.SphereGeometry(EARTH_R, 192, 128), mat));
  const outer = new THREE.ShaderMaterial({ uniforms: { sun: { value: sun }, camPos: { value: new THREE.Vector3() }, uPow: { value: 2.2 } }, vertexShader: EARTH_VS, fragmentShader: ATMO_FS, transparent: true, blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false });
  const inner = new THREE.ShaderMaterial({ uniforms: { sun: { value: sun }, camPos: { value: new THREE.Vector3() }, uPow: { value: 7.0 } }, vertexShader: EARTH_VS, fragmentShader: ATMO_FS, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(10.35, 128, 96), outer));
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(10.06, 128, 96), inner));

  const starGeo = new THREE.BufferGeometry();
  const sp = [];
  for (let i = 0; i < 4000; i = i + 1) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(900 + Math.random() * 400);
    sp.push(v.x, v.y, v.z);
  }
  starGeo.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xaab8d8, size: 0.9, sizeAttenuation: false, transparent: true, opacity: 0.7 })));

  scene.add(new THREE.AmbientLight(0x404a60, 0.6));
  const key = new THREE.DirectionalLight(0xfff1dc, 2.6);
  scene.add(key);

  const rig = buildSuomiNPP();
  const box = new THREE.Box3().setFromObject(rig.root);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  const k = SAT_SPAN / Math.max(size.x, size.y, size.z);
  rig.root.position.copy(center).multiplyScalar(-k);
  rig.root.scale.setScalar(k);
  const sat = new THREE.Group();
  sat.add(rig.root);
  scene.add(sat);
  const BASE = 2.2 / SAT_SPAN;
  const introQ = new THREE.Quaternion();

  const beamMat = new THREE.MeshBasicMaterial({ color: 0x3dd6f5, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const beam = new THREE.Mesh(new THREE.ConeGeometry(0.75, 6, 32, 1, true), beamMat);
  scene.add(beam);

  const st = { w: 1, h: 1 };
  const hero = VIEWS[0];

  function local(x, y, z) {
    return new THREE.Vector3().addScaledVector(right, x).addScaledVector(up, y).addScaledVector(viewDir, z);
  }

  function satAt(u) {
    return local(13.1 - u * 5.2, 9.6 + u * 0.6, 5.2 - u * 0.6);
  }

  const motion = satAt(1).sub(satAt(0)).normalize();
  const SW = 2.2;
  const pPos = [];
  const pU = [];
  const pHot = [];
  let seed = 11;
  function rnd() {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  }
  for (let i = 0; i <= 90; i = i + 1) {
    const u = i / 90;
    const g = satAt(u).normalize();
    const across = new THREE.Vector3().crossVectors(motion, g).normalize();
    for (let j = -10; j <= 10; j = j + 1) {
      const a = j / 10;
      const q = g.clone().multiplyScalar(EARTH_R).addScaledVector(across, a * SW * (1 + Math.abs(a) * 0.35)).normalize().multiplyScalar(EARTH_R * 1.004);
      pPos.push(q.x, q.y, q.z);
      pU.push(u);
      let hot = 0;
      if (rnd() < 0.06) {
        hot = 1;
      }
      pHot.push(hot);
    }
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute("position", new THREE.Float32BufferAttribute(pPos, 3));
  pGeo.setAttribute("u", new THREE.Float32BufferAttribute(pU, 1));
  pGeo.setAttribute("hot", new THREE.Float32BufferAttribute(pHot, 1));
  const pMat = new THREE.ShaderMaterial({
    uniforms: { now: { value: -1 }, fade: { value: 1 }, px: { value: 1 } },
    vertexShader: "attribute float u; attribute float hot; uniform float now; uniform float px; varying float vA; varying float vH; void main(){ vH=hot; float on=step(u,now); float age=max(0.,now-u); vA=on*mix(0.55*exp(-age*7.)+0.1, 1.0, hot); vec4 mv=modelViewMatrix*vec4(position,1.); gl_PointSize=px*mix(5.0,11.0,hot)*(18.0/-mv.z); gl_Position=projectionMatrix*mv; }",
    fragmentShader: "uniform float fade; varying float vA; varying float vH; void main(){ vec2 c=gl_PointCoord-0.5; float sq=step(max(abs(c.x),abs(c.y)),0.42); float glow=exp(-dot(c,c)*14.); vec3 col=mix(vec3(0.24,0.84,0.96), vec3(1.0,0.45,0.2)+vec3(0.6,0.5,0.2)*glow, vH); float a=mix(sq*0.8, glow*1.2+sq*0.4, vH); gl_FragColor=vec4(col, a*vA*fade); }",
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pixels = new THREE.Points(pGeo, pMat);
  scene.add(pixels);

  const fanGeo = new THREE.BufferGeometry();
  fanGeo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(9), 3));
  const fanMat = new THREE.MeshBasicMaterial({ color: 0x3dd6f5, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const fan = new THREE.Mesh(fanGeo, fanMat);
  scene.add(fan);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(6), 3));
  const lineMat = new THREE.LineBasicMaterial({ color: 0xbff4ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending });
  const scanLine = new THREE.Line(lineGeo, lineMat);
  scene.add(scanLine);
  const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 });
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 12), dotMat);
  scene.add(dot);

  function setSize(w, h) {
    st.w = Math.max(1, w);
    st.h = Math.max(1, h);
    renderer.setSize(st.w, st.h, false);
  }

  function frame(t) {
    const pass = ease(t / 4.4);
    const land = ease((t - 3.8) / (INTRO_END - 3.8));
    const satPos = local(13.1 - pass * 5.2, 9.6 + pass * 0.6, 5.2 - pass * 0.6);
    const away = ease((t - 3.8) / (INTRO_END - 3.8));
    sat.position.copy(satPos);
    sat.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, viewDir));
    sat.rotateX(0.35);
    sat.rotateY(-0.6 + pass * 0.5);
    sat.rotateZ(0.15);
    sat.scale.setScalar(BASE);
    const home = activeSatPose("viirs");
    if (home && away > 0) {
      introQ.copy(sat.quaternion);
      const ra = satPos.length();
      const rb = home.pos.length();
      const ua = satPos.clone().normalize();
      const ub = home.pos.clone().normalize();
      const arc = new THREE.Quaternion().slerp(new THREE.Quaternion().setFromUnitVectors(ua, ub), away);
      const r = Math.max(EARTH_R + 1.2, ra + (rb - ra) * away + Math.sin(away * Math.PI) * 1.2);
      sat.position.copy(ua).applyQuaternion(arc).multiplyScalar(r);
      sat.quaternion.copy(introQ).slerp(home.quat, away);
      sat.scale.setScalar(BASE + (home.scale - BASE) * away);
    }
    rig.update(0, t, 0);
    const down = sat.position.clone().negate().normalize();
    beam.position.copy(sat.position).addScaledVector(down, 3.1);
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), down);
    beamMat.opacity = 0;
    const scanOn = ease((t - 0.5) / 0.6) * (1 - ease(away * 2.2));
    const g = satAt(pass).normalize();
    const across = new THREE.Vector3().crossVectors(motion, g).normalize();
    const base = g.clone().multiplyScalar(EARTH_R * 1.005);
    const left = base.clone().addScaledVector(across, -SW * 1.35).normalize().multiplyScalar(EARTH_R * 1.005);
    const rightP = base.clone().addScaledVector(across, SW * 1.35).normalize().multiplyScalar(EARTH_R * 1.005);
    const fp = fanGeo.attributes.position;
    fp.setXYZ(0, sat.position.x, sat.position.y, sat.position.z);
    fp.setXYZ(1, left.x, left.y, left.z);
    fp.setXYZ(2, rightP.x, rightP.y, rightP.z);
    fp.needsUpdate = true;
    fanMat.opacity = 0.07 * scanOn;
    const lp = lineGeo.attributes.position;
    lp.setXYZ(0, left.x, left.y, left.z);
    lp.setXYZ(1, rightP.x, rightP.y, rightP.z);
    lp.needsUpdate = true;
    lineMat.opacity = 0.9 * scanOn;
    const sw = Math.sin(t * 7.5);
    dot.position.copy(base).addScaledVector(across, sw * SW * 1.3).normalize().multiplyScalar(EARTH_R * 1.006);
    dotMat.opacity = scanOn;
    pMat.uniforms.now.value = pass - 0.004;
    pMat.uniforms.fade.value = 1 - land;
    pMat.uniforms.px.value = renderer.getPixelRatio();

    const push = ease((t - 2.6) / 1.6) * (1 - land);
    const p0 = local(7.5, 9.4, 15.5).lerp(satPos.clone().add(local(1.4, 0.6, 4.6)), push * 0.7);
    const t0 = local(6, 7, 2).lerp(satPos.clone().add(local(-2.2, -0.5, 0)), push * 0.6);
    const tanHalf = Math.tan(((FOV / 2) * Math.PI) / 180);
    const dist = EARTH_R / Math.sin(Math.atan(2 * hero.r * tanHalf));
    const p1 = viewDir.clone().multiplyScalar(dist);
    cam.position.copy(p0).lerp(p1, land);
    cam.up.set(0, 1, 0);
    cam.lookAt(t0.lerp(new THREE.Vector3(0, 0, 0), land));
    cam.aspect = st.w / st.h;
    cam.setViewOffset(st.w, st.h, (st.w / 2 - hero.cx * st.w) * land, (st.h / 2 - hero.cy * st.h) * land, st.w, st.h);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    sun.copy(sunCam).applyQuaternion(cam.quaternion).normalize();
    key.position.copy(sun).multiplyScalar(100);

    globe.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t * SPIN + hero.yaw);
    mat.uniforms.cloudT.value = t * 0.012;
    mat.uniforms.camPos.value.copy(cam.position);
    outer.uniforms.camPos.value.copy(cam.position);
    inner.uniforms.camPos.value.copy(cam.position);
    renderer.render(scene, cam);
  }

  function dispose() {
    renderer.dispose();
    pmrem.dispose();
  }

  return { frame: frame, setSize: setSize, dispose: dispose };
}
