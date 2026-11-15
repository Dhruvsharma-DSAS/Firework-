import { useEffect, useState } from "react";
import { pointColor, densityColor, PLATFORM_COLORS, PLATFORM_LABELS } from "../lib/colors.js";
import { nearestPoint } from "../lib/geo.js";
import { splitAtDateline, positionOf, trackOf, subsolarPoint } from "../lib/orbits.js";
import { satIcon, shortName } from "./GlobeView.jsx";

const BASEMAP_URLS = {
  bluemarble: "/textures/earth-blue-marble.jpg",
  night: "/textures/earth-night.jpg",
  day: "/textures/earth-day.jpg",
  dark: "/textures/earth-dark.jpg",
};

const SQ3 = Math.sqrt(3);
const HEX_DEG = 0.6;
const DENSITY_SCALE = 90;
const MAX_K = 600;
const LABEL_LIFT = { noaa20: 26, noaa21: 52 };
const NICE_KM = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];

function minK(h) {
  return h / 180;
}

function wrap(lon) {
  let v = lon;
  while (v > 180) {
    v = v - 360;
  }
  while (v < -180) {
    v = v + 360;
  }
  return v;
}

function clampView(view, h) {
  const k = Math.max(minK(h), Math.min(MAX_K, view.k));
  const halfH = h / (2 * k);
  const lat0 = Math.max(-90 + halfH, Math.min(90 - halfH, view.lat0));
  return { k: k, lon0: wrap(view.lon0), lat0: lat0 };
}

function homeView(h) {
  return clampView({ k: h / 150, lon0: 40, lat0: 12 }, h);
}

function viewOfAltitude(place, h) {
  const span = Math.max(4, place.altitude * 42);
  return clampView({ k: h / span, lon0: place.lng, lat0: place.lat }, h);
}

function hexOf(x, y) {
  const q = ((SQ3 / 3) * x - y / 3) / HEX_DEG;
  const r = ((2 / 3) * y) / HEX_DEG;
  let rx = Math.round(q);
  let ry = Math.round(-q - r);
  let rz = Math.round(r);
  const dx = Math.abs(rx - q);
  const dy = Math.abs(ry + q + r);
  const dz = Math.abs(rz - r);
  if (dx > dy && dx > dz) {
    rx = -ry - rz;
  } else if (dy <= dz) {
    rz = -rx - ry;
  }
  return [rx, rz];
}

function hexCenter(q, r) {
  return [HEX_DEG * SQ3 * (q + r / 2), HEX_DEG * 1.5 * r];
}

function binDensity(points) {
  const map = {};
  points.forEach((p) => {
    const qr = hexOf(p.lon, -p.lat);
    const key = qr[0] + "_" + qr[1];
    if (!map[key]) {
      const c = hexCenter(qr[0], qr[1]);
      map[key] = { key: key, lon: c[0], lat: -c[1], points: [] };
    }
    map[key].points.push(p);
  });
  return Object.values(map);
}

function nightEdge(lon, sun) {
  let s = sun.lat;
  if (Math.abs(s) < 0.1) {
    s = 0.1;
  }
  const d = ((lon - sun.lon) * Math.PI) / 180;
  return (Math.atan(-Math.cos(d) / Math.tan((s * Math.PI) / 180)) * 180) / Math.PI;
}

function contextColor(ctx, c) {
  if (ctx.layer === "burned") {
    const t = Math.min(1, c.value / 0.4);
    return "rgba(255," + Math.round(181 - 122 * t) + "," + Math.round(71 + 7 * t) + "," + (0.35 + 0.55 * t).toFixed(2) + ")";
  }
  if (ctx.layer === "clearsky") {
    const t = Math.min(1, c.value / 31);
    return "rgba(" + Math.round(58 + 3 * t) + "," + Math.round(66 + 148 * t) + "," + Math.round(80 + 165 * t) + ",0.62)";
  }
  const meta = (ctx.meta.classes || {})[String(c.value)];
  if (!meta) {
    return "rgba(136,136,136,0.6)";
  }
  return meta.color;
}

function degText(v, neg, pos) {
  if (v < 0) {
    return Math.abs(v).toFixed(2) + "°" + neg;
  }
  return v.toFixed(2) + "°" + pos;
}

