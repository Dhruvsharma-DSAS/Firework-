import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { createHash } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const PUBLIC = join(ROOT, "frontend", "public");
const OUT = join(PUBLIC, "learn", "video");
const WORK = process.env.FILM_WORK || join(ROOT, ".film_work");
const FPS = Number(process.env.FILM_FPS || 24);
const VOICE = process.env.FILM_VOICE || "Samantha";
const RATE = process.env.FILM_RATE || "172";
const TTS = process.env.FILM_TTS || "sarvam";
const SPEAKER = process.env.FILM_SPEAKER || "girish_en_documentary";
const PACE = Number(process.env.FILM_PACE || 1.0);

function envKey(name) {
  const file = join(ROOT, "backend", ".env");
  if (!existsSync(file)) return "";
  const line = readFileSync(file, "utf8").split("\n").filter((l) => l.startsWith(name + "=")).pop();
  if (!line) return "";
  return line.slice(name.length + 1).trim();
}

const SAY_AS = [[/\bFIREWORK CHRONOS\b/g, "Fire Work Kronos"], [/\bCHRONOS\b/g, "Kronos"], [/\bChronos\b/g, "Kronos"], [/\bMODIS\b/g, "M O D I S"], [/\bVIIRS\b/g, "V I I R S"], [/\bNOAA\b/g, "N O A A"], [/\bFIRMS\b/g, "Firms"], [/\bFIREWORK\b/g, "Fire Work"], [/\bmegawatts\b/g, "mega watts"], [/\bMyth (one|two|three|four)\b/g, "Myth number $1"], [/\bESA\b/g, "E S A"], [/\bNPP\b/g, "N P P"], [/\bCSV\b/g, "C S V"], [/\bAI\b/g, "A I"], [/\bPDF\b/g, "P D F"], [/\bk\b/g, "kay"], [/\bArchive\b/g, "Arkive"]];

function voiced(t) {
  let out = t;
  SAY_AS.forEach((r) => { out = out.replace(r[0], r[1]); });
  return out;
}

