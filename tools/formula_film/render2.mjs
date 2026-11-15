import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { createHash } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const FRONT = join(ROOT, "frontend");
const PUBLIC = join(FRONT, "public");
const OUT = join(PUBLIC, "formulas", "video");
const WORK = process.env.FILM_WORK || join(ROOT, ".film_work");
const SITE_DIR = join(WORK, "site");
const SITE_URL = process.env.FILM_SITE || "http://localhost:5175";
const FPS = Number(process.env.FILM_FPS || 24);
const SPEAKER = process.env.FILM_SPEAKER || "kalpit_en_edtech";
const PACE = Number(process.env.FILM_PACE || 0.9);
const W = 1280;
const H = 720;
const PORT = 9361;
const HTTP_PORT = 9362;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SAY_AS = [[/\bFIREWORK CHRONOS\b/g, "Fire Work Kronos"], [/\bCHRONOS\b/g, "Kronos"], [/\bChronos\b/g, "Kronos"], [/\bMODIS\b/g, "M O D I S"], [/\bVIIRS\b/g, "V I I R S"], [/\bNOAA\b/g, "N O A A"], [/\bFIRMS\b/g, "Firms"], [/\bFIREWORK\b/g, "Fire Work"], [/\bS-NPP\b/g, "S N P P"], [/\bNPP\b/g, "N P P"], [/\bFRP\b/g, "F R P"], [/\bPDF\b/g, "P D F"], [/\bUTC\b/g, "U T C"], [/(\d)–(\d)/g, "$1 to $2"]];

function voiced(t) {
  let out = t;
  SAY_AS.forEach((r) => { out = out.replace(r[0], r[1]); });
  return out;
}

function envKey(name) {
  const file = join(ROOT, "backend", ".env");
  if (!existsSync(file)) return "";
  const line = readFileSync(file, "utf8").split("\n").filter((l) => l.startsWith(name + "=")).pop();
  if (!line) return "";
  return line.slice(name.length + 1).trim();
}

async function geminiSpeak(textIn) {
  const key = envKey("GEMINI_API_KEY");
  if (!key) throw new Error("Sarvam has no credit and GEMINI_API_KEY is missing in backend/.env");
  const model = process.env.FILM_GEMINI_TTS || "gemini-3.8-flash-tts";
  const voice = process.env.FILM_GEMINI_VOICE || "Charon";
  let last = "";
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent", { method: "POST", headers: { "x-goog-api-key": key, "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: "Say in a calm, clear teacher voice: " + textIn }] }], generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } }) });
    const body = await res.json();
    const part = body.candidates && body.candidates[0] && body.candidates[0].content && body.candidates[0].content.parts && body.candidates[0].content.parts[0];
    if (part && part.inlineData) return Buffer.from(part.inlineData.data, "base64");
    last = JSON.stringify(body).slice(0, 300);
    await sleep(8000 * (attempt + 1));
  }
  throw new Error("Gemini TTS failed: " + last);
}

