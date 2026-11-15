import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { createHash } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const PUBLIC = join(ROOT, "frontend", "public");
const OUT = join(PUBLIC, "learn", "video");
const WORK = join(ROOT, ".film_work");
const DIR = join(WORK, "tour-cut");
const REC_DIR = join(ROOT, "..");
const REC = process.env.TOUR_REC || join(REC_DIR, readdirSync(REC_DIR).find((f) => f.startsWith("detail")) || "");
const SPEAKER = process.env.FILM_SPEAKER || "aparna_en_edtech";
const PACE = Number(process.env.FILM_PACE || 1.2);
const GAP = Number(process.env.FILM_GAP || 0.55);
const FPS = 30;
const VW = 1920;
const VH = 1080;
const CROP = "crop=3024:1701:0:172";
const PORT = 9361;
const HTTP_PORT = 9362;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function envKey(name) {
  const file = join(ROOT, "backend", ".env");
  if (!existsSync(file)) return "";
  const line = readFileSync(file, "utf8").split("\n").filter((l) => l.startsWith(name + "=")).pop();
  if (!line) return "";
  return line.slice(name.length + 1).trim();
}

const SAY_AS = [[/\bFIREWORK CHRONOS\b/g, "Fire Work Kronos"], [/\bCHRONOS\b/g, "Kronos"], [/\bChronos\b/g, "Kronos"], [/\bMODIS\b/g, "M O D I S"], [/\bVIIRS\b/g, "V I I R S"], [/\bNOAA\b/g, "N O A A"], [/\bFIRMS\b/g, "Firms"], [/\bFIREWORK\b/g, "Fire Work"], [/\bESA\b/g, "E S A"], [/\bNPP\b/g, "N P P"], [/\bCSV\b/g, "C S V"], [/\bPDF\b/g, "P D F"], [/\bk\b/g, "kay"], [/\bArchive\b/g, "Arkive"]];

async function speak(raw, wavOut) {
  let text = raw;
  SAY_AS.forEach((r) => { text = text.replace(r[0], r[1]); });
  const cacheDir = join(WORK, "tts-cache");
  mkdirSync(cacheDir, { recursive: true });
  const cached = join(cacheDir, createHash("sha1").update(SPEAKER + "|" + PACE + "|" + text).digest("hex").slice(0, 16) + ".wav");
  if (!existsSync(cached)) {
    const key = envKey("SARVAM_API_KEY");
    if (!key) throw new Error("SARVAM_API_KEY missing in backend/.env");
    let res = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      res = await fetch("https://api.sarvam.ai/text-to-speech", { method: "POST", headers: { "api-subscription-key": key, "Content-Type": "application/json" }, body: JSON.stringify({ text, language_code: "en-IN", model: "bulbul:v4-flash", speaker: SPEAKER, pace: PACE, speech_sample_rate: 44100 }) });
      if (res.status !== 429) break;
      await sleep(3000 * (attempt + 1));
    }
    const body = await res.json();
    if (!body.audios) throw new Error("Sarvam TTS failed: " + JSON.stringify(body).slice(0, 300));
    const tmp = cached + ".raw.wav";
    writeFileSync(tmp, Buffer.from(body.audios.join(""), "base64"));
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", tmp, "-ar", "44100", "-ac", "1", cached]);
    rmSync(tmp, { force: true });
  }
  writeFileSync(wavOut, readFileSync(cached));
}

function duration(file) {
  return Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]).toString().trim());
}

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
  const prof = join(WORK, "chrome-tourcut");
  rmSync(prof, { recursive: true, force: true });
  const proc = spawn(CHROME, ["--headless=new", "--remote-debugging-port=" + PORT, "--user-data-dir=" + prof, "--window-size=" + VW + "," + VH, "--hide-scrollbars", "--mute-audio", "--no-first-run", "about:blank"], { stdio: "ignore" });
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

function loadScenes() {
  const win = {};
  new Function("window", readFileSync(join(HERE, "scripts.js"), "utf8"))(win);
  return win.FILMS["site-tour"];
}

