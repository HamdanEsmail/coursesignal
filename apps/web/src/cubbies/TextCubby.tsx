import { commandRows, everydayAskHint } from "../data/commands.js";

export function TextCubby() {
  return (
    <article className="slip-copy">
      <h1>What to text</h1>
      <p>{everydayAskHint}</p>
      <div className="command-crib" role="table" aria-label="Lodge texts">
        <div className="command-crib__head" role="row">
          <span role="columnheader">Send</span>
          <span role="columnheader">When</span>
          <span role="columnheader">Example</span>
        </div>
        {commandRows.map((row) => (
          <div className="command-row" role="row" key={row.command}>
            <kbd role="cell">{row.command}</kbd>
            <p role="cell">{row.when}</p>
            <code role="cell">{row.example}</code>
          </div>
        ))}
      </div>
    </article>
  );
}
