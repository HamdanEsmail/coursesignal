import { useEffect, useState } from "react";
import { BrandMark } from "./components/BrandMark.js";
import { CubbyFrieze } from "./components/CubbyFrieze.js";
import { DemoReel } from "./components/DemoReel.js";
import { EventLinks } from "./components/EventLinks.js";
import { Ledger } from "./components/Ledger.js";
import { PhoneReplay } from "./components/PhoneReplay.js";
import { FIRSTROLE_URL, dueWeekFixture, fixtures, rolesFixture, type LodgeFixture } from "./data/fixtures.js";
import { slipPath } from "./lib/calendar.js";
import { prefersReducedMotion } from "./lib/motion.js";
import { viewFromHash, type AppView } from "./views.js";

const slipHref = slipPath(dueWeekFixture.events);

export function App() {
  const [view, setView] = useState<AppView>(() => viewFromHash());
  const [judgeId, setJudgeId] = useState<LodgeFixture["id"]>("due-week");

  useEffect(() => {
    const sync = () => {
      const next = viewFromHash();
      setView(next);
      const hash = window.location.hash.replace(/^#/, "").trim().toLowerCase();
      if (hash && hash !== next) {
        window.history.replaceState(null, "", `#${next}`);
      }
      const target = document.getElementById(next);
      if (hash && target) {
        target.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
      }
    };
    window.addEventListener("hashchange", sync);
    sync();
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const judge = fixtures.find((item) => item.id === judgeId) ?? fixtures[0]!;

  return (
    <div className="lodge">
      <a className="skip-link" href="#main-content">
        Skip to Lodge
      </a>
      <header className="mast">
        <BrandMark href="#arrive" />
        <nav className="mast__nav" aria-label="Lodge">
          <a href="#demo">On iMessage</a>
          <a href="#start">Start</a>
          <a className="key-link" href={slipHref}>
            See a slip
          </a>
        </nav>
      </header>

      <main id="main-content" tabIndex={-1}>
        <section className="band band--hero" id="arrive" aria-labelledby="hero-title">
          <div className="shell hero">
            <div className="hero__copy">
              <h1 id="hero-title">The friend who looks it up.</h1>
              <p>
                Lodge lives in iMessage. Text a question. It reads the public page, sends a slip you
                can tap, and the week can go on your calendar if you want it there.
              </p>
              <div className="hero__actions">
                <a className="key-link" href="#demo">
                  See it on iMessage
                </a>
                <a className="ghost-link" href={slipHref}>
                  See a slip
                </a>
              </div>
            </div>
            <PhoneReplay fixture={dueWeekFixture} autoplay />
          </div>
          <CubbyFrieze />
        </section>

        <section className="band band--feel" aria-labelledby="feel-title">
          <div className="shell feel">
            <div className="feel__copy">
              <h2 id="feel-title">It feels like texting someone who already has the page open.</h2>
              <p>
                No new app. You ask what’s due, what’s on Friday, or whether a listing is still
                open. Lodge answers in the same thread: looking it up, reading the page, then the
                dates.
              </p>
              <p>
                If two pages disagree, it keeps both. It never guesses a winner. Tap the slip for
                the full card.
              </p>
              <p>
                <a className="key-link" href={slipHref}>
                  Open this week’s slip
                </a>
              </p>
            </div>
            <ol className="feel__beats">
              <li>
                <strong>You text</strong>
                <p>what’s due this week?</p>
              </li>
              <li>
                <strong>Lodge looks</strong>
                <p>the public page, then the dates on it.</p>
              </li>
              <li>
                <strong>A slip comes back</strong>
                <p>Econ problem set, Friday 17:00. The syllabus says end of week — both stay.</p>
              </li>
            </ol>
          </div>
        </section>

        <section className="band band--film" id="demo" aria-labelledby="demo-title">
          <div className="shell film">
            <div className="film__copy">
              <h2 id="demo-title">See it on iMessage.</h2>
              <p>
                A short portrait of Hamdan texting Lodge. This is the product: the thread, not a
                website to live in.
              </p>
            </div>
            <DemoReel />
          </div>
        </section>

        <section className="band band--moments" id="roles" aria-labelledby="moments-title">
          <div className="shell">
            <h2 id="moments-title">Three things Lodge actually does.</h2>
            <div className="moments">
              <article className="moment moment--remind">
                <h3>Remind me</h3>
                <p className="moment__you">remind me Friday 5</p>
                <p className="moment__lodge">Lodge texts first. Thumbs-up is done. Quiet hours stay out of the night unless you asked to be woken.</p>
              </article>
              <article className="moment moment--week">
                <h3>Keep the week</h3>
                <ol className="slip-events">
                  {dueWeekFixture.events.map((event) => (
                    <li key={event.title}>
                      <strong>{event.title}</strong>
                      <span>
                        {event.start?.includes("10-10") ? "Fri 17:00" : "Thu 15:00–16:00"}
                        {event.where ? ` · ${event.where}` : ""}
                      </span>
                    </li>
                  ))}
                </ol>
                <EventLinks events={dueWeekFixture.events} />
              </article>
              <article className="moment moment--roles">
                <h3>A few internships</h3>
                <ul className="role-board">
                  {rolesFixture.roles?.map((listing) => (
                    <li key={`${listing.company}-${listing.title}`}>
                      <strong>
                        {listing.company}
                        <span> — {listing.title}</span>
                      </strong>
                      <span className={listing.openness === "open" ? "badge badge--open" : "badge"}>
                        {listing.openness === "open" ? "still open" : "not checked live"}
                      </span>
                    </li>
                  ))}
                </ul>
                <p>
                  Lodge never applies. The longer shortlist lives on{" "}
                  <a className="text-link" href={FIRSTROLE_URL}>
                    FirstRole
                  </a>
                  .
                </p>
              </article>
            </div>
          </div>
        </section>

        <section className="band band--start" id="start" aria-labelledby="start-title">
          <div className="shell start">
            <div>
              <h2 id="start-title">Text START.</h2>
              <p>
                Lodge waits there before it looks anything up. Skip any question you don’t want to
                answer. FORGET erases the notebook.
              </p>
              <p>Ordinary words are enough. Keep passwords and private school logins out of the thread.</p>
            </div>
            <ul className="say-list">
              <li>
                <kbd>START</kbd>
                <span>First hello.</span>
              </li>
              <li>
                <kbd>what’s due this week</kbd>
                <span>It reads the public page you saved.</span>
              </li>
              <li>
                <kbd>remind me Friday 5</kbd>
                <span>Lodge texts first.</span>
              </li>
              <li>
                <kbd>any internships in Dubai?</kbd>
                <span>A few public listings, never an application.</span>
              </li>
              <li>
                <kbd>note that office hours moved</kbd>
                <span>Pin a fact. Heart the last list to do the same.</span>
              </li>
              <li>
                <kbd>FORGET</kbd>
                <span>Begin erasing this chat’s notebook.</span>
              </li>
            </ul>
          </div>
        </section>

        <section className="band band--rules" id="rules" aria-labelledby="rules-title">
          <div className="shell">
            <h2 id="rules-title">House rules, in plain words.</h2>
            <ul className="rules">
              <li>
                <h3>START is how you say yes</h3>
                <p>Until then Lodge only explains itself. Skip is always enough. FORGET, then FORGET CONFIRM, erases the notebook.</p>
              </li>
              <li>
                <h3>A friend has to read the text</h3>
                <p>Messages leave Apple’s lock so Lodge can answer. This website never sees the thread and never shows a number.</p>
              </li>
              <li>
                <h3>Public pages only</h3>
                <p>Lodge reads what anyone could open. It never logs into school sites, types into a form, or applies for you.</p>
              </li>
              <li>
                <h3>Slips are just the dates</h3>
                <p>A card carries a title, a time, a place, and a page. No names. No phones. Photos of posters are read and not stored.</p>
              </li>
            </ul>
          </div>
        </section>

        <section className="band band--judge" id="judge" aria-labelledby="judge-title" data-open={view === "judge" ? "true" : undefined}>
          <div className="shell">
            <h2 id="judge-title">For reviewers</h2>
            <p>
              Sample runs only. Students never need this page. Nothing here spends a live lookup.
            </p>
            <div className="choice-row" role="tablist" aria-label="Sample runs">
              {fixtures.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={item.id === judgeId}
                  className={item.id === judgeId ? "choice choice--on" : "choice"}
                  onClick={() => setJudgeId(item.id)}
                >
                  {item.title}
                </button>
              ))}
            </div>
            <p className="asked-line">You asked: {judge.asked}</p>
            <p>{judge.summary}</p>
            <Ledger fixture={judge} />
            {judge.disagreement ? <p>{judge.disagreement}</p> : null}
          </div>
        </section>
      </main>

      <footer className="colophon">
        <BrandMark href="#arrive" />
        <p>Lodge is a friend in iMessage.</p>
        <p>
          <a href="#demo">On iMessage</a>
          <span aria-hidden="true"> · </span>
          <a href="#judge">Reviewers</a>
        </p>
      </footer>
    </div>
  );
}
