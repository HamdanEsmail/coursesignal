import { PhoneReplay } from "../components/PhoneReplay.js";
import { starterCommands } from "../data/commands.js";
import { dueWeekFixture } from "../data/fixtures.js";
import type { AppView } from "../views.js";

type ArriveCubbyProps = {
  onNavigate: (view: AppView) => void;
};

export function ArriveCubby({ onNavigate }: ArriveCubbyProps) {
  return (
    <article className="slip-copy">
      <h1>Lodge lives in the thread.</h1>
      <p>
        Text a public question. Lodge pulls a paper slip — looking it up, reading
        the page, then the dates. Tap the slip for the limestone card. Add the
        week in one file. No second app to learn.
      </p>
      <PhoneReplay fixture={dueWeekFixture} autoplay />
      <div className="command-strip" aria-label="Texts you can send">
        {starterCommands.map((command) => (
          <kbd key={command}>{command}</kbd>
        ))}
        <button type="button" className="text-link" onClick={() => onNavigate("text")}>
          What to text
        </button>
      </div>
      <p className="quiet-line">
        This wall is a companion, not a chat. The line is iMessage. Slips never
        carry phones, names, or conversation keys.
      </p>
    </article>
  );
}
