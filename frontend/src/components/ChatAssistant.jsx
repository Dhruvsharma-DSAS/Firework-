import { useEffect, useState } from "react";
import { API_BASE } from "../api/client.js";
import ChronosCharacter from "./ChronosCharacter.jsx";
import "../styles/chronos.css";

const SUGGEST = [
  ["record", "What is FIREWORK CHRONOS?", "Understand the 25-year record"],
  ["sensors", "Why do MODIS and VIIRS disagree?", "Two satellites, two rulers"],
  ["k", "What does exchange rate k mean?", "The adjustment method"],
  ["globe", "How do I use the Explorer?", "Navigate the fire data"],
];

function SuggestIcon(props) {
  if (props.kind === "record") {
    return <svg viewBox="0 0 24 24" width="16" height="16"><rect x="3.5" y="5" width="17" height="14" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M3.5 9.5h17M8 5v14" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>;
  }
  if (props.kind === "sensors") {
    return <svg viewBox="0 0 24 24" width="16" height="16"><circle cx="8" cy="12" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><circle cx="16" cy="12" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>;
  }
  if (props.kind === "k") {
    return <svg viewBox="0 0 24 24" width="16" height="16"><path d="M7 4v16M17 6l-8 7 8 7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  }
  return <svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.5" /><ellipse cx="12" cy="12" rx="3.5" ry="8" fill="none" stroke="currentColor" strokeWidth="1.2" /><path d="M4 12h16" stroke="currentColor" strokeWidth="1.2" /></svg>;
}

function cleanText(text) {
  return text.replace(/```[a-z]*/g, "").replace(/\$/g, "").replace(/^#+\s*/gm, "");
}

function Inline(props) {
  const bold = props.text.split("**");
  return bold.map((part, j) => {
    if (j % 2 === 1) {
      return <b key={j}>{part}</b>;
    }
    const code = part.split("`");
    return code.map((c, k) => {
      if (k % 2 === 1) {
        return <code key={j + "-" + k}>{c}</code>;
      }
      return <span key={j + "-" + k}>{c}</span>;
    });
  });
}

function Rich(props) {
  const lines = cleanText(props.text).split(/\n+/).filter((p) => p.trim().length > 0);
  const blocks = [];
  lines.forEach((line) => {
    const bullet = /^\s*([-*•]|\d+[.)])\s+/.test(line);
    const textOnly = line.replace(/^\s*([-*•]|\d+[.)])\s+/, "");
    const last = blocks[blocks.length - 1];
    if (bullet && last && last.list) {
      last.items.push(textOnly);
    } else if (bullet) {
      blocks.push({ list: true, items: [textOnly] });
    } else {
      blocks.push({ list: false, text: line });
    }
  });
  return (
    <div className="cx-rich">
      {blocks.map((b, i) => {
        if (b.list) {
          return <ul key={i}>{b.items.map((it, j) => <li key={j}><Inline text={it} /></li>)}</ul>;
        }
        return <p key={i}><Inline text={b.text} /></p>;
      })}
    </div>
  );
}

function clock(date) {
  return date.toTimeString().slice(0, 5);
}

function reaction(question, answer, unverified) {
  if (/\b(joke|funny|haha|lol|lmao)\b/i.test(question)) {
    return "funny";
  }
  if (/not sure|don't know|do not know|unclear|could you (clarify|rephrase)|which .{1,30} do you mean/i.test(answer)) {
    return "confused";
  }
  if (unverified && unverified.length > 0) {
    return "curious";
  }
  if (/\b(record|highest|largest|peak|first time|discover|surpris)/i.test(answer) && Math.random() < 0.45) {
    return "excited";
  }
  return "happy";
}

function Message(props) {
  const m = props.m;
  if (m.role === "user") {
    return (
      <div className="cx-row user">
        <div className="cx-bubble user"><p>{m.content}</p><span className="cx-time">{m.time}</span></div>
      </div>
    );
  }
  let warn = null;
  if (m.unverified && m.unverified.length > 0) {
    warn = <div className="cx-warn">Check on the site — not in our data: {m.unverified.join(", ")}</div>;
  }
  let src = null;
  if (m.sources && m.sources.length > 0) {
    src = <div className="cx-src">{m.sources.map((x) => <a key={x.source} href={x.page}>{x.source}</a>)}</div>;
  }
  let removed = null;
  if (m.removed > 0) {
    removed = <div className="cx-warn">{m.removed} sentence(s) removed: their numbers were not in our data.</div>;
  }
  let cls = "cx-bubble bot";
  let expr = "happy";
  if (m.error) {
    cls = "cx-bubble bot err";
    expr = "concerned";
  }
  if (props.last) {
    expr = props.expr;
  }
  return (
    <div className="cx-row bot">
      <span className="cx-av"><ChronosCharacter uid={"m" + props.index} size={34} expr={expr} still={!props.last} /></span>
      <div className={cls}>
        <Rich text={m.content} />
        {warn}
        {removed}
        {src}
        <span className="cx-time">{m.label} · {m.time}</span>
      </div>
    </div>
  );
}

