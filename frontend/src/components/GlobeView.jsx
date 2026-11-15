import { useEffect, useState } from "react";
import Globe from "globe.gl";
import * as THREE from "three";
import { pointColor, densityColor, PLATFORM_COLORS, PLATFORM_LABELS } from "../lib/colors.js";
import { nearestPoint } from "../lib/geo.js";
import { splitAtDateline, positionOf, trackOf, subsolarPoint } from "../lib/orbits.js";

const BASEMAP_URLS = {
  bluemarble: "/textures/earth-blue-marble.jpg",
  night: "/textures/earth-night.jpg",
  day: "/textures/earth-day.jpg",
  dark: "/textures/earth-dark.jpg",
};

const DENSITY_SCALE = 90;

function cellRamp(t) {
  const stops = [[0, [59, 29, 15]], [0.35, [194, 65, 12]], [0.7, [255, 106, 61]], [1, [255, 208, 138]]];
  const v = Math.max(0, Math.min(1, t));
  let i = 0;
  while (i < stops.length - 2 && v > stops[i + 1][0]) {
    i = i + 1;
  }
  const a = stops[i];
  const b = stops[i + 1];
  const k = (v - a[0]) / (b[0] - a[0]);
  const c = [0, 1, 2].map((j) => Math.round(a[1][j] + (b[1][j] - a[1][j]) * k));
  return "rgba(" + c[0] + "," + c[1] + "," + c[2] + ",0.88)";
}

function cellColor(hex, mode, maxN) {
  if (mode === "frp") {
    let top = 0;
    hex.points.forEach((p) => {
      if ((p.frp || 0) > top) {
        top = p.frp || 0;
      }
    });
    return cellRamp(Math.log1p(top) / Math.log1p(200));
  }
  if (mode === "sensor") {
    const v = hex.points.filter((p) => p.sensor !== "MODIS").length / Math.max(1, hex.points.length);
    return "rgba(" + Math.round(255 - 194 * v) + "," + Math.round(181 + 33 * v) + "," + Math.round(71 + 174 * v) + ",0.88)";
  }
  return cellRamp(Math.log1p(hex.points.length) / Math.log1p(Math.max(2, maxN)));
}

function cellLabelHtml(hex) {
  let m = 0;
  let top = 0;
  hex.points.forEach((p) => {
    if (p.sensor === "MODIS") {
      m = m + 1;
    }
    if ((p.frp || 0) > top) {
      top = p.frp || 0;
    }
  });
  return '<div class="globe-tip"><b>' + hex.points.length + " hot pixels</b> in this cell<br/>MODIS " + m + " · VIIRS " + (hex.points.length - m) + " · max FRP " + top.toFixed(1) + " MW<br/>click for details</div>";
}

function pointLabelHtml(point) {
  const name = point.country || "open ocean / no country";
  return (
    '<div class="globe-tip"><b>' + PLATFORM_LABELS[point.platform] + "</b><br/>" +
    point.lat.toFixed(3) + "°, " + point.lon.toFixed(3) + "° · " + name + "<br/>" +
    point.date + " " + point.utc + " UTC · FRP " + point.frp + " MW</div>"
  );
}

function hexLabelHtml(hex) {
  return '<div class="globe-tip"><b>' + hex.points.length + " detections</b><br/>in this hexagon (H3 res 3)</div>";
}

const CELL = "#2c5fd6";
const CELL_LINE = "#a9c4ff";
const GOLD = "#d9a843";
const SILVER = "#d9dee4";

function wing(x, y, w, h, cols, rows, tilt) {
  let out = '<g transform="translate(' + x + " " + y + ") skewY(" + tilt + ')"><rect width="' + w + '" height="' + h + '" rx="0.6" fill="' + CELL + '" stroke="' + CELL_LINE + '" stroke-width="0.6"/>';
  for (let c = 1; c < cols; c = c + 1) {
    out = out + '<path d="M' + (w * c) / cols + " 0V" + h + '" stroke="' + CELL_LINE + '" stroke-width="0.4"/>';
  }
  for (let r = 1; r < rows; r = r + 1) {
    out = out + '<path d="M0 ' + (h * r) / rows + "H" + w + '" stroke="' + CELL_LINE + '" stroke-width="0.4"/>';
  }
  return out + "</g>";
}

