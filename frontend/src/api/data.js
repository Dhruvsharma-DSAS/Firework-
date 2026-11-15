import { API_BASE, fetchApiOrFixture, fetchJson } from "./client.js";

export function loadDetections(source, days, date) {
  let query = "?source=" + encodeURIComponent(source) + "&area=world&days=" + days;
  if (date) {
    query = query + "&date=" + date;
  }
  return fetchApiOrFixture("/api/detections" + query, "/data/detections_demo.json");
}

export function loadCountries() {
  return fetchJson("/data/countries.json");
}

export function loadSatellites() {
  return fetchApiOrFixture("/api/satellites", "/data/satellites.json");
}

export function loadRegions() {
  return fetchApiOrFixture("/api/regions", "/data/regions.json");
}

export function loadCalendarRegions() {
  return fetchJson(API_BASE + "/api/calendar_regions");
}

export function loadCalendar(region) {
  return fetchApiOrFixture("/api/calendar/" + region, "/data/calendar_demo.json");
}

export async function loadFormulas() {
  const json = await fetchJson("/data/formulas_content.json");
  return { data: json.formulas, meta: { status: "SOURCE_DERIVED" } };
}

export function loadHealth() {
  return fetchApiOrFixture("/api/health", "/data/health.json");
}

export function loadModelCards() {
  return fetchJson(API_BASE + "/api/ml/models");
}

export async function classifySource(points) {
  const rows = points.slice(0, 500).map((p) => ({ id: p.id, lat: p.lat, lon: p.lon, date: p.date, utc: p.utc, dn: p.dn, frp: p.frp }));
  const response = await fetch(API_BASE + "/api/ml/source", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ points: rows }) });
  if (!response.ok) {
    let reason = "HTTP " + response.status;
    try {
      const body = await response.json();
      if (body.detail && body.detail.reason) {
        reason = body.detail.reason;
      }
    } catch (e) {
      reason = "HTTP " + response.status;
    }
    throw new Error(reason);
  }
  return response.json();
}

export async function loadContext(layer, bbox) {
  const response = await fetch(API_BASE + "/api/context/" + layer + "?bbox=" + bbox.join(","));
  const body = await response.json();
  if (!response.ok) {
    let reason = "HTTP " + response.status;
    if (body.detail && body.detail.reason) {
      reason = body.detail.reason;
    }
    throw new Error(reason);
  }
  return body;
}

export function loadAnomaly(region) {
  return fetchJson(API_BASE + "/api/anomaly/" + region);
}