const ENC = ["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(FPS), "-video_track_timescale", "30000"];

function recClip(sc, dur, capPng, out) {
  const parts = sc.rec;
  const natural = parts.reduce((a, p) => a + (p[1] - p[0]), 0);
  const speed = Math.max(0.5, Math.min(1.6, natural / dur));
  const args = ["-v", "error", "-y"];
  parts.forEach((p) => args.push("-ss", String(p[0]), "-t", String(p[1] - p[0]), "-i", REC));
  args.push("-loop", "1", "-t", dur.toFixed(3), "-i", capPng);
  const chain = parts.map((p, i) => "[" + i + ":v]" + CROP + ",scale=" + VW + ":" + VH + ":flags=lanczos,fps=120,setpts=PTS-STARTPTS[p" + i + "]");
  const joined = parts.map((p, i) => "[p" + i + "]").join("") + "concat=n=" + parts.length + ":v=1:a=0[cat]";
  const timed = "[cat]setpts=(PTS-STARTPTS)/" + speed.toFixed(4) + ",fps=" + FPS + ",tpad=stop_mode=clone:stop_duration=" + dur.toFixed(3) + ",trim=duration=" + dur.toFixed(3) + ",setpts=PTS-STARTPTS[v]";
  const cap = "[" + parts.length + ":v]format=rgba,fade=t=in:st=0:d=0.3:alpha=1,fade=t=out:st=" + Math.max(0, dur - 0.35).toFixed(3) + ":d=0.3:alpha=1[c]";
  const fx = "[v][c]overlay=0:0:format=auto,format=yuv420p[o]";
  args.push("-filter_complex", chain.concat([joined, timed, cap, fx]).join(";"), "-map", "[o]");
  args.push(...ENC, out);
  execFileSync("ffmpeg", args);
  return speed;
}

async function filmClip(c, sc, dur, out, frames) {
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });
  const meta = { num: "", title: "A guided tour of FIREWORK CHRONOS", kicker: "Every screen, what the data says, and what it does not", badge: "WEBSITE TOUR", endNote: "firework-chronos.vercel.app · open the Explorer and try it", noBar: true };
  await evalJs(c, "window.setupScenes(" + JSON.stringify([sc]) + "," + JSON.stringify(meta) + "," + JSON.stringify([{ start: 0, dur }]) + ")");
  const n = Math.ceil(dur * FPS);
  for (let f = 0; f < n; f++) {
    await evalJs(c, "window.renderAt(" + (f / FPS).toFixed(4) + ");1");
    const shot = await c.send("Page.captureScreenshot", { format: "jpeg", quality: 90, clip: { x: 0, y: 0, width: VW, height: VH, scale: 1 } });
    writeFileSync(join(frames, String(f).padStart(5, "0") + ".jpg"), Buffer.from(shot.result.data, "base64"));
  }
  execFileSync("ffmpeg", ["-v", "error", "-y", "-framerate", String(FPS), "-i", join(frames, "%05d.jpg"), "-t", dur.toFixed(3), ...ENC, out]);
  rmSync(frames, { recursive: true, force: true });
}

const scenes = loadScenes();
mkdirSync(DIR, { recursive: true });
const only = process.argv.slice(2).map(Number);
const timeline = [];
let at = 0;
for (let i = 0; i < scenes.length; i++) {
  const wav = join(DIR, "s" + i + ".wav");
  await speak(scenes[i].say, wav);
  const lead = i === 0 ? 0.5 : 0.25;
  let dur = lead + duration(wav) + GAP;
  if (scenes[i].type === "end") dur = dur + 1.4;
  if (scenes[i].type === "title") dur = dur + 0.6;
  if (scenes[i].type === "chapter") dur = dur + 1.0;
  if (scenes[i].type === "agenda") dur = dur + 1.6;
  timeline.push({ start: at, dur, lead, wav });
  at = at + dur;
}
const total = at;
console.log("narration timeline", total.toFixed(1) + "s");

