import { Fragment } from "react";
import { STAGES, deriveStages } from "../stages.js";

export default function StageRail({ project, sources, drafts }) {
  const { reached, current } = deriveStages(project, sources, drafts);
  return (
    <div className="rail" aria-label="Progress from voice to page">
      {STAGES.map((label, i) => (
        <Fragment key={label}>
          {i > 0 && <div className={`bar ${reached[i - 1] ? "filled" : ""}`} />}
          <div className={`step ${reached[i] ? "done" : ""} ${i === current ? "current" : ""}`}>
            <span className="dot" />
            <span className="label">{label}</span>
          </div>
        </Fragment>
      ))}
    </div>
  );
}
