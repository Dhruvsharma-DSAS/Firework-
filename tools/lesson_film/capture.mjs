import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const OUT = join(ROOT, "frontend", "public", "learn", "tour");
const WORK = join(ROOT, ".film_work");
const SITE = process.env.TOUR_SITE || "http://localhost:5173";
const W = 1440;
const H = 900;
const PORT = 9351;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const clickText = (sel, t) => "(() => { const b = [...document.querySelectorAll(" + JSON.stringify(sel) + ")].find((x) => x.textContent.includes(" + JSON.stringify(t) + ")); if (b) b.click(); return !!b; })()";
const scrollTo = (sel) => "(() => { const e = document.querySelector(" + JSON.stringify(sel) + "); if (e) { e.scrollIntoView({ block: 'start', behavior: 'instant' }); window.scrollBy(0, -80); } return !!e; })()";
const clickGlobe = "(() => { const c = document.querySelector('#explorer-globe canvas'); if (!c) return false; const r = c.getBoundingClientRect(); const o = { bubbles: true, clientX: r.left + r.width * 0.52, clientY: r.top + r.height * 0.42, button: 0 }; c.dispatchEvent(new PointerEvent('pointerdown', o)); c.dispatchEvent(new MouseEvent('mousedown', o)); c.dispatchEvent(new PointerEvent('pointerup', o)); c.dispatchEvent(new MouseEvent('mouseup', o)); c.dispatchEvent(new MouseEvent('click', o)); return true; })()";

const SHOTS = [
  { id: "home", url: "/", wait: 14000, pre: ["window.dispatchEvent(new Event('intro-skip'))"], waitAfterPre: 4000 },
  { id: "home-2", url: null, pre: ["window.scrollTo(0, 900)"], wait: 1500 },
  { id: "home-3", url: null, pre: ["window.scrollTo(0, 1900)"], wait: 1500 },
  { id: "explore", url: "/explore", wait: 3000, until: "!document.querySelector('.ftrack') && document.querySelectorAll('.kpi.scan').length === 0", pre: [scrollTo(".ex-head")], waitAfterPre: 4000 },
  { id: "explore-globe", url: null, pre: [scrollTo(".ex-work")], wait: 1500 },
  { id: "explore-probe", url: null, pre: [clickGlobe], wait: 2500 },
  { id: "explore-cells", url: null, pre: ["document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))", clickText(".ex-view button", "Cells")], wait: 3500 },
  { id: "explore-map", url: null, pre: [clickText(".ex-view button", "Map")], wait: 3000 },
  { id: "explore-strip", url: null, pre: [clickText(".ex-view button", "Columns"), scrollTo(".ex-strip")], wait: 2000 },
  { id: "explore-analysis", url: null, pre: [scrollTo(".ex-section")], wait: 2000 },
  { id: "calendar", url: "/calendar/punjab_haryana", wait: 9000 },
  { id: "sensors", url: "/sensors", wait: 9000 },
  { id: "sources", url: "/sources", wait: 9000 },
  { id: "blindspot", url: "/blind-spot", wait: 9000 },
  { id: "validation", url: "/validation", wait: 8000 },
  { id: "formulas", url: "/formulas", wait: 7000 },
  { id: "health", url: "/sources/health", wait: 8000 },
  { id: "studio", url: "/studio", wait: 7000 },
  { id: "workspace", url: "/me", wait: 6000 },
  { id: "brief", url: "/brief/punjab_haryana", wait: 8000 },
  { id: "learn", url: "/learn", wait: 8000 },
  { id: "chat", url: "/explore", wait: 3000, until: "!document.querySelector('.ftrack')", pre: [clickText("button", "Ask Chronos")], waitAfterPre: 2500 },
];

async function launch() {
  const prof = join(WORK, "chrome-capture");
  rmSync(prof, { recursive: true, force: true });
  const proc = spawn(CHROME, ["--headless=new", "--remote-debugging-port=" + PORT, "--user-data-dir=" + prof, "--window-size=" + W + "," + H, "--hide-scrollbars", "--mute-audio", "--no-first-run", "--enable-webgl", "--ignore-gpu-blocklist", "--use-angle=metal", "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch("http://127.0.0.1:" + PORT + "/json/version"); if (r.ok) return proc; } catch (e) {}
    await sleep(200);
  }
  throw new Error("chrome did not start");
}

async function connect() {
  const r = await fetch("http://127.0.0.1:" + PORT + "/json/new?about:blank", { method: "PUT" });
  const t = await r.json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res) => ws.addEventListener("open", res));
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (ev) => { const msg = JSON.parse(ev.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } });
  function send(method, params) { id += 1; const my = id; ws.send(JSON.stringify({ id: my, method, params: params || {} })); return new Promise((res) => pending.set(my, res)); }
  return { send, close: () => ws.close() };
}

async function evalJs(c, expr) {
  const r = await c.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  return r.result && r.result.result ? r.result.result.value : null;
}

mkdirSync(OUT, { recursive: true });
const only = process.argv.slice(2);
const proc = await launch();
const c = await connect();
const texts = {};
try {
  await c.send("Page.enable");
  await c.send("Runtime.enable");
  await c.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await c.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  for (const s of SHOTS) {
    if (s.url) {
      await c.send("Page.navigate", { url: SITE + s.url });
      await sleep(s.wait);
      s.wait = 0;
      if (s.until) {
        for (let i = 0; i < 180; i++) {
          if (await evalJs(c, s.until)) break;
          await sleep(1000);
        }
      }
    }
    for (const p of s.pre || []) {
      await evalJs(c, p);
      await sleep(400);
    }
    await sleep(s.waitAfterPre || s.wait || 0);
    if (only.length && !only.includes(s.id)) continue;
    const shot = await c.send("Page.captureScreenshot", { format: "webp", quality: 82 });
    writeFileSync(join(OUT, s.id + ".webp"), Buffer.from(shot.result.data, "base64"));
    texts[s.id] = await evalJs(c, "document.body.innerText.slice(0, 6000)");
    console.log("shot", s.id);
  }
  writeFileSync(join(WORK, "tour_texts.json"), JSON.stringify(texts, null, 1));
} finally {
  c.close();
  proc.kill();
}
