import { useEffect } from "react";
import katex from "katex";

export default function MathBlock(props) {
  const id = props.id;

  useEffect(() => {
    const el = document.getElementById(id);
    if (!el) {
      return;
    }
    el.innerHTML = katex.renderToString(props.tex || "", { displayMode: Boolean(props.display), throwOnError: false, strict: "ignore" });
  }, [id, props.tex, props.display]);

  if (props.display) {
    return <div className="mb-display" id={id} />;
  }
  return <span className="mb-inline" id={id} />;
}

export function RichText(props) {
  const parts = String(props.text || "").split("$");
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 1) {
          return <MathBlock key={i} id={props.id + "-m" + i} tex={part} />;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}
