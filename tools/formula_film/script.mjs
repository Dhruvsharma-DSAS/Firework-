const GREEK = { alpha: "alpha", beta: "beta", gamma: "gamma", delta: "delta", Delta: "delta", epsilon: "epsilon", varepsilon: "epsilon", theta: "theta", lambda: "lambda", mu: "mu", sigma: "sigma", Sigma: "sum", tau: "tau", phi: "phi", varphi: "phi", rho: "rho", pi: "pi", omega: "omega", eta: "eta", kappa: "kappa", nu: "nu", chi: "chi", psi: "psi", xi: "xi", zeta: "zeta" };
const WORDS = { le: " at most ", leq: " at most ", ge: " at least ", geq: " at least ", approx: " about ", times: " times ", cdot: " times ", pm: " plus or minus ", sum: " the sum of ", prod: " the product of ", sqrt: " the square root of ", log: " log ", ln: " natural log ", exp: " e to the ", min: " minimum ", max: " maximum ", median: " median ", in: " in ", to: " to ", infty: " infinity ", neq: " not equal to ", sim: " distributed as ", mid: " given ", lfloor: " floor of ", rfloor: " ", lceil: " ceiling of ", rceil: " ", cup: " union ", cap: " intersect ", int: " the integral of ", partial: " partial ", forall: " for every ", ldots: " and so on ", dots: " and so on ", cdots: " and so on ", quad: " ", qquad: " ", Pr: " probability of ", mathbb: "", mathrm: "", mathbf: "", text: "", operatorname: "", left: "", right: "", big: "", Big: "", bigg: "", displaystyle: "" };

export function speakTex(tex) {
  let s = String(tex);
  for (let i = 0; i < 4; i++) {
    s = s.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, " $1 over $2 ");
    s = s.replace(/\\(?:hat|widehat)\{([^{}]*)\}/g, " $1 hat ");
    s = s.replace(/\\(?:bar|overline)\{([^{}]*)\}/g, " $1 bar ");
    s = s.replace(/\\tilde\{([^{}]*)\}/g, " $1 tilde ");
    s = s.replace(/\\(?:mathrm|text|mathbf|operatorname|mathit|textrm)\{([^{}]*)\}/g, " $1 ");
  }
  s = s.replace(/\\hat\s*(\w)/g, " $1 hat ");
  s = s.replace(/_\{[^{}]*\}/g, " ").replace(/_[A-Za-z0-9]/g, " ");
  s = s.replace(/\^\{\s*\\?(?:mathrm|text)?\{?lo\}?\s*\}/g, " lower bound ").replace(/\^\{\s*\\?(?:mathrm|text)?\{?hi\}?\s*\}/g, " upper bound ").replace(/\^\{\s*\\?(?:mathrm|text)?\{?eq\}?\s*\}/g, " equivalent ");
  s = s.replace(/\^\{2\}|\^2/g, " squared ").replace(/\^\{([^{}]*)\}/g, " to the power $1 ").replace(/\^(\w)/g, " to the power $1 ");
  s = s.replace(/\\([A-Za-z]+)/g, (m, w) => {
    if (GREEK[w]) {
      return " " + GREEK[w] + " ";
    }
    if (WORDS[w] !== undefined) {
      return WORDS[w];
    }
    return " ";
  });
  s = s.replace(/<=|≤/g, " at most ").replace(/>=|≥/g, " at least ").replace(/</g, " less than ").replace(/>/g, " greater than ");
  s = s.replace(/=/g, " equals ").replace(/\+/g, " plus ").replace(/(\s)-(\s)/g, " minus ").replace(/\//g, " over ").replace(/\*/g, " times ");
  s = s.replace(/[{}\\&|$]/g, " ").replace(/\s+/g, " ").trim();
  return s;
}

