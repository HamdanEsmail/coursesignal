export function RulesCubby() {
  return (
    <article className="slip-copy">
      <h1>House rules</h1>
      <ol className="rule-list">
        <li>
          <h2>START is consent</h2>
          <p>
            Until then Lodge only explains itself. skip is always enough on
            check-in. FORGET, then FORGET CONFIRM, erases the notebook,
            reminders, saved pages, and consent.
          </p>
        </li>
        <li>
          <h2>The thread leaves Apple’s lock</h2>
          <p>
            A friend in Messages has to read the text. This website never sees
            that thread and never shows a number.
          </p>
        </li>
        <li>
          <h2>TinyFish reads public pages</h2>
          <p>
            Search when there is no URL yet. Fetch the page and at most two
            children. Agent only with a code-template goal, read-only, at most
            once. No TinyBrowser. Named failures stay named.
          </p>
        </li>
        <li>
          <h2>Gemma chooses tools</h2>
          <p>
            The model sees a sanitized question and tool results, not your
            phone and not a conversation key. If two sources disagree, Lodge
            says both.
          </p>
        </li>
        <li>
          <h2>Slips are public paper</h2>
          <p>
            A card URL carries title, when, where, and a source link. No
            phones, names, or chat ids — same rule as /add.ics. Photos of
            posters are read and not stored.
          </p>
        </li>
      </ol>
      <p className="quiet-line">
        Quiet hours 22:00–08:00 for desk notes you did not ask to be woken
        for. This companion has no live backend and no secrets in the bundle.
      </p>
    </article>
  );
}
