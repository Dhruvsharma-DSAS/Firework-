import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";

function findGuide(target, selector) {
  if (target) {
    return document.getElementById(target);
  }
  if (selector) {
    return document.querySelector(selector);
  }
  return null;
}

function scrollToGuide(target, selector) {
  const el = findGuide(target, selector);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

export function GuideCue(props) {
  const [float, setFloat] = useState(false);

  useEffect(() => {
    function onScroll() {
      const el = findGuide(props.target, props.selector);
      if (!el) {
        setFloat(false);
        return;
      }
      const top = el.getBoundingClientRect().top;
      setFloat(window.scrollY > 380 && top > window.innerHeight * 0.85);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [props.target, props.selector]);

  let floating = null;
  if (float) {
    floating = createPortal(
      <button type="button" className="guide-float" onClick={() => scrollToGuide(props.target, props.selector)}>
        <span className="guide-book" aria-hidden="true">?</span>How to read this page<i aria-hidden="true">↓</i>
      </button>,
      document.body
    );
  }

  return (
    <>
      <button type="button" className="guide-cue" onClick={() => scrollToGuide(props.target, props.selector)}>
        <span className="guide-book" aria-hidden="true">?</span>
        <span>New here? <b>How to read this page</b></span>
        <i aria-hidden="true">↓</i>
      </button>
      {floating}
    </>
  );
}

export default function PageGuide(props) {
  const navigate = useNavigate();

  function go(event, to) {
    event.preventDefault();
    navigate(to);
  }

  return (
    <section className="pg-guide" id={props.id} aria-label={props.title} style={{ "--ph": props.accent || "var(--viirs)" }}>
      <header className="pg-guide-head">
        <div className="eyebrow">{props.eyebrow}</div>
        <h2>{props.title}</h2>
        <p>{props.intro}</p>
      </header>

      <div className="pg-watch">
        {props.watch.map((w) => (
          <a key={w.to} className="pg-watch-card" href={w.to} onClick={(e) => go(e, w.to)}>
            <span className="pg-play" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor" /></svg></span>
            <span><b>{w.title}</b><small>{w.sub}</small></span>
          </a>
        ))}
      </div>

      <div className="pg-cards">
        {props.cards.map((c, i) => (
          <article key={c.title} className="pg-card">
            <span className="pg-n">{String(i + 1).padStart(2, "0")}</span>
            <h3>{c.title}</h3>
            <p>{c.text}</p>
            <div className="pg-links">
              {(c.links || []).map((l) => (
                <a key={l.to + l.label} href={l.to} onClick={(e) => go(e, l.to)}>{l.label} →</a>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
