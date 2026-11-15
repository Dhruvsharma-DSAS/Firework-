import { useEffect } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import TopBar from "./components/TopBar.jsx";
import { useSourceMode } from "./lib/sourceMode.js";
import Home from "./pages/Home.jsx";
import Explorer from "./pages/Explorer.jsx";
import Calendar from "./pages/Calendar.jsx";
import SensorLab from "./pages/SensorLab.jsx";
import Studio from "./pages/Studio.jsx";
import Formulas from "./pages/Formulas.jsx";
import Validation from "./pages/Validation.jsx";
import Sources from "./pages/Sources.jsx";
import BlindSpot from "./pages/BlindSpot.jsx";
import FireClock from "./pages/FireClock.jsx";
import Learn from "./pages/Learn.jsx";
import Satellites from "./pages/Satellites.jsx";
import Guide from "./pages/Guide.jsx";
import Workspace from "./pages/Workspace.jsx";
import Brief from "./pages/Brief.jsx";
import Health from "./pages/Health.jsx";
import NotFound from "./pages/NotFound.jsx";
import ChatAssistant from "./components/ChatAssistant.jsx";

const ROUTES = [
  ["/explore", Explorer, "explore"],
  ["/calendar/:region", Calendar, "explore"],
  ["/calendar", Calendar, "explore"],
  ["/sensors", SensorLab, "explore"],
  ["/sources", Sources, "explore"],
  ["/blind-spot", BlindSpot, "explore"],
  ["/fire-clock", FireClock, "explore"],
  ["/validation", Validation, "trust"],
  ["/formulas/:id", Formulas, "trust"],
  ["/formulas", Formulas, "trust"],
  ["/sources/health", Health, "trust"],
  ["/studio", Studio, "data"],
  ["/me", Workspace, "data"],
  ["/brief/:id", Brief, "data"],
  ["/brief", Brief, "data"],
  ["/learn", Learn, "learn"],
  ["/satellites", Satellites, "learn"],
  ["/guide", Guide, "learn"],
];

function Shell(props) {
  const Page = props.page;
  const mode = useSourceMode();
  return (
    <div className="app">
      <TopBar group={props.group} />
      <main className="main" key={mode}>
        <Page />
      </main>
    </div>
  );
}

export default function App() {
  const location = useLocation();
  useEffect(() => {
    if (!location.hash) {
      window.scrollTo(0, 0);
    }
  }, [location.pathname]);
  return (
    <>
    <Routes>
      <Route path="/" element={<Home />} />
      {ROUTES.map((r) => (
        <Route key={r[0]} path={r[0]} element={<Shell page={r[1]} group={r[2]} />} />
      ))}
      <Route path="*" element={<Shell page={NotFound} group="" />} />
    </Routes>
    <ChatAssistant />
    </>
  );
}
