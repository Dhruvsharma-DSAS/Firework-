import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import MathBlock, { RichText } from "../components/MathBlock.jsx";
import SystemMap, { PAGES } from "../components/SystemMap.jsx";

const CAVEAT = "A hot spot is a pixel, not a fire; a cell-day is not burned area; harmonised values are estimates with an interval. Research decision support, not a life-safety alert system.";

function firstText(items) {
  const found = (items || []).find((it) => typeof it === "string");
  if (found) {
    return found.replace(/^• /, "");
  }
  return "";
}

function Paragraphs(props) {
  const blocks = [];
  (props.items || []).forEach((item, i) => {
    if (item && typeof item === "object" && item.tex) {
      blocks.push({ kind: "tex", tex: item.tex, key: i });
      return;
    }
    const text = String(item);
    if (text.startsWith("• ")) {
      const last = blocks[blocks.length - 1];
      if (last && last.kind === "steps") {
        last.items.push({ text: text.slice(2), key: i });
      } else {
        blocks.push({ kind: "steps", items: [{ text: text.slice(2), key: i }], key: i });
      }
      return;
    }
    blocks.push({ kind: "p", text: text, key: i });
  });
  return (
    <>
      {blocks.map((b) => {
        if (b.kind === "tex") {
          return <div key={b.key} className="fp-eq-inline"><MathBlock id={props.id + "-t" + b.key} tex={b.tex} display={true} /></div>;
        }
        if (b.kind === "steps") {
          return (
            <ol key={b.key} className="fp-steps">
              {b.items.map((s) => <li key={s.key}><RichText id={props.id + "-s" + s.key} text={s.text} /></li>)}
            </ol>
          );
        }
        return <p key={b.key}><RichText id={props.id + "-p" + b.key} text={b.text} /></p>;
      })}
    </>
  );
}

function Card(props) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(false);
  }, [props.id]);
  let body = <p><RichText id={props.id + "-short"} text={firstText(props.items)} /></p>;
  let label = "Read more";
  if (open) {
    body = <Paragraphs id={props.id + "-full"} items={props.items} />;
    label = "Show less";
  }
  let more = null;
  if ((props.items || []).length > 1) {
    more = <button type="button" className="fl-more" onClick={() => setOpen(!open)} aria-expanded={open}>{label}</button>;
  }
  let cls = "learn-point fl-card";
  if (open) {
    cls = "learn-point fl-card open";
  }
  return (
    <div className={cls}>
      <span className="fl-card-n">{props.num}</span>
      <h4>{props.title}</h4>
      <div className="fl-card-body">{body}</div>
      {more}
    </div>
  );
}

function Fold(props) {
  return (
    <details className="fl-fold">
      <summary><span className="fl-fold-n">{props.num}</span>{props.title}<small>{props.hint}</small></summary>
      <div className="fl-fold-body">{props.children}</div>
    </details>
  );
}

function Overview(props) {
  const navigate = useNavigate();
  const groups = [];
  props.formulas.forEach((f) => {
    let g = groups.find((x) => x.family === f.family);
    if (!g) {
      g = { family: f.family, items: [] };
      groups.push(g);
    }
    g.items.push(f);
  });
  return (
    <>
      <span className="eyebrow">Start here</span>
      <h2 className="learn-title">Pick a formula on the left</h2>
      <p className="lead">Each formula has a short explanation, its equation, a worked example on real NASA FIRMS data and a detailed PDF. Open the folded sections at the bottom of a page only when you want the full detail.</p>
      <div className="learn-points fl-families">
        {groups.map((g) => (
          <button key={g.family} type="button" className="learn-point fl-family" onClick={() => navigate("/formulas/" + g.items[0].id)}>
            <h4>{g.family}</h4>
            <p>{g.items.length} formulas · {g.items[0].id}–{g.items[g.items.length - 1].id}</p>
          </button>
        ))}
      </div>
    </>
  );
}