async function speak(textRaw, wavOut) {
  const textIn = voiced(textRaw);
  const cacheDir = join(WORK, "tts-cache");
  mkdirSync(cacheDir, { recursive: true });
  const hash = createHash("sha1").update(SPEAKER + "|" + PACE + "|" + textIn).digest("hex").slice(0, 16);
  const cached = join(cacheDir, hash + ".wav");
  if (!existsSync(cached)) {
    const key = envKey("SARVAM_API_KEY");
    if (!key) throw new Error("SARVAM_API_KEY missing in backend/.env");
    let res = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      res = await fetch("https://api.sarvam.ai/text-to-speech", { method: "POST", headers: { "api-subscription-key": key, "Content-Type": "application/json" }, body: JSON.stringify({ text: textIn, target_language_code: "en-IN", language_code: "en-IN", model: "bulbul:v4-flash", speaker: SPEAKER, pace: PACE, speech_sample_rate: 44100 }) });
      if (res.status !== 429 && res.status < 500) break;
      await sleep(3000 * (attempt + 1));
    }
    const body = await res.json();
    const raw = cached + ".raw.wav";
    if (body.audios) {
      writeFileSync(raw, Buffer.from(body.audios.join(""), "base64"));
      execFileSync("ffmpeg", ["-v", "error", "-y", "-i", raw, "-ar", "44100", "-ac", "1", cached]);
    } else {
      const buf = await geminiSpeak(textIn);
      writeFileSync(raw, buf);
      let input = ["-f", "s16le", "-ar", "24000", "-ac", "1", "-i", raw];
      if (buf.slice(0, 4).toString() === "RIFF") input = ["-i", raw];
      execFileSync("ffmpeg", ["-v", "error", "-y"].concat(input, ["-af", "atempo=0.96", "-ar", "44100", "-ac", "1", cached]));
    }
    rmSync(raw, { force: true });
  }
  writeFileSync(wavOut, readFileSync(cached));
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf" };
function serve() {
  const srv = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    let file = join(PUBLIC, url);
    if (url.startsWith("/film/")) file = join(HERE, url.slice(6));
    if (url.startsWith("/katex/")) file = join(FRONT, "node_modules", "katex", "dist", url.slice(7));
    if (url.startsWith("/serif/")) file = join(FRONT, "node_modules", "@fontsource", "source-serif-4", "files", url.slice(7));
    if (url.startsWith("/site/")) file = join(SITE_DIR, url.slice(6));
    if (!existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(readFileSync(file));
  });
  return new Promise((r) => srv.listen(HTTP_PORT, "127.0.0.1", () => r(srv)));
}

async function launch() {
  const prof = join(WORK, "chrome-profile-formulas2");
  rmSync(prof, { recursive: true, force: true });
  const proc = spawn(CHROME, ["--headless=new", "--remote-debugging-port=" + PORT, "--user-data-dir=" + prof, "--window-size=1440,900", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
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
  if (r.result && r.result.exceptionDetails) throw new Error("JS error: " + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result && r.result.result ? r.result.result.value : null;
}

function duration(file) {
  return Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]).toString().trim());
}

function normalise(sc) {
  if (sc.type === "build") return Object.assign({}, sc, { beats: sc.parts.map((p) => ({ say: p.say })) });
  if (sc.type === "example") return Object.assign({}, sc, { beats: sc.steps.map((p) => ({ say: p.say })) });
  return sc;
}

async function captureSite(c, id, sc) {
  mkdirSync(SITE_DIR, { recursive: true });
  await c.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await c.send("Page.navigate", { url: SITE_URL + "/" });
  await sleep(1500);
  await evalJs(c, "localStorage.setItem('fc-source','live'); sessionStorage.setItem('fc-intro-seen','1'); 1");
  await c.send("Page.navigate", { url: SITE_URL + sc.page });
  await sleep(6000);
  if (sc.click) {
    await evalJs(c, "(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.trim().toLowerCase() === " + JSON.stringify(sc.click.toLowerCase()) + "); if (b) b.click(); return !!b; })()");
    await sleep(2500);
  }
  const rects = await evalJs(c, "(() => { window.scrollTo(0, 0); return " + JSON.stringify(sc.beats.map((b) => b.target)) + ".map((sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }; }); })()");
  const ys = rects.filter((r) => r).map((r) => r.y);
  const ye = rects.filter((r) => r).map((r) => r.y + r.h);
  let top = 0;
  if (ys.length) top = Math.max(0, Math.min(...ys) - 140);
  let hgt = 900;
  if (ye.length) hgt = Math.max(900, Math.max(...ye) - top + 140);
  await sleep(800);
  const shot = await c.send("Page.captureScreenshot", { format: "jpeg", quality: 88, captureBeyondViewport: true, clip: { x: 0, y: top, width: 1440, height: hgt, scale: 1 } });
  writeFileSync(join(SITE_DIR, id + ".jpg"), Buffer.from(shot.result.data, "base64"));
  await c.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  return { w: 1440, h: hgt, rects: rects.map((r) => (r ? { x: r.x, y: r.y - top, w: r.w, h: r.h } : null)) };
}