export default function ChatAssistant() {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [models, setModels] = useState([{ id: "auto", label: "Auto · best available" }]);
  const [model, setModel] = useState("auto");
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [expr, setExpr] = useState("happy");

  useEffect(() => {
    if (!open) {
      return;
    }
    fetch(API_BASE + "/api/chat/models")
      .then((r) => r.json())
      .then((j) => {
        if (j && j.data && j.data.length > 0) {
          setModels(j.data);
        }
      })
      .catch(() => setModels([{ id: "auto", label: "Auto · best available" }]));
  }, [open]);

  useEffect(() => {
    const box = document.getElementById("chat-log");
    if (!box) {
      return;
    }
    if (msgs.length === 0) {
      box.scrollTop = 0;
    } else {
      box.scrollTop = box.scrollHeight;
    }
  }, [msgs, busy, open]);

  useEffect(() => {
    if (!open || busy || expr === "sleepy") {
      return undefined;
    }
    const t = setTimeout(() => setExpr("sleepy"), 25000);
    return () => clearTimeout(t);
  }, [open, busy, expr, text, msgs]);

  function openPanel() {
    setOpen(true);
    setClosing(false);
    setExpr("happy");
  }

  function closePanel() {
    setExpr("happy");
    setClosing(true);
    setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, 320);
  }

  function onType(value) {
    setText(value);
    if (busy) {
      return;
    }
    if (value.trim().length > 0) {
      setExpr("listening");
    } else {
      setExpr("happy");
    }
  }

  function send(question) {
    const q = question.trim();
    if (!q || busy) {
      return;
    }
    const history = msgs.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content }));
    const next = msgs.concat([{ role: "user", content: q, time: clock(new Date()) }]);
    setMsgs(next);
    setText("");
    setBusy(true);
    setExpr("thinking");
    fetch(API_BASE + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: q, history: history, page: window.location.pathname, context: { title: document.title }, model: model }),
    })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j: j })))
      .then((res) => {
        if (res.ok && res.j.data) {
          setMsgs(next.concat([{ role: "assistant", content: res.j.data.answer, label: res.j.data.label, unverified: res.j.data.unverified_numbers, sources: res.j.data.sources, removed: res.j.data.removed_statements, time: clock(new Date()) }]));
          setExpr(reaction(q, res.j.data.answer || "", res.j.data.unverified_numbers));
        } else {
          setMsgs(next.concat([{ role: "assistant", content: "No AI model answered right now. Try again in a moment or pick another model.", label: "unavailable", error: true, time: clock(new Date()) }]));
          setExpr("concerned");
        }
        setBusy(false);
      })
      .catch(() => {
        setMsgs(next.concat([{ role: "assistant", content: "The backend is not reachable right now. If it was asleep, it wakes in about a minute — try again.", label: "unavailable", error: true, time: clock(new Date()) }]));
        setExpr("concerned");
        setBusy(false);
      });
  }

  if (!open) {
    return (
      <button className="chat-fab cx-fab" onClick={openPanel} aria-label="Ask Chronos, the site assistant">
        <span className="cx-fab-mark"><ChronosCharacter uid="fab" size={46} expr="happy" /></span>
        <span className="cx-fab-text"><b>Ask Chronos</b><small>space &amp; fire data companion</small></span>
      </button>
    );
  }

  let body = (
    <div className="cx-hello">
      <div className="cx-stage"><ChronosCharacter uid="hello" size={178} expr={expr} orbit={true} welcome={true} /></div>
      <h4>Hey, I'm Chronos.</h4>
      <p className="cx-hello-lead">Your guide through 25 years of satellite fire observations.</p>
      <p className="cx-hello-sub">Ask me about MODIS, VIIRS, wildfire trends, or the science behind the record.</p>
      <div className="cx-sugg">
        {SUGGEST.map((s) => (
          <button key={s[1]} type="button" onClick={() => send(s[1])}>
            <i><SuggestIcon kind={s[0]} /></i>
            <span><b>{s[1]}</b><small>{s[2]}</small></span>
          </button>
        ))}
      </div>
    </div>
  );
  if (msgs.length > 0) {
    let lastBot = -1;
    msgs.forEach((m, i) => {
      if (m.role !== "user") {
        lastBot = i;
      }
    });
    body = msgs.map((m, i) => <Message key={i} m={m} index={i} last={i === lastBot && !busy} expr={expr} />);
  }
  let typing = null;
  if (busy) {
    typing = (
      <div className="cx-row bot">
        <span className="cx-av"><ChronosCharacter uid="typing" size={34} expr="thinking" /></span>
        <div className="cx-bubble bot typing"><span /><span /><span /><em>Chronos is reading the record…</em></div>
      </div>
    );
  }
  let panelCls = "chat-panel cx-panel";
  if (closing) {
    panelCls = "chat-panel cx-panel closing";
  }

  return (
    <section className={panelCls} aria-label="Ask Chronos assistant">
      <header className="cx-head">
        <span className="cx-head-av"><ChronosCharacter uid="head" size={46} expr={expr} /></span>
        <div className="cx-who">
          <b>Chronos</b>
          <small><i />Your space &amp; fire data companion</small>
        </div>
        <button className="cx-x" onClick={closePanel} aria-label="Close the assistant">
          <svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </button>
      </header>
      <div className="cx-model">
        <span>Model</span>
        <label className="cx-select">
          <select value={model} onChange={(event) => setModel(event.target.value)} aria-label="AI model">
            {models.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </label>
      </div>
      <div className="cx-log" id="chat-log">
        {body}
        {typing}
      </div>
      <form className="cx-form" onSubmit={(event) => { event.preventDefault(); send(text); }}>
        <input value={text} onChange={(event) => onType(event.target.value)} onBlur={() => { if (!busy && expr === "listening") { setExpr("happy"); } }} placeholder="Ask Chronos about the fire record…" aria-label="Your question" />
        <button type="submit" disabled={busy || text.trim().length === 0} aria-label="Send">
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l16-8-6 16-2.5-6.5z" fill="currentColor" /></svg>
        </button>
      </form>
      <p className="cx-foot">Words by AI · every fire number comes from the site's own data</p>
    </section>
  );
}