async function speak(textRaw, wavOut) {
  const textIn = voiced(textRaw);
  if (TTS !== "sarvam") {
    const aiff = wavOut.replace(/\.wav$/, ".aiff");
    execFileSync("say", ["-v", VOICE, "-r", RATE, "-o", aiff, textIn]);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", aiff, "-ar", "44100", "-ac", "1", wavOut]);
    return;
  }
  const cacheDir = join(WORK, "tts-cache");
  mkdirSync(cacheDir, { recursive: true });
  const hash = createHash("sha1").update(SPEAKER + "|" + PACE + "|" + textIn).digest("hex").slice(0, 16);
  const cached = join(cacheDir, hash + ".wav");
  if (!existsSync(cached)) {
    const key = envKey("SARVAM_API_KEY");
    if (!key) throw new Error("SARVAM_API_KEY missing in backend/.env");
    let res = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      res = await fetch("https://api.sarvam.ai/text-to-speech", { method: "POST", headers: { "api-subscription-key": key, "Content-Type": "application/json" }, body: JSON.stringify({ text: textIn, language_code: "en-IN", model: "bulbul:v4-flash", speaker: SPEAKER, pace: PACE, speech_sample_rate: 44100 }) });
      if (res.status !== 429) break;
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
const W = 1280;
const H = 720;
const PORT = 9341;
const HTTP_PORT = 9342;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json" };
function serve() {
  const srv = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    let file = join(PUBLIC, url);
    if (url.startsWith("/film/")) file = join(HERE, url.slice(6));
    if (!existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(readFileSync(file));
  });
  return new Promise((r) => srv.listen(HTTP_PORT, "127.0.0.1", () => r(srv)));
}

async function launch() {
  const prof = join(WORK, "chrome-profile");
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

function loadScenes(id) {
  const src = readFileSync(join(HERE, "scripts.js"), "utf8");
  const win = {};
  new Function("window", src)(win);
  return win.FILMS[id];
}

async function renderLesson(c, lesson) {
  const id = lesson.id;
  const scenes = loadScenes(id);
  const dir = join(WORK, id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "frames"), { recursive: true });
  const timeline = [];
  const audio = [];
  let at = 0.4;
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    const wav = join(dir, "s" + i + ".wav");
    await speak(s.say, wav);
    const d = duration(wav);
    let pad = Number(process.env.FILM_GAP || 0.9);
    if (s.type === "title") pad = 0.7;
    if (s.type === "end") pad = 1.6;
    timeline.push({ start: at - 0.4, dur: d + pad + (i === 0 ? 0.4 : 0) });
    audio.push({ wav, at });
    at = at + d + pad;
  }
  timeline[0].start = 0;
  for (let i = 1; i < timeline.length; i++) timeline[i].start = timeline[i - 1].start + timeline[i - 1].dur;
  audio.forEach((a, i) => { a.at = timeline[i].start + (i === 0 ? 0.4 : 0.3); });
  const total = timeline[timeline.length - 1].start + timeline[timeline.length - 1].dur;

  const args = ["-v", "error", "-y"];
  audio.forEach((a) => args.push("-i", a.wav));
  const parts = audio.map((a, i) => "[" + i + ":a]adelay=" + Math.round(a.at * 1000) + ":all=1[a" + i + "]");
  const mix = parts.join(";") + ";" + audio.map((a, i) => "[a" + i + "]").join("") + "amix=inputs=" + audio.length + ":normalize=0,apad,atrim=0:" + total.toFixed(3) + "[out]";
  const mixed = join(dir, "narration.wav");
  args.push("-filter_complex", mix, "-map", "[out]", mixed);
  execFileSync("ffmpeg", args);

  await c.send("Page.navigate", { url: "http://127.0.0.1:" + HTTP_PORT + "/film/film.html" });
  await sleep(1500);
  const meta = { num: lesson.num, title: lesson.title, kicker: lesson.kicker, badge: lesson.badge, endNote: lesson.endNote };
  await evalJs(c, "window.setup(" + JSON.stringify(id) + "," + JSON.stringify(meta) + "," + JSON.stringify(timeline) + ")");
  const n = Math.ceil(total * FPS);
  for (let f = 0; f < n; f++) {
    await evalJs(c, "window.renderAt(" + (f / FPS).toFixed(4) + ");1");
    const shot = await c.send("Page.captureScreenshot", { format: "jpeg", quality: 84, clip: { x: 0, y: 0, width: W, height: H, scale: 1 } });
    writeFileSync(join(dir, "frames", String(f).padStart(5, "0") + ".jpg"), Buffer.from(shot.result.data, "base64"));
  }
  mkdirSync(OUT, { recursive: true });
  const mp4 = join(OUT, id + ".mp4");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-framerate", String(FPS), "-i", join(dir, "frames", "%05d.jpg"), "-i", mixed, "-c:v", "libx264", "-preset", "medium", "-crf", "27", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k", "-shortest", "-movflags", "+faststart", mp4]);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", "2.2", "-i", mp4, "-frames:v", "1", "-q:v", "4", "-vf", "scale=960:-2", join(OUT, id + ".jpg")]);
  rmSync(join(dir, "frames"), { recursive: true, force: true });
  console.log(id, n, "frames", total.toFixed(1) + "s");
  return { id, seconds: Math.round(total), starts: timeline.map((x) => Math.round(x.start * 10) / 10) };
}

const EXTRA = [{ id: "site-tour", num: "", title: "A guided tour of FIREWORK CHRONOS", kicker: "Every screen, what the data says, and what it does not", badge: "WEBSITE TOUR", endNote: "firework-chronos.vercel.app · open the Explorer and try it" }];
const lessons = JSON.parse(readFileSync(join(PUBLIC, "data", "lessons.json"), "utf8")).data.concat(EXTRA);
const only = process.argv.slice(2);
const list = lessons.filter((l) => only.length === 0 || only.includes(l.id));
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
  if (process.env.FILM_AUDIO_ONLY) {
    const manifest = [];
    for (const l of list) {
      const scenes = loadScenes(l.id);
      for (let i = 0; i < scenes.length; i++) {
        const wav = join(WORK, "check_" + l.id + "_" + i + ".wav");
        await speak(scenes[i].say, wav);
        manifest.push({ id: l.id, i, text: scenes[i].say, wav });
      }
    }
    writeFileSync(join(WORK, "audio_manifest.json"), JSON.stringify(manifest, null, 1));
    console.log("audio ready", manifest.length);
    process.exit(0);
  }
  for (const l of list) {
    const d = await renderLesson(c, l);
    let index = {};
    if (existsSync(idxFile)) index = JSON.parse(readFileSync(idxFile, "utf8"));
    index[d.id] = { src: "/learn/video/" + d.id + ".mp4", poster: "/learn/video/" + d.id + ".jpg", seconds: d.seconds, starts: d.starts };
    writeFileSync(idxFile, JSON.stringify(index, null, 1));
  }
} finally {
  if (c) c.close();
  proc.kill();
  srv.close();
}
