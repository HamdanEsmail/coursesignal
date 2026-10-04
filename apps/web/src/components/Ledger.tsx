import type { LodgeFixture } from "../data/fixtures.js";

type LedgerProps = {
  fixture: LodgeFixture;
};

export function Ledger({ fixture }: LedgerProps) {
  const total = fixture.steps.reduce((sum, step) => sum + step.ms, 0);

  return (
    <div className="ledger" role="table" aria-label="Sanitized tool ledger">
      <div className="ledger__head" role="row">
        <span role="columnheader">Tool</span>
        <span role="columnheader">On the slip</span>
        <span role="columnheader">ms</span>
      </div>
      {fixture.steps.map((step) => (
        <div className="ledger__row" role="row" key={`${step.endpoint}-${step.label}`}>
          <span role="cell">
            <strong>{step.endpoint}</strong>
            <small>{step.label}</small>
          </span>
          <span role="cell">
            {step.studentSees}
            <small>{step.detail}</small>
          </span>
          <span role="cell">{step.status === "skipped" ? "—" : step.ms}</span>
        </div>
      ))}
      <p className="ledger__sum">Fixture total {total} ms · checked-live · no live TinyFish from this page</p>
    </div>
  );
}
