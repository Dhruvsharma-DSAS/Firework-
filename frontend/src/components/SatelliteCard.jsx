import { PLATFORM_COLORS } from "../lib/colors.js";
import SatViewer from "./SatViewer.jsx";

export const SAT_STORY = {
  terra: {
    role: "MODIS · morning pass",
    text: "NASA's flagship Earth Observing System satellite. Its MODIS instrument started the FIRMS fire record in November 2000 and gives the 1 km view every year in the calendar is measured against. Terra crosses the equator in the late morning and has been drifting earlier as its fuel runs low.",
    imageNote: "FIREWORK 3D model · EOS AM-1 layout: MODIS, MISR, ASTER, MOPITT, CERES",
  },
  aqua: {
    role: "MODIS · afternoon pass",
    text: "Terra's afternoon twin, carrying a second MODIS. Crossing at about 13:30 local time it sees fires close to their daily peak. Together Terra and Aqua give up to four 1 km looks a day at every place on Earth.",
    imageNote: "Same 3D model as the home page",
  },
  snpp: {
    role: "VIIRS · reference ruler",
    text: "Suomi NPP carried the first VIIRS: 375 m fire pixels, about seven times finer by area than MODIS, across a 3,040 km swath. FIREWORK's exchange rate k is VIIRS S-NPP over MODIS. NASA stopped delivering new S-NPP data on 2 November 2026.",
    imageNote: "Same 3D model as the home page",
  },
  noaa20: {
    role: "VIIRS · operational",
    text: "NOAA-20 (JPSS-1) flies the same orbit as S-NPP, about half an orbit apart, with an identical VIIRS. It is built on the same Ball spacecraft family, so the model is the S-NPP design plus NOAA-20's extra Ka-band antenna. FIREWORK keeps it as a separate platform and never mixes it into k.",
    imageNote: "S-NPP design + Ka-band antenna (its real difference)",
  },
  noaa21: {
    role: "VIIRS · newest",
    text: "NOAA-21 (JPSS-2) is the newest VIIRS, about half an orbit from NOAA-20. It uses a different spacecraft, Northrop Grumman's LEOStar-3, with one five-panel solar wing and a Ka-band downlink. Its fires reach FIRMS as near-real-time data.",
    imageNote: "Approximate: no public 3D model exists · built from NOAA and eoPortal facts",
  },
};

function formatDate(iso) {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export default function SatelliteCard(props) {
  const sat = props.sat;
  if (!sat) {
    return null;
  }
  const story = SAT_STORY[sat.id] || { role: sat.instrument, text: "", imageNote: "" };
  const color = PLATFORM_COLORS[sat.id] || "#ffffff";
  const orbit = sat.illustrative_orbit || {};
  let where = null;
  if (props.position) {
    where = <div className="satcard-where">Now over {props.position.lat.toFixed(1)}°, {props.position.lon.toFixed(1)}°</div>;
  }
  return (
    <section className="panel satcard" style={{ "--sat": color }} aria-live="polite">
      <header className="satcard-head">
        <div>
          <div className="satcard-role">{story.role}</div>
          <h3>{sat.name}</h3>
          {where}
        </div>
        <button type="button" className="satcard-x" onClick={props.onClose} aria-label="Close satellite card">✕</button>
      </header>
      <SatViewer satId={sat.id} name={sat.name} role={story.role} />
      <div className="satcard-body">
        <dl>
          <div><dt>Launched</dt><dd>{formatDate(sat.launch)}</dd></div>
          <div><dt>Orbit</dt><dd>{orbit.altitude_km} km · {orbit.inclination_deg}°</dd></div>
          <div><dt>Equator crossing</dt><dd>{sat.crossing.split("(")[0].trim()}</dd></div>
          <div><dt>In FIRMS since</dt><dd>{formatDate(sat.firms_start)}</dd></div>
        </dl>
        <p>{story.text}</p>
        <small className="satcard-note">Model · {story.imageNote}</small>
      </div>
    </section>
  );
}