const srv = await serve();
const proc = await launch();
let c;
try {
  c = await connect();
  await c.send("Page.enable");
  await c.send("Runtime.enable");
  await c.send("Emulation.setDeviceMetricsOverride", { width: VW, height: VH, deviceScaleFactor: 1, mobile: false });
  await c.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
  await c.send("Page.navigate", { url: "http://127.0.0.1:" + HTTP_PORT + "/film/film.html" });
  await sleep(1500);
  await evalJs(c, "document.body.style.background='transparent';document.documentElement.style.background='transparent';window.hires(1.5);1");
  const clips = [];
  for (let i = 0; i < scenes.length; i++) {
    const sc = scenes[i];
    const tl = timeline[i];
    const out = join(DIR, "c" + String(i).padStart(2, "0") + ".mp4");
    clips.push(out);
    if (only.length && !only.includes(i) && existsSync(out)) continue;
    if (process.env.TOUR_STOP && i > Number(process.env.TOUR_STOP)) continue;
    if (sc.rec) {
      let tag = "";
      for (let j = i; j >= 0; j--) {
        if (scenes[j].type === "chapter") { tag = scenes[j].n + " · " + scenes[j].title.toUpperCase(); break; }
      }
      if (sc.topic) tag = tag + " · " + sc.topic;
      await evalJs(c, "window.caption(" + JSON.stringify(sc.say) + "," + JSON.stringify(tag) + ")");
      const cap = join(DIR, "cap" + i + ".png");
      const shot = await c.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: VW, height: VH, scale: 1 } });
      writeFileSync(cap, Buffer.from(shot.result.data, "base64"));
      const sp = recClip(sc, tl.dur, cap, out);
      console.log(i, "rec", tl.dur.toFixed(1) + "s", "speed " + sp.toFixed(2));
    } else {
      await filmClip(c, sc, tl.dur, out, join(DIR, "frames"));
      console.log(i, sc.type, tl.dur.toFixed(1) + "s");
    }
  }
  if (process.env.TOUR_STOP) process.exit(0);
  const list = join(DIR, "list.txt");
  writeFileSync(list, clips.map((f) => "file '" + f.replace(/'/g, "'\\''") + "'").join("\n"));
  const video = join(DIR, "video.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", video]);
  const args = ["-v", "error", "-y"];
  timeline.forEach((t) => args.push("-i", t.wav));
  const mix = timeline.map((t, i) => "[" + i + ":a]adelay=" + Math.round((t.start + t.lead) * 1000) + ":all=1[a" + i + "]").join(";") + ";" + timeline.map((t, i) => "[a" + i + "]").join("") + "amix=inputs=" + timeline.length + ":normalize=0,apad,atrim=0:" + total.toFixed(3) + "[out]";
  const narration = join(DIR, "narration.wav");
  args.push("-filter_complex", mix, "-map", "[out]", narration);
  execFileSync("ffmpeg", args);
  mkdirSync(OUT, { recursive: true });
  const mp4 = join(OUT, "site-tour.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", video, "-i", narration, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", mp4]);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", "1.2", "-i", mp4, "-frames:v", "1", "-q:v", "3", "-vf", "scale=1280:-2", join(OUT, "site-tour.jpg")]);
  const idxFile = join(OUT, "videos.json");
  let index = {};
  if (existsSync(idxFile)) index = JSON.parse(readFileSync(idxFile, "utf8"));
  index["site-tour"] = { src: "/learn/video/site-tour.mp4", poster: "/learn/video/site-tour.jpg", seconds: Math.round(total), starts: timeline.map((t) => Math.round(t.start * 10) / 10), chapters: scenes.map((s, i) => ({ s, i })).filter((x) => x.s.type === "chapter").map((x) => ({ at: Math.round(timeline[x.i].start * 10) / 10, n: x.s.n, title: x.s.title, sub: x.s.sub })) };
  writeFileSync(idxFile, JSON.stringify(index, null, 1));
  console.log("done", mp4, total.toFixed(1) + "s");
} finally {
  if (c) c.close();
  proc.kill();
  srv.close();
}