const SAT_GLYPHS = {
  terra: wing(0, 2, 11, 10, 3, 3, -8) + '<path d="M11 7H14" stroke="#cfd5dc" stroke-width="0.8"/><rect x="14" y="3" width="11" height="8" rx="1" fill="' + GOLD + '"/><rect x="16" y="11" width="3" height="2" fill="#20242a"/><rect x="20" y="11" width="3" height="2" fill="' + SILVER + '"/><path d="M23 3L26 0" stroke="#cfd5dc" stroke-width="0.7"/><ellipse cx="26.5" cy="0.8" rx="1.8" ry="0.9" fill="#eef0f2"/>',
  aqua: wing(0, 3, 12, 8, 4, 2, -6) + '<path d="M12 7H14.5" stroke="#cfd5dc" stroke-width="0.8"/><rect x="14.5" y="4" width="10" height="7" rx="1" fill="' + GOLD + '"/><ellipse cx="22" cy="3" rx="3" ry="1.3" fill="#eef0f2"/><path d="M22 3V4" stroke="#cfd5dc" stroke-width="0.6"/>',
  snpp: wing(0, 3, 10, 8, 1, 3, 10) + '<path d="M10 7H14" stroke="#cfd5dc" stroke-width="0.8"/><rect x="14" y="3.5" width="8" height="7" rx="1" fill="' + SILVER + '"/><rect x="14" y="10.5" width="4" height="2" fill="#20242a"/>',
  noaa20: wing(0, 3, 10, 8, 1, 3, 10) + '<path d="M10 7H14" stroke="#cfd5dc" stroke-width="0.8"/><rect x="14" y="3.5" width="8" height="7" rx="1" fill="' + SILVER + '"/><rect x="14" y="10.5" width="4" height="2" fill="#20242a"/><ellipse cx="20" cy="12.6" rx="2.2" ry="0.9" fill="#eef0f2"/>',
  noaa21: wing(0, 5, 13, 5, 5, 1, -12) + '<path d="M13 6.5H15.5" stroke="#cfd5dc" stroke-width="0.8"/><rect x="15.5" y="3" width="8" height="8" rx="1" fill="' + SILVER + '"/><rect x="15.5" y="3" width="8" height="2" fill="#20242a"/><ellipse cx="21.5" cy="12.4" rx="2" ry="0.8" fill="#eef0f2"/>',
};

export function satIcon(id) {
  const glyph = SAT_GLYPHS[id] || SAT_GLYPHS.snpp;
  return '<svg class="sat-ico" viewBox="-1 -1 29 15" width="24" height="13" aria-hidden="true">' + glyph + "</svg>";
}

export const SAT_ICON = satIcon("snpp");

const LABEL_LIFT = { terra: 30, noaa20: 30, noaa21: 60 };
const HANDLERS = { sat: null };

function makeHtmlElement(d) {
  const element = document.createElement("div");
  element.style.pointerEvents = "none";
  if (d.kind === "pin") {
    element.className = "pin-card";
    element.innerHTML = d.html;
    return element;
  }
  element.className = "sat-label";
  element.style.pointerEvents = "auto";
  element.style.cursor = "pointer";
  element.title = d.name + " · point to preview, click to keep open";
  element.addEventListener("mouseenter", () => {
    if (HANDLERS.sat) {
      HANDLERS.sat(d.id, "enter");
    }
  });
  element.addEventListener("mouseleave", () => {
    if (HANDLERS.sat) {
      HANDLERS.sat(d.id, "leave");
    }
  });
  element.addEventListener("click", () => {
    if (HANDLERS.sat) {
      HANDLERS.sat(d.id, "click");
    }
  });
  element.style.color = PLATFORM_COLORS[d.id] || "#ffffff";
  const lift = LABEL_LIFT[d.id] || 0;
  element.style.transform = "translate(-50%, calc(-100% - " + (14 + lift) + "px))";
  element.innerHTML = satIcon(d.id) + "<span>" + d.short + "</span>";
  return element;
}

function pushHtml(g) {
  g.htmlElementsData(g.__fcHtml.sats.concat(g.__fcHtml.pin));
}

export function shortName(sat) {
  if (sat.id === "snpp") {
    return "S-NPP";
  }
  if (sat.id === "noaa20") {
    return "NOAA-20";
  }
  if (sat.id === "noaa21") {
    return "NOAA-21";
  }
  return sat.name;
}

