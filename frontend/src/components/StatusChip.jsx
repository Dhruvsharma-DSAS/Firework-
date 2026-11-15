import { useEffect, useState } from "react";
import { fetchJson } from "../api/client.js";

export default function StatusChip(props) {
  const [status, setStatus] = useState(props.status || "CHECKING");

  useEffect(() => {
    if (props.status) {
      setStatus(props.status);
      return;
    }
    let active = true;
    fetchJson((import.meta.env.VITE_API_URL || "") + "/api/health")
      .then((result) => {
        if (!active) {
          return;
        }
        if (result && result.meta && result.meta.firms_live) {
          setStatus("LIVE_NRT");
        } else {
          setStatus("ARCHIVE_STANDARD");
        }
      })
      .catch(() => {
        if (active) {
          setStatus("SIMULATED");
        }
      });
    return () => {
      active = false;
    };
  }, [props.status]);

  let cls = "chip cached";
  let label = status;
  if (status === "CACHED") {
    label = "Saved copy · feed paused";
  } else if (status === "CHECKING") {
    cls = "chip loading";
    label = "Checking source";
  }
  if (status === "LIVE_NRT") {
    cls = "chip live";
    label = "Live · near real-time";
  } else if (status === "ARCHIVE_STANDARD") {
    cls = "chip archive";
    label = "Archive · standard processing";
  } else if (status === "SIMULATED") {
    cls = "chip simulated";
    label = "Demo data";
  } else if (status === "UNAVAILABLE") {
    cls = "chip unavailable";
    label = "Source offline";
  } else if (status === "LOADING") {
    cls = "chip loading";
    label = "Fetching from NASA";
  } else if (status === "USER") {
    cls = "chip user";
    label = "Your upload";
  }

  return (
    <span className={cls} title="Data status comes from the API meta field">
      <span className="dot" />
      {label}
    </span>
  );
}