export default function FormulaPage(props) {
  const navigate = useNavigate();
  const f = props.formula;
  const list = props.formulas;
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);
  const [video, setVideo] = useState(null);

  let fid = "";
  if (f) {
    fid = f.id;
  }

  useEffect(() => {
    if (f) {
      document.title = f.id + " " + f.name + " · FIREWORK CHRONOS";
    } else {
      document.title = "Formulas · FIREWORK CHRONOS";
    }
    setCopied(false);
    setVideo(null);
    const main = document.getElementById("learn-main");
    if (main && f && main.getBoundingClientRect().top < 0) {
      main.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (!f) {
      return;
    }
    fetch("/formulas/video/videos.json")
      .then((r) => r.json())
      .then((v) => setVideo(v[f.id] || null))
      .catch(() => setVideo(null));
  }, [fid]);

  useEffect(() => {
    function onKey(event) {
      const tag = (event.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") {
        return;
      }
      if (event.key === "/") {
        event.preventDefault();
        const box = document.getElementById("fl-search");
        if (box) {
          box.focus();
        }
        return;
      }
      const at = list.findIndex((x) => x.id === fid);
      if (event.key === "ArrowRight" && at < list.length - 1) {
        navigate("/formulas/" + list[at + 1].id);
      } else if (event.key === "ArrowLeft" && at > 0) {
        navigate("/formulas/" + list[at - 1].id);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fid, list, navigate]);

  useEffect(() => {
    if (!import.meta.env.DEV || !f) {
      return undefined;
    }
    const timer = setTimeout(() => {
      const bad = document.querySelectorAll(".fl .katex-error");
      if (bad.length > 0) {
        console.warn("KaTeX errors on " + f.id + ": " + bad.length);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [fid]);

  const q = query.trim().toLowerCase();
  const shown = list.filter((x) => {
    if (!q) {
      return true;
    }
    return (x.id + " " + x.id.replace("F0", "F") + " " + x.name + " " + x.lead).toLowerCase().indexOf(q) >= 0;
  });
  const families = [];
  shown.forEach((x) => {
    if (families.indexOf(x.family) < 0) {
      families.push(x.family);
    }
  });

  function onSearchKey(event) {
    if (event.key === "Enter" && shown.length > 0) {
      navigate("/formulas/" + shown[0].id);
    }
  }

  let none = null;
  if (shown.length === 0) {
    none = <p className="fl-none">No formula matches “{query}”.</p>;
  }

  const nav = (
    <nav className="panel learn-nav fl-nav" aria-label="Formulas">
      <input id="fl-search" className="fl-search" type="search" placeholder="Search · press /" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onSearchKey} autoComplete="off" />
      {families.map((fam) => (
        <div key={fam} className="fl-group">
          <div className="fl-group-k">{fam}</div>
          {shown.filter((x) => x.family === fam).map((x) => {
            let cls = "learn-nav-item fl-item";
            if (x.id === fid) {
              cls = "learn-nav-item fl-item on";
            }
            return (
              <button key={x.id} type="button" className={cls} onClick={() => navigate("/formulas/" + x.id)} aria-current={x.id === fid}>
                <span className="mono fl-item-id">{x.id}</span>
                <span>{x.name}<small><i className={"fl-dot st-" + x.status} />{x.status_label}</small></span>
              </button>
            );
          })}
        </div>
      ))}
      {none}
    </nav>
  );

  let main = <Overview formulas={list} />;
  if (f) {
    const at = list.findIndex((x) => x.id === f.id);
    let prev = null;
    if (at > 0) {
      prev = <button type="button" className="btn small" onClick={() => navigate("/formulas/" + list[at - 1].id)}>← {list[at - 1].id} {list[at - 1].name}</button>;
    }
    let next = null;
    if (at < list.length - 1) {
      next = <button type="button" className="btn small" onClick={() => navigate("/formulas/" + list[at + 1].id)}>{list[at + 1].id} {list[at + 1].name} →</button>;
    }
    const eqs = f.equations || [];
    let videoBlock = null;
    if (video) {
      videoBlock = (
        <div className="learn-video">
          <div className="learn-video-head">
            <span className="chip archive"><span className="dot" />Video explanation · {Math.floor(video.seconds / 60)}:{String(Math.round(video.seconds % 60)).padStart(2, "0")}</span>
            <small>Narrated walk-through of {f.id}</small>
          </div>
          <video key={video.src} controls preload="none" playsInline poster={video.poster} src={video.src} />
        </div>
      );
    }
    let copyLabel = "Copy";
    if (copied) {
      copyLabel = "Copied";
    }
    const fig = (f.figures || [])[0];
    let figure = null;
    if (fig) {
      figure = (
        <figure className="fp-fig">
          <div className="fp-paper"><img src={"/formulas/" + fig.file} alt={fig.title} loading="lazy" /></div>
          <figcaption><b>{fig.title}.</b> <RichText id={f.id + "-fc"} text={fig.caption} /><span className="fp-muted">Data: {fig.data}</span></figcaption>
        </figure>
      );
    }
    const more = (f.figures || []).slice(1);
    let moreFold = null;
    if (more.length > 0) {
      moreFold = (
        <Fold num="10" title="More figures" hint={more.length + " figure"}>
          {more.map((g, i) => (
            <figure className="fp-fig" key={g.file}>
              <div className="fp-paper"><img src={"/formulas/" + g.file} alt={g.title} loading="lazy" /></div>
              <figcaption><b>{g.title}.</b> <RichText id={f.id + "-fm" + i} text={g.caption} /><span className="fp-muted">Data: {g.data}</span></figcaption>
            </figure>
          ))}
        </Fold>
      );
    }
    main = (
      <>
        <div className="row learn-pager top">
          {prev}
          <span style={{ flex: 1 }} />
          {next}
        </div>
        <span className="eyebrow">{f.id} · {f.family}</span>
        <h2 className="learn-title">{f.name}</h2>
        <div className="fl-status"><span className={"st st-" + f.status}><i />{f.status_label}</span><span className="fp-chips">{PAGES.filter((p) => f.pages.indexOf(p[0]) >= 0 && p[0] !== "formulas").map((p) => <a key={p[0]} className="route-chip" href={p[2]} onClick={(e) => { e.preventDefault(); navigate(p[2]); }}>{p[1]}</a>)}</span></div>
        {videoBlock}
        <p className="lead"><RichText id={f.id + "-lead"} text={f.lead} /></p>

        <div className="fp-formula">
          {eqs.map((tex, i) => {
            let tag = "(" + f.id + ")";
            if (eqs.length > 1) {
              tag = "(" + f.id + "." + (i + 1) + ")";
            }
            return (
              <div className="fp-eq" key={i}>
                <MathBlock id={f.id + "-eq" + i} tex={tex} display={true} />
                <span className="fp-eqno">{tag}</span>
              </div>
            );
          })}
        </div>
        <p className="fp-reads"><RichText id={f.id + "-reads"} text={f.reads} /></p>

        <a className="learn-pdf" href={f.pdf_url} target="_blank" rel="noreferrer">
          <span className="learn-pdf-icon">PDF</span>
          <span>
            <b>Read the full {f.id} handbook page</b>
            <small>Derivation, every symbol, figures, worked example and references, as a printable PDF.</small>
          </span>
          <span className="learn-pdf-go">Open ↗</span>
        </a>

        <div className="learn-points fl-cards">
          <Card id={f.id + "-o"} num="01" title="Where it comes from" items={f.origin} />
          <Card id={f.id + "-w"} num="02" title="Why FIREWORK needs it" items={f.why} />
          <Card id={f.id + "-h"} num="03" title="How it works" items={f.how} />
          <Card id={f.id + "-e"} num="04" title="Worked example" items={f.example} />
        </div>

        <div className="fp-keys">
          {(f.key_numbers || []).map((k, i) => (
            <div key={i}><b>{k.value}</b><span>{k.label}</span></div>
          ))}
        </div>

        {figure}

        <div className="fl-folds">
          <Fold num="05" title="Symbols" hint={(f.symbols || []).length + " symbols"}>
            <div className="fp-scroll">
              <table className="fp-table">
                <thead><tr><th>Symbol</th><th>Meaning</th><th>Unit</th><th>Where the value comes from</th></tr></thead>
                <tbody>
                  {(f.symbols || []).map((s, i) => (
                    <tr key={i}>
                      <td className="fp-sym"><MathBlock id={f.id + "-sym" + i} tex={s.tex} /></td>
                      <td><RichText id={f.id + "-sm" + i} text={s.meaning} /></td>
                      <td>{s.unit}</td>
                      <td>{s.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Fold>
          <Fold num="06" title="Where it lives in FIREWORK" hint="pipeline stage and pages">
            <SystemMap stages={f.stages} pages={f.pages} />
            <div className="fp-scroll">
              <table className="fp-table fp-kv"><tbody>{(f.where || []).map((w, i) => <tr key={i}><th>{w.key}</th><td>{w.value}</td></tr>)}</tbody></table>
            </div>
          </Fold>
          <Fold num="07" title="Conditions and limits" hint={(f.limits || []).length + " points"}>
            <ul className="fp-limits">{(f.limits || []).map((l, i) => <li key={i}><RichText id={f.id + "-l" + i} text={l} /></li>)}</ul>
          </Fold>
          <Fold num="08" title="Reference code" hint="Python">
            <div className="fp-code">
              <button type="button" onClick={() => navigator.clipboard.writeText(f.code || "").then(() => setCopied(true)).catch(() => setCopied(false))}>{copyLabel}</button>
              <pre><code>{f.code}</code></pre>
            </div>
          </Fold>
          <Fold num="09" title="Related formulas and sources" hint={(f.references || []).length + " references"}>
            <ul className="fp-related">{(f.related || []).map((r) => <li key={r.id}><a href={"/formulas/" + r.id} onClick={(e) => { e.preventDefault(); navigate("/formulas/" + r.id); }}><span>{r.id}</span> {r.name}</a></li>)}</ul>
            <ol className="fp-refs">{(f.references || []).map((r, i) => <li key={i}>{r}</li>)}</ol>
          </Fold>
          {moreFold}
        </div>

        <div className="learn-more fl-foot">
          <p>{CAVEAT}</p>
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            <a className="btn primary" href={"/formulas/pdf/" + f.pdf} download>Download {f.id} (PDF)</a>
            <a className="btn" href={f.pdf_url} target="_blank" rel="noreferrer">Open in Google Drive ↗</a>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="page learn fl">
      <header className="ph" style={{ "--ph": "var(--fire)" }}>
        <div className="eyebrow">Trust · Method reference</div>
        <h1 className="ph-title">Formulas <em>F01–F46</em></h1>
        <p className="ph-q">46 formulas behind the fire record</p>
      </header>
      <p className="lead">Every number on FIREWORK comes from one of these formulas: where it comes from, why we need it, how it works on real NASA FIRMS data, and where it appears on the site.</p>
      <div className="learn-grid">
        {nav}
        <article className="panel learn-main fl-main" id="learn-main">{main}</article>
      </div>
    </div>
  );
}
