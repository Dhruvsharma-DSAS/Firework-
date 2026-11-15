import { useEffect, useState } from "react";

const KEY = "fc-source";
const MODES = ["demo", "archive", "live"];

export const ARCHIVE_DATE = "2025-11-05";
export const LIVE_SOURCES = "VIIRS_NOAA20_NRT,VIIRS_NOAA21_NRT,VIIRS_SNPP_NRT,MODIS_NRT";
export const ARCHIVE_SOURCES = "MODIS_SP,VIIRS_SNPP_SP,VIIRS_NOAA20_SP,VIIRS_NOAA21_SP";

export function getMode() {
  try {
    const saved = window.localStorage.getItem(KEY);
    if (MODES.indexOf(saved) >= 0) {
      return saved;
    }
  } catch (error) {
    return "live";
  }
  return "live";
}

export function setMode(mode) {
  if (MODES.indexOf(mode) < 0) {
    return;
  }
  try {
    window.localStorage.setItem(KEY, mode);
  } catch (error) {
    console.info("source mode not saved");
  }
  window.dispatchEvent(new CustomEvent("fc-source", { detail: mode }));
}

export function useSourceMode() {
  const [mode, setLocal] = useState(getMode());
  useEffect(() => {
    function onChange(event) {
      setLocal(event.detail);
    }
    window.addEventListener("fc-source", onChange);
    return () => window.removeEventListener("fc-source", onChange);
  }, []);
  return mode;
}
