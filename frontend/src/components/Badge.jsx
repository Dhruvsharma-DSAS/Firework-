const KINDS = {
  OFFICIAL_DOCUMENTED: ["off", "Official NASA product"],
  SOURCE_DERIVED: ["src", "Derived from NASA data"],
  RUN_TESTED_LOCALLY: ["run", "Run and tested"],
  SIMULATED_DEMO: ["sim", "Simulated"],
  PROPOSED_UNVALIDATED: ["pro", "Proposed · not yet validated"],
};

export default function Badge(props) {
  const kind = KINDS[props.kind] || KINDS.PROPOSED_UNVALIDATED;
  return <span className={"badge " + kind[0]}>{props.text || kind[1]}</span>;
}