function buildTracks(satellites, now) {
  const tracks = [];
  satellites.forEach((sat) => {
    const points = trackOf(sat, now, 50, 50, 1);
    splitAtDateline(points).forEach((segment) => {
      tracks.push({ id: sat.id, color: PLATFORM_COLORS[sat.id] || "#ffffff", points: segment });
    });
  });
  return tracks;
}

function buildSatPositions(satellites, now) {
  return satellites.map((sat) => {
    const p = positionOf(sat, now);
    return { id: sat.id, name: sat.name, short: shortName(sat), lat: p.lat, lon: p.lon, alt: 0.12 };
  });
}

export default function GlobeView(props) {
  const hostId = props.hostId || "globe-host";
  const [globe, setGlobe] = useState(null);

  useEffect(() => {
    const host = document.getElementById(hostId);
    if (!host) {
      return undefined;
    }
    const g = new Globe(host, { animateIn: true });
    g.backgroundColor("rgba(0,0,0,0)")
      .backgroundImageUrl("/textures/night-sky.png")
      .bumpImageUrl("/textures/earth-topology.png")
      .showAtmosphere(true)
      .atmosphereColor("#6fc3ff")
      .atmosphereAltitude(0.2)
      .pointLat("lat")
      .pointLng("lon")
      .pointResolution(6)
      .pointsTransitionDuration(400)
      .hexBinPointLat("lat")
      .hexBinPointLng("lon")
      .hexBinResolution(3)
      .hexMargin(0.18)
      .hexTransitionDuration(500)
      .hexLabel(hexLabelHtml)
      .polygonCapColor(() => "rgba(0,0,0,0)")
      .polygonSideColor(() => "rgba(0,0,0,0)")
      .polygonStrokeColor(() => "rgba(230,237,243,0.30)")
      .polygonAltitude(0.003)
      .polygonLabel((feature) => '<div class="globe-tip">' + feature.properties.name + "</div>")
      .pathPoints("points")
      .pathPointLat((p) => p[0])
      .pathPointLng((p) => p[1])
      .pathColor((track) => [track.color, track.color])
      .pathStroke(1.4)
      .pathDashLength(0.06)
      .pathDashGap(0.012)
      .pathDashAnimateTime(16000)
      .pathTransitionDuration(0)
      .htmlLat("lat")
      .htmlLng("lon")
      .htmlAltitude("alt")
      .htmlElement(makeHtmlElement)
      .htmlTransitionDuration(900)
      .ringLat("lat")
      .ringLng("lon")
      .ringColor(() => (t) => "rgba(255,93,108," + (1 - t) + ")")
      .ringMaxRadius(2.6)
      .ringPropagationSpeed(2.2)
      .ringRepeatPeriod(1100);
    g.tileLat("lat")
      .tileLng("lon")
      .tileAltitude(0.0035)
      .tileWidth((c) => c.size)
      .tileHeight((c) => c.size)
      .tileMaterial((c) => c.material)
      .tilesTransitionDuration(0)
      .tileLabel((c) => '<div class="globe-tip">' + c.label + "</div>");
    g.pointOfView({ lat: props.startLat || 18, lng: props.startLng || 40, altitude: props.startAltitude || 2.3 }, 0);
    const controls = g.controls();
    controls.autoRotateSpeed = 0.45;
    controls.enableDamping = true;
    function resize() {
      g.width(host.clientWidth);
      g.height(host.clientHeight);
    }
    resize();
    window.addEventListener("resize", resize);
    g.__fcHtml = { sats: [], pin: [] };
    setGlobe(() => g);
    return () => {
      window.removeEventListener("resize", resize);
      g._destructor();
      host.innerHTML = "";
    };
  }, [hostId]);

  useEffect(() => {
    if (!globe) {
      return;
    }
    const material = globe.globeMaterial();
    if (props.basemap === "atlas") {
      globe.globeImageUrl(null).bumpImageUrl(null).backgroundImageUrl(null).atmosphereColor("#3d6fb5").atmosphereAltitude(0.14);
      material.color = new THREE.Color("#17233b");
      material.emissive = new THREE.Color("#0b1324");
      material.shininess = 6;
    } else {
      globe.globeImageUrl(BASEMAP_URLS[props.basemap] || BASEMAP_URLS.bluemarble).bumpImageUrl("/textures/earth-topology.png").backgroundImageUrl("/textures/night-sky.png").atmosphereColor("#6fc3ff").atmosphereAltitude(0.2);
      material.color = new THREE.Color("#ffffff");
      material.emissive = new THREE.Color("#000000");
    }
    material.needsUpdate = true;
  }, [globe, props.basemap]);

  useEffect(() => {
    if (!globe || !props.terminator) {
      return undefined;
    }
    const radius = globe.getGlobeRadius() * 1.004;
    const geometry = new THREE.SphereGeometry(radius, 64, 32, 0, Math.PI * 2, 0, Math.PI / 2);
    const shade = new THREE.MeshBasicMaterial({ color: 0x01040b, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.FrontSide });
    const mesh = new THREE.Mesh(geometry, shade);
    function place() {
      const sun = subsolarPoint(new Date());
      const night = globe.getCoords(-sun.lat, sun.lon + 180, 0);
      const dir = new THREE.Vector3(night.x, night.y, night.z).normalize();
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    }
    place();
    globe.scene().add(mesh);
    const timer = setInterval(place, 60000);
    return () => {
      clearInterval(timer);
      globe.scene().remove(mesh);
      geometry.dispose();
      shade.dispose();
    };
  }, [globe, props.terminator]);

  useEffect(() => {
    HANDLERS.sat = props.onSatHover || null;
    return () => {
      HANDLERS.sat = null;
    };
  }, [props.onSatHover]);

  useEffect(() => {
    if (!globe || !props.overlayUrl) {
      return undefined;
    }
    const radius = globe.getGlobeRadius() * 1.0015;
    const geometry = new THREE.SphereGeometry(radius, 96, 64);
    const material = new THREE.MeshLambertMaterial({ transparent: true, opacity: 0, depthWrite: false });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.y = -Math.PI / 2;
    let alive = true;
    let frame = 0;
    const target = props.overlayOpacity || 0.85;
    new THREE.TextureLoader().load(props.overlayUrl, (texture) => {
      if (!alive) {
        texture.dispose();
        return;
      }
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
      material.map = texture;
      material.needsUpdate = true;
      const start = performance.now();
      function fade(now) {
        const k = Math.min(1, (now - start) / 700);
        material.opacity = target * (1 - Math.pow(1 - k, 3));
        if (k < 1 && alive) {
          frame = requestAnimationFrame(fade);
        }
      }
      frame = requestAnimationFrame(fade);
    });
    globe.scene().add(mesh);
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      globe.scene().remove(mesh);
      geometry.dispose();
      if (material.map) {
        material.map.dispose();
      }
      material.dispose();
    };
  }, [globe, props.overlayUrl, props.overlayOpacity]);

  useEffect(() => {
    if (!globe) {
      return undefined;
    }
    const controls = globe.controls();
    let timer = null;
    controls.autoRotate = Boolean(props.autoRotate);
    function onStart() {
      controls.autoRotate = false;
      if (timer) {
        clearTimeout(timer);
      }
    }
    function onEnd() {
      if (props.autoRotate) {
        timer = setTimeout(() => {
          controls.autoRotate = true;
        }, 10000);
      }
    }
    function onGrab() {
      if (props.onGrab) {
        props.onGrab();
      }
    }
    controls.addEventListener("start", onStart);
    controls.addEventListener("start", onGrab);
    controls.addEventListener("end", onEnd);
    return () => {
      controls.removeEventListener("start", onStart);
      controls.removeEventListener("start", onGrab);
      controls.removeEventListener("end", onEnd);
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [globe, props.autoRotate]);

  useEffect(() => {
    if (!globe) {
      return;
    }
    const layers = props.layers || {};
    const points = props.points || [];
    let shown = [];
    if (layers.points !== false) {
      shown = points;
    }
    let radius = props.pointRadius || 0.17;
    const cells = props.view === "cells";
    if (cells) {
      radius = radius * 0.55;
    }
    globe
      .pointsMerge(shown.length > (props.mergeAbove || 3500))
      .pointColor((point) => pointColor(point, props.colorBy))
      .pointRadius((point) => {
        if (props.selected && point.id === props.selected.id) {
          return radius * 2.4;
        }
        return radius;
      })
      .pointAltitude((point) => {
        let a = 0.003 + Math.min(props.spikeMax || 0.02, Math.log1p(point.frp || 0) / 220);
        if (cells) {
          a = 0.0062;
        }
        if (props.selected && point.id === props.selected.id) {
          a = a + 0.04;
        }
        return a;
      })
      .pointLabel(pointLabelHtml)
      .pointsData(shown);
  }, [globe, props.points, props.colorBy, props.layers, props.selected, props.pointRadius, props.view]);

  useEffect(() => {
    if (!globe) {
      return;
    }
    const layers = props.layers || {};
    let data = [];
    if (props.view === "cells") {
      const points = props.points || [];
      const counts = {};
      let maxN = 1;
      points.forEach((p) => {
        const key = Math.round(p.lat) + "_" + Math.round(p.lon);
        counts[key] = (counts[key] || 0) + 1;
        if (counts[key] > maxN) {
          maxN = counts[key];
        }
      });
      const mode = props.cellMode || "pixels";
      globe
        .hexMargin(0.1)
        .hexAltitude(() => 0.0045)
        .hexTopColor((hex) => cellColor(hex, mode, maxN))
        .hexSideColor((hex) => cellColor(hex, mode, maxN))
        .hexLabel(cellLabelHtml)
        .hexBinMerge(false)
        .hexBinPointsData(points);
      return;
    }
    if (layers.density) {
      data = props.points || [];
    }
    globe
      .hexMargin(0.18)
      .hexLabel(hexLabelHtml)
      .hexAltitude((hex) => 0.01 + 0.3 * Math.pow(Math.min(1, hex.points.length / DENSITY_SCALE), 0.7))
      .hexTopColor((hex) => densityColor(Math.min(1, hex.points.length / DENSITY_SCALE)))
      .hexSideColor((hex) => densityColor(Math.min(1, hex.points.length / DENSITY_SCALE)))
      .hexBinMerge(true)
      .hexBinPointsData(data);
  }, [globe, props.points, props.layers, props.view, props.cellMode]);

  useEffect(() => {
    if (!globe) {
      return;
    }
    const layers = props.layers || {};
    let data = [];
    if (layers.borders !== false && props.countries) {
      data = props.countries;
    }
    const atlas = props.basemap === "atlas";
    const highlight = props.highlight || "";
    globe
      .polygonCapColor((feature) => {
        if (highlight && feature.properties.iso3 === highlight) {
          return "rgba(255,77,94,0.2)";
        }
        if (atlas) {
          return "rgba(120,150,205,0.13)";
        }
        return "rgba(0,0,0,0)";
      })
      .polygonStrokeColor((feature) => {
        if (highlight && feature.properties.iso3 === highlight) {
          return "rgba(255,122,92,0.95)";
        }
        return "rgba(230,237,243,0.22)";
      })
      .polygonAltitude((feature) => {
        if (highlight && feature.properties.iso3 === highlight) {
          return 0.007;
        }
        return 0.003;
      })
      .polygonsData(data);
  }, [globe, props.countries, props.layers, props.highlight, props.basemap]);

  useEffect(() => {
    if (!globe) {
      return undefined;
    }
    const layers = props.layers || {};
    const satellites = props.satellites || [];
    if (!layers.tracks || satellites.length === 0) {
      globe.pathsData([]);
      globe.__fcHtml.sats = [];
      pushHtml(globe);
      return undefined;
    }
    function tick() {
      globe.__fcHtml.sats = buildSatPositions(satellites, new Date());
      pushHtml(globe);
    }
    globe.pathsData(buildTracks(satellites, new Date()));
    tick();
    const moveTimer = setInterval(tick, 2000);
    const trackTimer = setInterval(() => {
      globe.pathsData(buildTracks(satellites, new Date()));
    }, 60000);
    return () => {
      clearInterval(moveTimer);
      clearInterval(trackTimer);
    };
  }, [globe, props.satellites, props.layers]);

  useEffect(() => {
    if (!globe) {
      return;
    }
    const layers = props.layers || {};
    const rings = [];
    if (layers.rings !== false) {
      const sorted = (props.points || []).slice().sort((a, b) => b.frp - a.frp);
      sorted.slice(0, props.ringCount || 10).forEach((point) => {
        rings.push({ lat: point.lat, lon: point.lon });
      });
    }
    if (props.selected) {
      rings.push({ lat: props.selected.lat, lon: props.selected.lon });
    }
    if (props.pin) {
      rings.push({ lat: props.pin.lat, lon: props.pin.lon });
    }
    globe.ringsData(rings);
  }, [globe, props.points, props.layers, props.selected, props.ringCount, props.pin]);

  useEffect(() => {
    if (!globe) {
      return;
    }
    let pin = [];
    if (props.pin) {
      pin = [{ kind: "pin", lat: props.pin.lat, lon: props.pin.lon, alt: 0.012, html: props.pin.html }];
    }
    globe.__fcHtml.pin = pin;
    pushHtml(globe);
  }, [globe, props.pin]);

  useEffect(() => {
    if (!globe) {
      return;
    }
    const points = props.points || [];
    const reach = props.pickKm || 150;
    function report(coords, point, hex) {
      if (!coords) {
        return;
      }
      let found = point;
      if (!found) {
        found = nearestPoint(points, coords.lat, coords.lng, reach);
      }
      if (props.onProbe) {
        props.onProbe({ lat: coords.lat, lon: coords.lng, point: found, hex: hex || null });
        return;
      }
      if (props.onSelect) {
        props.onSelect(found);
      }
    }
    globe.onPointClick((point, event, coords) => {
      if (point && typeof point.lat === "number") {
        report({ lat: point.lat, lng: point.lon }, point, null);
        return;
      }
      report(coords, null, null);
    });
    globe.onGlobeClick((coords) => report(coords, null, null));
    globe.onPolygonClick((polygon, event, coords) => report(coords, null, null));
    globe.onHexClick((hex, event, coords) => {
      let first = null;
      if (hex.points.length > 0) {
        first = hex.points[0];
      }
      let at = coords;
      if (!at && first) {
        at = { lat: first.lat, lng: first.lon };
      }
      report(at, first, hex.points);
    });
  }, [globe, props.points, props.onSelect, props.onProbe, props.pickKm]);

  useEffect(() => {
    if (!globe || !props.selected) {
      return;
    }
    globe.controls().autoRotate = false;
    if (props.keepCamera) {
      return;
    }
    const pov = globe.pointOfView();
    globe.pointOfView({ lat: props.selected.lat, lng: props.selected.lon, altitude: Math.min(pov.altitude, 2.0) }, 900);
  }, [globe, props.selected, props.keepCamera]);

  useEffect(() => {
    if (!globe || !props.flyTo) {
      return;
    }
    globe.pointOfView({ lat: props.flyTo.lat, lng: props.flyTo.lng, altitude: props.flyTo.altitude || 1.6 }, 1200);
  }, [globe, props.flyTo]);

  useEffect(() => {
    if (!globe) {
      return;
    }
    const ctx = props.contextCells || { data: [] };
    if (!ctx.layer || !ctx.meta || ctx.data.length === 0) {
      globe.tilesData([]);
      return;
    }
    const size = ctx.meta.grid_deg;
    const classes = ctx.meta.classes || {};
    const materials = {};
    function materialFor(color, opacity) {
      const key = color + ":" + opacity.toFixed(2);
      if (!materials[key]) {
        materials[key] = new THREE.MeshLambertMaterial({ color: color, transparent: true, opacity: opacity, depthWrite: false });
      }
      return materials[key];
    }
    let cells = ctx.data;
    if (ctx.layer === "landcover") {
      cells = ctx.data.filter((c) => c.value !== 80);
    }
    const tiles = cells.map((c) => {
      let color = "#ff6a3d";
      let opacity = 0.75;
      let label = "";
      if (ctx.layer === "burned") {
        const t = Math.min(1, c.value / 0.4);
        color = new THREE.Color("#ffb547").lerp(new THREE.Color("#ff3b4e"), t).getStyle();
        opacity = 0.35 + 0.55 * Math.min(1, Math.round(t * 10) / 10);
        label = "Burned " + (100 * c.value).toFixed(1) + "% of cell · " + ctx.meta.month;
      } else if (ctx.layer === "clearsky") {
        const t = Math.min(1, c.value / 31);
        color = new THREE.Color("#3a4250").lerp(new THREE.Color("#3dd6f5"), t).getStyle();
        opacity = 0.62;
        label = c.value.toFixed(1) + " clear days · " + ctx.meta.month;
      } else {
        const meta = classes[String(c.value)] || { color: "#888888", name: "?" };
        color = meta.color;
        opacity = 0.6;
        label = meta.name + " · ESA WorldCover 2021";
      }
      return { lat: c.lat, lon: c.lon, size: size * 0.98, material: materialFor(color, Math.round(opacity * 10) / 10), label: label };
    });
    globe.tilesData(tiles);
  }, [globe, props.contextCells]);

  return <div id={hostId} className="globe-host" />;
}
