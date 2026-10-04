import { commandRows, everydayAskHint } from "../data/commands.js";

export function CommandsView() {
  return (
    <main className="guide-page" id="main-content" tabIndex={-1}>
      <article className="worksheet">
        <p className="worksheet__kicker">Crib sheet</p>
        <h1>What to text</h1>
        <p className="worksheet__lede">{everydayAskHint}</p>

        <div className="command-crib" role="table" aria-label="CourseSignal commands">
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
    </main>
  );
}