export function speakText(text) {
  const parts = String(text || "").split("$");
  return parts.map((p, i) => {
    if (i % 2 === 1) {
      return speakTex(p);
    }
    return p;
  }).join("").replace(/q̂/g, "q hat").replace(/k̂/g, "k hat").replace(/α/g, "alpha").replace(/β/g, "beta").replace(/σ/g, "sigma").replace(/μ/g, "mu").replace(/λ/g, "lambda").replace(/τ/g, "tau").replace(/≈/g, " about ").replace(/≤/g, " at most ").replace(/≥/g, " at least ").replace(/×/g, " times ").replace(/\s=\s/g, " equals ").replace(/\[\s*(-?[\d.,]+)\s*,\s*(-?[\d.,]+)\s*\]/g, ", interval $1 to $2,").replace(/•\s*/g, "").replace(/\s*\((?:F\d{2}(?:[,;]\s*)?)+\)/g, "").replace(/\bF(\d{2})\b/g, (m, n) => "formula " + Number(n)).replace(/\s*,\s*([.;])/g, "$1").replace(/\s+/g, " ").trim();
}

export function sentences(text, maxWords) {
  const clean = speakText(text);
  const list = clean.split(/(?<=[.!?;])\s+(?=[A-Z0-9(])/);
  const out = [];
  let words = 0;
  for (const s of list) {
    const n = s.trim().split(/\s+/).length;
    if (out.length > 0 && words + n > maxWords) {
      break;
    }
    out.push(s.trim());
    words = words + n;
  }
  return out.join(" ");
}

function lowerFirst(t) {
  if (/^[A-Z][a-z]/.test(t)) {
    return t.charAt(0).toLowerCase() + t.slice(1);
  }
  return t;
}

function firstText(items) {
  return (items || []).filter((x) => typeof x === "string");
}

const PAGE_NAMES = { explore: "the Explorer", calendar: "the Calendar", sensors: "the Sensor Lab", validation: "Validation", sources: "Sources", blind: "Blind Spot", brief: "the Brief" };

function spokenId(id) {
  return "Formula " + String(Number(id.slice(1)));
}

export function buildScenes(f, next) {
  const how = [];
  firstText(f.how).forEach((t) => {
    if (t.indexOf("•") >= 0) {
      t.split("•").map((x) => x.trim()).filter((x) => x).forEach((x) => how.push("• " + x));
    } else {
      how.push(t);
    }
  });
  const steps = how.filter((t) => t.startsWith("• ")).slice(0, 3);
  let howSay = "";
  if (steps.length > 0) {
    howSay = "How it works. " + steps.map((t, i) => ["First, ", "Then, ", "Finally, "][i] + lowerFirst(sentences(t.slice(2), 18))).join(" ");
  } else {
    howSay = "How it works. " + sentences(how.join(" "), 40);
  }
  const symbols = (f.symbols || []).slice(0, 5);
  const symSay = "The symbols. " + symbols.slice(0, 2).map((s) => speakTex(s.tex) + " is " + speakText(s.meaning).replace(/\.$/, "") + ".").join(" ");
  const pages = (f.pages || []).filter((p) => PAGE_NAMES[p]).map((p) => PAGE_NAMES[p]);
  let whereSay = "You can read this formula in the Formulas section";
  if (pages.length === 1) {
    whereSay = "On FIREWORK, this formula is at work on " + pages[0];
  } else if (pages.length > 1) {
    whereSay = "On FIREWORK, this formula is at work on " + pages.slice(0, -1).join(", ") + " and " + pages[pages.length - 1];
  }
  whereSay = whereSay + ". The full derivation, figures and references are in the PDF for " + spokenId(f.id) + ".";
  if (next) {
    whereSay = whereSay + " Next, " + spokenId(next.id) + ": " + next.name + ".";
  }
  const scenes = [
    { type: "title", say: spokenId(f.id) + ". " + f.name + ". " + sentences(f.lead, 30) },
    { type: "equation", say: sentences(f.reads, 38) },
  ];
  if (symbols.length > 0) {
    scenes.push({ type: "symbols", say: symSay });
  }
  scenes.push({ type: "why", say: "Why FIREWORK needs it. " + sentences(firstText(f.why).join(" "), 38) });
  scenes.push({ type: "how", say: howSay });
  scenes.push({ type: "example", say: "A worked example. " + sentences(firstText(f.example).join(" "), 42) });
  if ((f.figures || []).length > 0) {
    scenes.push({ type: "figure", say: sentences(f.figures[0].caption, 26) });
  }
  scenes.push({ type: "end", say: whereSay });
  return scenes;
}
