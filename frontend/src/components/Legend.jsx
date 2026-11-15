import { SENSOR_COLORS, PLATFORM_COLORS, PLATFORM_LABELS, CLASS_COLORS, CLASS_LABELS, DAYNIGHT_COLORS } from "../lib/colors.js";

const LAND_CLASSES = [
  ["Tree cover", "#2f5a36"], ["Shrubland", "#7d7442"], ["Grassland", "#9c9a5c"], ["Cropland", "#d1a64f"], ["Built-up", "#c6c0b8"],
  ["Bare / sparse", "#8b8073"], ["Snow and ice", "#e6ebf0"], ["Wetland", "#3f7a73"], ["Mangroves", "#2c6a52"], ["Moss / lichen", "#8f9a7e"],
];

function Items(props) {
  return (
    <div>
      {props.items.map((item) => (
        <div className="item" key={item[0]}>
          <span className="sw" style={{ background: item[1] }} />
          <span>{item[0]}</span>
        </div>
      ))}
    </div>
  );
}

export default function Legend(props) {
  let title = "Colour = sensor";
  let body = <Items items={[["MODIS (Terra, Aqua) · 1 km", SENSOR_COLORS.MODIS], ["VIIRS (S-NPP, NOAA-20, NOAA-21) · 375 m", SENSOR_COLORS.VIIRS]]} />;
  if (props.colorBy === "platform") {
    title = "Colour = platform";
    body = <Items items={Object.keys(PLATFORM_COLORS).map((key) => [PLATFORM_LABELS[key], PLATFORM_COLORS[key]])} />;
  } else if (props.colorBy === "class") {
    title = "Colour = probable source (demo labels)";
    body = <Items items={Object.keys(CLASS_LABELS).filter((key) => key !== "USER").map((key) => [CLASS_LABELS[key], CLASS_COLORS[key]])} />;
  } else if (props.colorBy === "frp") {
    title = "Colour = fire radiative power";
    body = (
      <div>
        <div className="ramp" />
        <div className="row small dim" style={{ justifyContent: "space-between", marginTop: 4 }}>
          <span>0</span>
          <span>5</span>
          <span>20</span>
          <span>80+ MW</span>
        </div>
      </div>
    );
  } else if (props.colorBy === "daynight") {
    title = "Colour = day / night pass";
    body = <Items items={[["Day pass", DAYNIGHT_COLORS.D], ["Night pass", DAYNIGHT_COLORS.N]]} />;
  }
  let contextKey = null;
  if (props.context === "landcover") {
    contextKey = (
      <div className="legend-ctx">
        <div className="caps">Ground · ESA WorldCover 2021</div>
        <div className="lc-grid">
          {LAND_CLASSES.map((c) => (
            <span key={c[0]}><i style={{ background: c[1] }} />{c[0]}</span>
          ))}
        </div>
      </div>
    );
  } else if (props.context === "burned") {
    contextKey = (
      <div className="legend-ctx">
        <div className="caps">Burned share of land</div>
        <div className="ramp" style={{ background: "linear-gradient(90deg, #ffc46b, #ff7a3d, #ff3b4e, #b0122f)" }} />
        <div className="row small dim" style={{ justifyContent: "space-between", marginTop: 4 }}><span>trace</span><span>25 %+</span></div>
      </div>
    );
  } else if (props.context === "clearsky") {
    contextKey = (
      <div className="legend-ctx">
        <div className="caps">Clear-sky days in the month</div>
        <div className="ramp" style={{ background: "linear-gradient(90deg, #1b2230, #2b5876, #3dd6f5, #d8f6ff)" }} />
        <div className="row small dim" style={{ justifyContent: "space-between", marginTop: 4 }}><span>0</span><span>15</span><span>31</span></div>
      </div>
    );
  }
  return (
    <div className="legend">
      <div className="caps">{title}</div>
      {body}
      {contextKey}
      {props.density && <div className="small dim" style={{ marginTop: 8 }}>Columns = detections per hexagon (height and colour)</div>}
      <div className="small faint" style={{ marginTop: 8 }}>A dot is a hot pixel, not a fire or its size.</div>
    </div>
  );
}