async function renderFormula(c, f) {
  const script = JSON.parse(readFileSync(join(HERE, "scripts", f.id + ".json"), "utf8"));
  const scenes = script.scenes.map(normalise);
  const dir = join(WORK, "f2_" + f.id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "frames"), { recursive: true });
  let site = null;
  const siteScene = scenes.find((s) => s.type === "site");
  if (siteScene) site = await captureSite(c, f.id, siteScene);
  const tl = [];
  const audio = [];
  let t = 0;
  for (let si = 0; si < scenes.length; si++) {
    const sc = scenes[si];
    const start = t;
    const beats = [];
    t = t + 0.6;
    for (let bi = 0; bi < sc.beats.length; bi++) {
      const wav = join(dir, "s" + si + "_b" + bi + ".wav");
      await speak(sc.beats[bi].say, wav);
      const d = duration(wav);
      const lead = 0.3;
      const tail = 0.55;
      beats.push({ start: t, dur: lead + d + tail, lead, voice: d, say: sc.beats[bi].say });
      audio.push({ wav, at: t + lead });
      t = t + lead + d + tail;
    }
    t = t + (si === scenes.length - 1 ? 1.4 : 0.5);
    tl.push({ start, dur: t - start, beats });
  }
  const total = t;
  const args = ["-v", "error", "-y"];
  audio.forEach((a) => args.push("-i", a.wav));
  const parts = audio.map((a, i) => "[" + i + ":a]adelay=" + Math.round(a.at * 1000) + ":all=1[a" + i + "]");
  const mix = parts.join(";") + ";" + audio.map((a, i) => "[a" + i + "]").join("") + "amix=inputs=" + audio.length + ":normalize=0,apad,atrim=0:" + total.toFixed(3) + "[out]";
  const mixed = join(dir, "narration.wav");
  args.push("-filter_complex", mix, "-map", "[out]", mixed);
  execFileSync("ffmpeg", args);

  await c.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await c.send("Page.navigate", { url: "http://127.0.0.1:" + HTTP_PORT + "/film/film2.html" });
  await sleep(1500);
  await evalJs(c, "window.setup(" + JSON.stringify(f) + "," + JSON.stringify(scenes) + "," + JSON.stringify(tl) + "," + JSON.stringify(site) + ")");
  const n = Math.ceil(total * FPS);
  for (let k = 0; k < n; k++) {
    await evalJs(c, "window.renderAt(" + (k / FPS).toFixed(4) + ");1");
    const shot = await c.send("Page.captureScreenshot", { format: "jpeg", quality: 86, clip: { x: 0, y: 0, width: W, height: H, scale: 1 } });
    writeFileSync(join(dir, "frames", String(k).padStart(5, "0") + ".jpg"), Buffer.from(shot.result.data, "base64"));
  }
  mkdirSync(OUT, { recursive: true });
  const mp4 = join(OUT, f.id + ".mp4");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-framerate", String(FPS), "-i", join(dir, "frames", "%05d.jpg"), "-i", mixed, "-c:v", "libx264", "-preset", "medium", "-crf", "24", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", mp4]);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", "3.5", "-i", mp4, "-frames:v", "1", "-q:v", "4", "-vf", "scale=960:-2", join(OUT, f.id + ".jpg")]);
  rmSync(join(dir, "frames"), { recursive: true, force: true });
  console.log(f.id, n, "frames", total.toFixed(1) + "s", new Date().toISOString().slice(11, 19));
  return { id: f.id, seconds: Math.round(total) };
}

const formulas = JSON.parse(readFileSync(join(PUBLIC, "data", "formulas_content.json"), "utf8")).formulas;
const only = process.argv.slice(2);
mkdirSync(WORK, { recursive: true });
const srv = await serve();
const proc = await launch();
let c;
try {
  c = await connect();
  await c.send("Page.enable");
  await c.send("Runtime.enable");
  const idxFile = join(OUT, "videos.json");
  for (const f of formulas) {
    if (only.length > 0 && !only.includes(f.id)) continue;
    if (!existsSync(join(HERE, "scripts", f.id + ".json"))) continue;
    if (process.env.FILM_SKIP_DONE && existsSync(join(OUT, f.id + ".mp4"))) continue;
    const d = await renderFormula(c, f);
    let index = {};
    if (existsSync(idxFile)) index = JSON.parse(readFileSync(idxFile, "utf8"));
    index[d.id] = { src: "/formulas/video/" + d.id + ".mp4", poster: "/formulas/video/" + d.id + ".jpg", seconds: d.seconds };
    writeFileSync(idxFile, JSON.stringify(index, null, 1));
  }
} finally {
  if (c) c.close();
  proc.kill();
  srv.close();
}
