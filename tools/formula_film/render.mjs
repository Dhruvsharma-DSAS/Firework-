import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { createHash } from "node:crypto";
import { buildScenes } from "./script.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const FRONT = join(ROOT, "frontend");
const PUBLIC = join(FRONT, "public");
const OUT = join(PUBLIC, "formulas", "video");
const WORK = process.env.FILM_WORK || join(ROOT, ".film_work");
const FPS = Number(process.env.FILM_FPS || 24);
const SPEAKER = process.env.FILM_SPEAKER || "girish_en_documentary";
const PACE = Number(process.env.FILM_PACE || 1.25);
const W = 1280;
const H = 720;
const PORT = 9351;
const HTTP_PORT = 9352;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SAY_AS = [[/\bFIREWORK CHRONOS\b/g, "Fire Work Kronos"], [/\bCHRONOS\b/g, "Kronos"], [/\bChronos\b/g, "Kronos"], [/\bMODIS\b/g, "M O D I S"], [/\bVIIRS\b/g, "V I I R S"], [/\bNOAA\b/g, "N O A A"], [/\bFIRMS\b/g, "Firms"], [/\bFIREWORK\b/g, "Fire Work"], [/\bNPP\b/g, "N P P"], [/\bS-NPP\b/g, "S N P P"], [/\bFRP\b/g, "F R P"], [/\bGLM\b/g, "G L M"], [/\bDBSCAN\b/g, "D B scan"], [/\bPELT\b/g, "pelt"], [/\bPDF\b/g, "P D F"], [/\bESA\b/g, "E S A"], [/\bk\b/g, "kay"], [/\bLOYO\b/g, "leave one year out"], [/\bNULL\b/g, "null"], [/\bUTC\b/g, "U T C"], [/(\d)–(\d)/g, "$1 to $2"]];

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
      res = await fetch("https://api.sarvam.ai/text-to-speech", { method: "POST", headers: { "api-subscription-key": key, "Content-Type": "application/json" }, body: JSON.stringify({ text: textIn, language_code: "en-IN", model: "bulbul:v4-flash", speaker: SPEAKER, pace: PACE, speech_sample_rate: 44100 }) });
      if (res.status !== 429 && res.status < 500) break;
      await sleep(3000 * (attempt + 1));
    }
    const body = await res.json();
    if (!body.audios) throw new Error("Sarvam TTS failed: " + JSON.stringify(body).slice(0, 300));
    const raw = cached + ".raw.wav";
    writeFileSync(raw, Buffer.from(body.audios.join(""), "base64"));
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", raw, "-ar", "44100", "-ac", "1", cached]);
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
    if (!existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(readFileSync(file));
  });
  return new Promise((r) => srv.listen(HTTP_PORT, "127.0.0.1", () => r(srv)));
}

async function launch() {
  const prof = join(WORK, "chrome-profile-formulas");
  rmSync(prof, { recursive: true, force: true });
  const proc = spawn(CHROME, ["--headless=new", "--remote-debugging-port=" + PORT, "--user-data-dir=" + prof, "--window-size=" + W + "," + H, "--hide-scrollbars", "--mute-audio", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
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

async function renderFormula(c, f, next) {
  const scenes = buildScenes(f, next);
  const dir = join(WORK, "formula_" + f.id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "frames"), { recursive: true });
  const timeline = [];
  const audio = [];
  let start = 0;
  for (let i = 0; i < scenes.length; i++) {
    const wav = join(dir, "s" + i + ".wav");
    await speak(scenes[i].say, wav);
    const d = duration(wav);
    const lead = 0.4;
    let tail = 0.7;
    if (scenes[i].type === "end") tail = 1.8;
    timeline.push({ start, dur: lead + d + tail, lead, voice: d });
    audio.push({ wav, at: start + lead });
    start = start + lead + d + tail;
  }
  const total = start;
  const args = ["-v", "error", "-y"];
  audio.forEach((a) => args.push("-i", a.wav));
  const parts = audio.map((a, i) => "[" + i + ":a]adelay=" + Math.round(a.at * 1000) + ":all=1[a" + i + "]");
  const mix = parts.join(";") + ";" + audio.map((a, i) => "[a" + i + "]").join("") + "amix=inputs=" + audio.length + ":normalize=0,apad,atrim=0:" + total.toFixed(3) + "[out]";
  const mixed = join(dir, "narration.wav");
  args.push("-filter_complex", mix, "-map", "[out]", mixed);
  execFileSync("ffmpeg", args);

  await c.send("Page.navigate", { url: "http://127.0.0.1:" + HTTP_PORT + "/film/film.html" });
  await sleep(1200);
  const sceneMeta = scenes.map((s) => ({ type: s.type, text: s.say }));
  await evalJs(c, "window.setup(" + JSON.stringify(f) + "," + JSON.stringify(next ? { id: next.id, name: next.name } : null) + "," + JSON.stringify(sceneMeta) + "," + JSON.stringify(timeline) + ")");
  const n = Math.ceil(total * FPS);
  for (let k = 0; k < n; k++) {
    await evalJs(c, "window.renderAt(" + (k / FPS).toFixed(4) + ");1");
    const shot = await c.send("Page.captureScreenshot", { format: "jpeg", quality: 85, clip: { x: 0, y: 0, width: W, height: H, scale: 1 } });
    writeFileSync(join(dir, "frames", String(k).padStart(5, "0") + ".jpg"), Buffer.from(shot.result.data, "base64"));
  }
  mkdirSync(OUT, { recursive: true });
  const mp4 = join(OUT, f.id + ".mp4");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-framerate", String(FPS), "-i", join(dir, "frames", "%05d.jpg"), "-i", mixed, "-c:v", "libx264", "-preset", "medium", "-crf", "27", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k", "-shortest", "-movflags", "+faststart", mp4]);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", "2.4", "-i", mp4, "-frames:v", "1", "-q:v", "4", "-vf", "scale=960:-2", join(OUT, f.id + ".jpg")]);
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
  await c.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  const idxFile = join(OUT, "videos.json");
  for (let i = 0; i < formulas.length; i++) {
    const f = formulas[i];
    if (only.length > 0 && !only.includes(f.id)) continue;
    if (process.env.FILM_SKIP_DONE && existsSync(join(OUT, f.id + ".mp4"))) continue;
    const d = await renderFormula(c, f, formulas[i + 1]);
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
