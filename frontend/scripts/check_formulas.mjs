import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import katex from "katex";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const BANNED = [/\bV1\b/, /\bV2\b/, /\baudit/i, /\bverdict/i, /\bFIX\b/, /\bREVISE\b/, /equation_v/];
const problems = [];

if (!existsSync(DIST)) {
  console.error("dist/ missing: run npm run build first");
  process.exit(1);
}

const content = readFileSync(join(DIST, "data", "formulas_content.json"), "utf8");
BANNED.forEach((re) => {
  if (re.test(content)) {
    problems.push("formulas_content.json contains " + re);
  }
});
if (existsSync(join(DIST, "data", "formulas.json"))) {
  problems.push("old data/formulas.json (with audit fields) is still shipped");
}
readdirSync(join(DIST, "assets")).filter((f) => f.endsWith(".js")).forEach((f) => {
  const js = readFileSync(join(DIST, "assets", f), "utf8");
  ["equation_v1", "equation_v2", "audit_verdict", "audit_finding", "v2_status", "verdictColor"].forEach((w) => {
    if (js.indexOf(w) >= 0) {
      problems.push(f + " still references " + w);
    }
  });
});

const data = JSON.parse(content).formulas;
let pieces = 0;
function tex(id, where, t, display) {
  pieces = pieces + 1;
  try {
    katex.renderToString(t, { displayMode: display, throwOnError: true, strict: "ignore" });
  } catch (e) {
    problems.push(id + " " + where + ": " + e.message.slice(0, 100));
  }
}
function inline(id, where, text) {
  String(text || "").split("$").forEach((p, i) => {
    if (i % 2 === 1) {
      tex(id, where, p, false);
    }
  });
}
data.forEach((f) => {
  f.equations.forEach((t, i) => tex(f.id, "equation " + (i + 1), t, true));
  f.symbols.forEach((s, i) => tex(f.id, "symbol " + (i + 1), s.tex, false));
  ["origin", "why", "how", "example", "limits"].forEach((k) => (f[k] || []).forEach((it, i) => {
    if (it && typeof it === "object" && it.tex) {
      tex(f.id, k + " " + i, it.tex, true);
    } else {
      inline(f.id, k + " " + i, it);
    }
  }));
  ["lead", "reads"].forEach((k) => inline(f.id, k, f[k]));
  f.figures.forEach((g) => {
    if (!existsSync(join(DIST, "formulas", g.file))) {
      problems.push(f.id + " missing figure " + g.file);
    }
  });
  if (!existsSync(join(DIST, "formulas", "pdf", f.pdf))) {
    problems.push(f.id + " missing PDF " + f.pdf);
  }
});

const search = (q) => data.filter((f) => (f.id + " " + f.name + " " + f.lead).toLowerCase().indexOf(q.toLowerCase()) >= 0).length;
["F09", "bootstrap", "exposure"].forEach((q) => {
  if (search(q) === 0) {
    problems.push("search finds nothing for " + q);
  }
});

console.log(data.length + " formulas · " + pieces + " math pieces rendered · " + problems.length + " problems");
problems.forEach((p) => console.log("  " + p));
if (problems.length > 0) {
  process.exit(1);
}
process.exit(0);