export default function FlatView(props) {
  const hostId = props.hostId || "flat-host";
  const canvasId = hostId + "-canvas";
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState({ k: 1, lon0: 40, lat0: 12 });
  const [target, setTarget] = useState(null);
  const [img, setImg] = useState(null);
  const [drag, setDrag] = useState(null);
  const [hover, setHover] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const host = document.getElementById(hostId);
    if (!host) {
      return undefined;
    }
    function measure() {
      if (host.clientWidth > 0 && host.clientHeight > 0) {
        setSize({ w: host.clientWidth, h: host.clientHeight });
      }
    }
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => ro.disconnect();
  }, [hostId]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 2000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (size.h === 0) {
      return;
    }
    if (props.flyTo) {
      setView(viewOfAltitude(props.flyTo, size.h));
    } else {
      setView(homeView(size.h));
    }
  }, [size.w, size.h]);

  useEffect(() => {
    if (size.h === 0 || !props.flyTo) {
      return;
    }
    setTarget(viewOfAltitude(props.flyTo, size.h));
  }, [props.flyTo]);

  useEffect(() => {
    if (!target) {
      return undefined;
    }
    let raf = 0;
    function step() {
      let done = false;
      setView((v) => {
        let dLon = target.lon0 - v.lon0;
        if (dLon > 180) {
          dLon = dLon - 360;
        } else if (dLon < -180) {
          dLon = dLon + 360;
        }
        const lk = Math.log(target.k / v.k);
        if (Math.abs(lk) < 0.004 && Math.abs(dLon) * v.k < 0.5 && Math.abs(target.lat0 - v.lat0) * v.k < 0.5) {
          done = true;
          return target;
        }
        return clampView({ k: v.k * Math.exp(lk * 0.2), lon0: v.lon0 + dLon * 0.2, lat0: v.lat0 + (target.lat0 - v.lat0) * 0.2 }, size.h);
      });
      if (!done) {
        raf = requestAnimationFrame(step);
      }
    }
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  useEffect(() => {
    setImg(null);
    const url = BASEMAP_URLS[props.basemap];
    if (!url) {
      return;
    }
    const im = new Image();
    im.onload = () => setImg(im);
    im.src = url;
  }, [props.basemap]);

  const layers = props.layers || {};
  const points = props.points || [];
  const w = size.w;
  const h = size.h;
  const k = view.k;
  function to(lon, lat) {
    return [(lon - view.lon0) * k + w / 2, (view.lat0 - lat) * k + h / 2];
  }
  function near(lon) {
    let v = lon;
    while (v - view.lon0 > 180) {
      v = v - 360;
    }
    while (v - view.lon0 < -180) {
      v = v + 360;
    }
    return v;
  }
  function toNear(lon, lat) {
    return to(near(lon), lat);
  }
  function from(x, y) {
    return [wrap(view.lon0 + (x - w / 2) / k), view.lat0 - (y - h / 2) / k];
  }
  let dens = [];
  if (layers.density) {
    dens = binDensity(points);
  }
  let shown = [];
  if (layers.points !== false) {
    shown = points;
  }
  const dotR = Math.max(1.4, Math.min(6, 0.16 * k));

  useEffect(() => {
    const cv = document.getElementById(canvasId);
    if (!cv || w === 0) {
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (cv.width !== w * dpr || cv.height !== h * dpr) {
      cv.width = w * dpr;
      cv.height = h * dpr;
    }
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#050a16";
    ctx.fillRect(0, 0, w, h);
    const atlas = !BASEMAP_URLS[props.basemap];
    const worldW = 360 * k;
    const firstCopy = Math.floor((view.lon0 - w / (2 * k) + 180) / 360);
    const lastCopy = Math.floor((view.lon0 + w / (2 * k) + 180) / 360);
    const sun = subsolarPoint(now);
    let step = 30;
    if (k > 60) {
      step = 1;
    } else if (k > 24) {
      step = 5;
    } else if (k > 8) {
      step = 10;
    }
    const ctxCells = props.contextCells || { data: [] };
    const highlight = props.highlight || "";
    for (let copy = firstCopy; copy <= lastCopy; copy = copy + 1) {
      ctx.save();
      ctx.translate(copy * worldW, 0);
      const tl = to(-180, 90);
      const br = to(180, -90);
      const vx0 = -copy * worldW - 8;
      const vx1 = w - copy * worldW + 8;
      if (atlas) {
        ctx.fillStyle = "#0b1832";
        ctx.fillRect(tl[0], tl[1], br[0] - tl[0], br[1] - tl[1]);
      } else if (img) {
        ctx.drawImage(img, tl[0], tl[1], br[0] - tl[0], br[1] - tl[1]);
      }
      ctx.strokeStyle = "rgba(93, 123, 184, 0.18)";
      ctx.lineWidth = 0.6;
      for (let lon = -180; lon < 180; lon = lon + step) {
        const x = to(lon, 0)[0];
        if (x < vx0 || x > vx1) {
          continue;
        }
        ctx.beginPath();
        ctx.moveTo(x, tl[1]);
        ctx.lineTo(x, br[1]);
        ctx.stroke();
      }
      for (let lat = -90 + step; lat < 90; lat = lat + step) {
        const y = to(0, lat)[1];
        ctx.beginPath();
        ctx.moveTo(Math.max(tl[0], vx0), y);
        ctx.lineTo(Math.min(br[0], vx1), y);
        ctx.stroke();
      }
      if (ctxCells.layer && ctxCells.meta && ctxCells.data.length > 0) {
        const cs = ctxCells.meta.grid_deg * k * 0.98;
        ctxCells.data.forEach((c) => {
          if (ctxCells.layer === "landcover" && c.value === 80) {
            return;
          }
          const xy = to(c.lon, c.lat);
          if (xy[0] < vx0 || xy[0] > vx1) {
            return;
          }
          ctx.globalAlpha = 1;
          if (ctxCells.layer === "landcover") {
            ctx.globalAlpha = 0.6;
          }
          ctx.fillStyle = contextColor(ctxCells, c);
          ctx.fillRect(xy[0] - cs / 2, xy[1] - cs / 2, cs, cs);
        });
        ctx.globalAlpha = 1;
      }
      if (layers.borders !== false) {
        (props.countries || []).forEach((f) => {
          const g = f.geometry;
          if (!g) {
            return;
          }
          let polys = [g.coordinates];
          if (g.type === "MultiPolygon") {
            polys = g.coordinates;
          }
          const focus = highlight && f.properties.iso3 === highlight;
          ctx.beginPath();
          polys.forEach((poly) => {
            poly.forEach((ring) => {
              let prev = null;
              ring.forEach((pt, i) => {
                const xy = to(pt[0], pt[1]);
                if (i === 0 || (prev !== null && Math.abs(pt[0] - prev) > 180)) {
                  ctx.moveTo(xy[0], xy[1]);
                } else {
                  ctx.lineTo(xy[0], xy[1]);
                }
                prev = pt[0];
              });
            });
          });
          if (focus) {
            ctx.fillStyle = "rgba(255,77,94,0.2)";
            ctx.strokeStyle = "rgba(255,122,92,0.95)";
            ctx.lineWidth = 1.4;
          } else {
            ctx.fillStyle = "rgba(0,0,0,0)";
            if (atlas) {
              ctx.fillStyle = "rgba(120,150,205,0.16)";
            }
            ctx.strokeStyle = "rgba(230,237,243,0.26)";
            ctx.lineWidth = 0.6;
          }
          ctx.fill("evenodd");
          ctx.stroke();
        });
      }
      if (props.terminator) {
        ctx.beginPath();
        let edgeY = br[1];
        if (sun.lat < 0) {
          edgeY = tl[1];
        }
        ctx.moveTo(tl[0], edgeY);
        for (let lon = -180; lon <= 180; lon = lon + 2) {
          const xy = to(lon, nightEdge(lon, sun));
          ctx.lineTo(xy[0], xy[1]);
        }
        ctx.lineTo(br[0], edgeY);
        ctx.closePath();
        ctx.fillStyle = "rgba(1, 4, 11, 0.5)";
        ctx.fill();
      }
      const rad = Math.max(2.4, HEX_DEG * k * 0.82);
      dens.forEach((c) => {
        const xy = to(c.lon, c.lat);
        if (xy[0] < vx0 - rad || xy[0] > vx1 + rad || xy[1] < -rad || xy[1] > h + rad) {
          return;
        }
        ctx.beginPath();
        for (let i = 0; i < 6; i = i + 1) {
          const a = (Math.PI / 180) * (60 * i - 30);
          if (i === 0) {
            ctx.moveTo(xy[0] + rad * Math.cos(a), xy[1] + rad * Math.sin(a));
          } else {
            ctx.lineTo(xy[0] + rad * Math.cos(a), xy[1] + rad * Math.sin(a));
          }
        }
        ctx.closePath();
        ctx.globalAlpha = 0.55 + 0.4 * Math.min(1, c.points.length / DENSITY_SCALE);
        ctx.fillStyle = densityColor(Math.min(1, c.points.length / DENSITY_SCALE));
        ctx.fill();
        ctx.globalAlpha = 1;
      });
      if (layers.tracks && props.satellites) {
        ctx.setLineDash([6, 3]);
        ctx.lineWidth = 1.4;
        props.satellites.forEach((sat) => {
          ctx.strokeStyle = PLATFORM_COLORS[sat.id] || "#ffffff";
          splitAtDateline(trackOf(sat, now, 50, 50, 1)).forEach((seg) => {
            ctx.beginPath();
            seg.forEach((p, i) => {
              const xy = to(p[1], p[0]);
              if (i === 0) {
                ctx.moveTo(xy[0], xy[1]);
              } else {
                ctx.lineTo(xy[0], xy[1]);
              }
            });
            ctx.stroke();
          });
        });
        ctx.setLineDash([]);
      }
      shown.forEach((p) => {
        const xy = to(p.lon, p.lat);
        if (xy[0] < vx0 || xy[0] > vx1 || xy[1] < -4 || xy[1] > h + 4) {
          return;
        }
        let r = dotR;
        if (props.selected && p.id === props.selected.id) {
          r = dotR * 2.4;
        }
        ctx.beginPath();
        ctx.arc(xy[0], xy[1], r, 0, 7);
        ctx.fillStyle = pointColor(p, props.colorBy);
        ctx.fill();
      });
      ctx.restore();
    }
  });

  function localXY(event) {
    const r = event.currentTarget.getBoundingClientRect();
    return [event.clientX - r.left, event.clientY - r.top];
  }

  function pointNear(xy) {
    let best = null;
    let bestD = Math.max(7, dotR + 3);
    shown.forEach((p) => {
      const pxy = toNear(p.lon, p.lat);
      const d = Math.hypot(pxy[0] - xy[0], pxy[1] - xy[1]);
      if (d < bestD) {
        best = p;
        bestD = d;
      }
    });
    return best;
  }

  function hexNear(xy) {
    if (dens.length === 0) {
      return null;
    }
    const ll = from(xy[0], xy[1]);
    const qr = hexOf(ll[0], -ll[1]);
    return dens.find((c) => c.key === qr[0] + "_" + qr[1]) || null;
  }

  function zoomAt(xy, f, animate) {
    const base = target || view;
    const at = [base.lon0 + (xy[0] - w / 2) / base.k, base.lat0 - (xy[1] - h / 2) / base.k];
    const nk = Math.max(minK(h), Math.min(MAX_K, base.k * f));
    const next = clampView({ k: nk, lon0: at[0] - (xy[0] - w / 2) / nk, lat0: at[1] + (xy[1] - h / 2) / nk }, h);
    if (animate) {
      setTarget(next);
      return;
    }
    setTarget(null);
    setView(next);
  }

  useEffect(() => {
    const cv = document.getElementById(canvasId);
    if (!cv) {
      return undefined;
    }
    function wheel(event) {
      event.preventDefault();
      const r = cv.getBoundingClientRect();
      let rate = 0.0022;
      if (event.ctrlKey) {
        rate = 0.012;
      }
      const dy = Math.max(-120, Math.min(120, event.deltaY));
      zoomAt([event.clientX - r.left, event.clientY - r.top], Math.exp(-dy * rate), false);
    }
    cv.addEventListener("wheel", wheel, { passive: false });
    return () => cv.removeEventListener("wheel", wheel);
  }, [view, size, target]);

  function onDown(event) {
    setTarget(null);
    setDrag({ xy: localXY(event), view: view, moved: false });
  }

  function onMove(event) {
    const xy = localXY(event);
    setCursor(from(xy[0], xy[1]));
    if (drag) {
      const dx = xy[0] - drag.xy[0];
      const dy = xy[1] - drag.xy[1];
      if (drag.moved || Math.abs(dx) + Math.abs(dy) > 3) {
        if (!drag.moved) {
          setDrag({ xy: drag.xy, view: drag.view, moved: true });
        }
        setView(clampView({ k: drag.view.k, lon0: drag.view.lon0 - dx / drag.view.k, lat0: drag.view.lat0 + dy / drag.view.k }, h));
      }
      return;
    }
    const p = pointNear(xy);
    if (p) {
      setHover({ xy: xy, html: '<div class="globe-tip"><b>' + PLATFORM_LABELS[p.platform] + "</b><br/>" + p.lat.toFixed(3) + "°, " + p.lon.toFixed(3) + "° · " + (p.country || "open ocean / no country") + "<br/>" + p.date + " " + p.utc + " UTC · FRP " + p.frp + " MW</div>" });
      return;
    }
    const hx = hexNear(xy);
    if (hx) {
      setHover({ xy: xy, html: '<div class="globe-tip"><b>' + hx.points.length + " detections</b><br/>in this hexagon (≈ 60 km cell)</div>" });
      return;
    }
    setHover(null);
  }

  function onUp(event) {
    const xy = localXY(event);
    const moved = drag && drag.moved;
    setDrag(null);
    if (moved || !props.onProbe) {
      return;
    }
    const ll = from(xy[0], xy[1]);
    if (ll[1] > 90 || ll[1] < -90) {
      return;
    }
    const p = pointNear(xy);
    if (p) {
      props.onProbe({ lat: p.lat, lon: p.lon, point: p, hex: null });
      return;
    }
    const hx = hexNear(xy);
    if (hx) {
      props.onProbe({ lat: ll[1], lon: ll[0], point: hx.points[0], hex: hx.points });
      return;
    }
    props.onProbe({ lat: ll[1], lon: ll[0], point: nearestPoint(points, ll[1], ll[0], 150), hex: null });
  }

  const kmPerPx = (111.32 * Math.cos((view.lat0 * Math.PI) / 180)) / k;
  let barKm = NICE_KM[0];
  NICE_KM.forEach((v) => {
    if (v / kmPerPx <= 110) {
      barKm = v;
    }
  });
  const barPx = Math.round(barKm / kmPerPx);

  const rings = [];
  if (layers.rings !== false) {
    points.slice().sort((a, b) => b.frp - a.frp).slice(0, 10).forEach((p) => rings.push(p));
  }
  if (props.selected) {
    rings.push(props.selected);
  }
  if (props.pin) {
    rings.push(props.pin);
  }

  let sats = [];
  if (layers.tracks && props.satellites) {
    sats = props.satellites.map((sat) => {
      const pos = positionOf(sat, now);
      return { id: sat.id, short: shortName(sat), xy: toNear(pos.lon, pos.lat) };
    });
  }

  let pinCard = null;
  if (props.pin) {
    const pxy = toNear(props.pin.lon, props.pin.lat);
    pinCard = <div className="pin-card flat-pin" style={{ left: pxy[0], top: pxy[1] }} dangerouslySetInnerHTML={{ __html: props.pin.html }} />;
  }

  let tip = null;
  if (hover && !drag) {
    tip = <div className="flat-tip" style={{ left: hover.xy[0] + 14, top: hover.xy[1] + 14 }} dangerouslySetInnerHTML={{ __html: hover.html }} />;
  }

  let cursorText = "move over the map";
  if (cursor) {
    cursorText = degText(cursor[1], "S", "N") + "  " + degText(cursor[0], "W", "E");
  }

  return (
    <div className="flat-host" id={hostId}>
      <canvas
        id={canvasId}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onDoubleClick={(event) => zoomAt(localXY(event), 2, true)}
        onMouseLeave={() => { setHover(null); setDrag(null); setCursor(null); }}
      />
      {rings.map((p, i) => {
        const xy = toNear(p.lon, p.lat);
        return <span key={"r" + i} className="flat-ring" style={{ left: xy[0], top: xy[1] }} />;
      })}
      {sats.map((s) => (
        <div
          key={s.id}
          className="sat-label flat-sat"
          style={{ left: s.xy[0], top: s.xy[1], color: PLATFORM_COLORS[s.id] || "#ffffff", transform: "translate(-50%, calc(-100% - " + (14 + (LABEL_LIFT[s.id] || 0)) + "px))" }}
          dangerouslySetInnerHTML={{ __html: satIcon(s.id) + "<span>" + s.short + "</span>" }}
        />
      ))}
      {sats.map((s) => <span key={"d" + s.id} className="flat-sat-dot" style={{ left: s.xy[0], top: s.xy[1], background: PLATFORM_COLORS[s.id] || "#ffffff" }} />)}
      {pinCard}
      {tip}
      <div className="flat-zoom">
        <button onClick={() => zoomAt([w / 2, h / 2], 1.8, true)} aria-label="Zoom in" title="Zoom in">+</button>
        <button onClick={() => zoomAt([w / 2, h / 2], 1 / 1.8, true)} aria-label="Zoom out" title="Zoom out">−</button>
        <button onClick={() => setTarget(homeView(h))} aria-label="Whole Earth" title="Back to the whole Earth">⤢</button>
      </div>
      <div className="flat-scale">
        <span className="flat-bar" style={{ width: barPx }} />
        <b>{barKm.toLocaleString()} km</b>
        <span className="flat-coord">{cursorText}</span>
      </div>
    </div>
  );
}
