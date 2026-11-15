import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { loadFormulas } from "../api/data.js";
import FormulaPage from "./FormulaPage.jsx";
import "../styles/formulas.css";

export default function Formulas() {
  const params = useParams();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    loadFormulas()
      .then((result) => setItems(result.data))
      .catch((e) => setError(String(e.message || e)));
  }, []);

  useEffect(() => {
    if (!params.id) {
      document.title = "Formulas · FIREWORK CHRONOS";
    }
  }, [params.id]);

  if (error) {
    return <div className="fx"><p className="fx-lead">The formula reference could not be loaded: {error}</p></div>;
  }
  if (items.length === 0) {
    return <div className="fx"><p className="fx-lead">Loading the formula reference…</p></div>;
  }

  if (params.id) {
    const wanted = params.id.toUpperCase().replace(/^F(\d)$/, "F0$1");
    const formula = items.find((f) => f.id === wanted);
    if (!formula) {
      return (
        <div className="fx">
          <p className="fx-lead">There is no formula {params.id}.</p>
          <button type="button" className="fp-btn" onClick={() => navigate("/formulas")}>All formulas</button>
        </div>
      );
    }
    return <FormulaPage formula={formula} formulas={items} />;
  }
  return <FormulaPage formula={null} formulas={items} />;
}
