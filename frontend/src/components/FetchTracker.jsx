import { useEffect, useState } from "react";

const NODES = [
  ["Satellites", "MODIS · VIIRS passes"],
  ["NASA FIRMS", "near-real-time feed"],
  ["FIREWORK server", "fetch, cache, sample"],
  ["Your globe", "draw the pixels"],
];

function clock(s) {
  const m = Math.floor(s / 60);
  let r = String(s % 60);
  if (r.length < 2) {
    r = "0" + r;
  }
  return "0" + m + ":" + r;
}

export default function FetchTracker(props) {
  const [sec, setSec] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => setSec(Math.floor((Date.now() - start) / 1000)), 500);
    return () => clearInterval(id);
  }, []);

  let msg = "Asking NASA FIRMS for the last " + props.days + " days of MODIS and VIIRS fire pixels…";
  let stage = 1;
  if (sec >= 6) {
    msg = "Still receiving. The free data server may be waking up — this is normal.";
    stage = 2;
  }
  if (sec >= 20) {
    msg = "Waking a sleeping server can take up to a minute. Nothing is broken; the globe fills in as soon as the pixels arrive.";
    stage = 2;
  }

  return (
    <div className="ftrack" role="status" aria-live="polite">
      <div className="ftrack-card">
        <div className="ftrack-top">
          <span className="ftrack-eye"><i />Receiving the latest fires</span>
          <span className="ftrack-clock">{clock(sec)}</span>
        </div>
        <div className="ftrack-path">
          <span className="ftrack-line"><b /><b /><b /></span>
          {NODES.map((n, i) => {
            let cls = "ftrack-node";
            if (i < stage) {
              cls = "ftrack-node done";
            } else if (i === stage) {
              cls = "ftrack-node on";
            }
            return (
              <div className={cls} key={n[0]}>
                <span className="ftrack-dot" />
                <b>{n[0]}</b>
                <small>{n[1]}</small>
              </div>
            );
          })}
        </div>
        <p className="ftrack-msg">{msg}</p>
      </div>
    </div>
  );
}
