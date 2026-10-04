import { useEffect, useState } from "react";
import { BrandMark } from "./components/BrandMark.js";
import { DayStage } from "./components/DayStage.js";
import { DemoReel } from "./components/DemoReel.js";
import { EventLinks } from "./components/EventLinks.js";
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
          <a href="#start">How to start</a>
          <a href="#roles">What happens</a>
          <a className="key-link" href={slipHref}>
            See a slip
          </a>
        </nav>
      </header>

      <main id="main-content" tabIndex={-1}>
        <DayStage />

        <section className="band band--start" id="start" aria-labelledby="start-title">
          <div className="shell start">
            <div>
              <h2 id="start-title">Text START. Then talk like a person.</h2>
              <p>
                Lodge waits for START before it looks anything up. Skip any question you do not want
                to answer. Ordinary words are enough after that.
              </p>
              <p>Keep passwords and private school logins out of the thread.</p>
            </div>
            <ul className="say-list">
              <li>
                <kbd>START</kbd>
                <span>First hello. Lodge only explains itself until you send this.</span>
              </li>
              <li>
                <kbd>what's due this week?</kbd>
                <span>It reads the public page you saved and sends a slip you can tap.</span>
              </li>
              <li>
                <kbd>save the week</kbd>
                <span>A card opens. You approve. Lodge never adds a date by itself.</span>
              </li>
              <li>
                <kbd>remind me Friday 5</kbd>
                <span>Lodge texts first. Thumbs-up is done.</span>
              </li>
              <li>
                <kbd>any internships in Dubai?</kbd>
                <span>A few public listings. Lodge never applies.</span>
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

        <section className="band band--moments" id="roles" aria-labelledby="moments-title">
          <div className="shell">
            <h2 id="moments-title">What actually happens.</h2>
            <div className="moments">
              <article className="moment moment--remind">
                <picture className="moment__wash">
                  <source srcSet="/dusk.webp" type="image/webp" />
                  <img src="/dusk.jpg" alt="" width="640" height="800" loading="lazy" decoding="async" />
                </picture>
                <h3>Lodge texts first</h3>
                <p className="moment__you">remind me Friday 5</p>
                <p className="moment__lodge">
                  A remind lands in the thread. Quiet hours stay out of the night unless you asked
                  to be woken.
                </p>
              </article>
              <article className="moment moment--week">
                <h3>You keep the week</h3>
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
                <picture className="moment__wash">
                  <source srcSet="/roles.webp" type="image/webp" />
                  <img src="/roles.jpg" alt="" width="640" height="640" loading="lazy" decoding="async" />
                </picture>
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
                <h3>You approve every date</h3>
                <p>A slip is a title, a time, a place, and a page. The week goes on a calendar only when you tap Save.</p>
              </li>
            </ul>
          </div>
        </section>

        <section className="band band--film" id="demo" aria-labelledby="demo-title">
          <div className="shell film">
            <div className="film__copy">
              <h2 id="demo-title">The real thread, when we have it.</h2>
              <p>
                The phone above is a sample Wednesday. This frame is for Hamdan’s portrait recording
                of the real thread.
              </p>
            </div>
            <DemoReel />
          </div>
        </section>

        <section className="band band--judge" id="judge" aria-labelledby="judge-title" data-open={view === "judge" ? "true" : undefined}>
          <div className="shell">
            <h2 id="judge-title">For reviewers</h2>
            <p>Sample questions only. Students use the day on the phone. Nothing here spends a live lookup.</p>
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
            <ol className="judge-sees">
              {judge.steps.map((step) => (
                <li key={`${step.endpoint}-${step.label}`}>
                  <strong>{step.studentSees}</strong>
                  <span>{step.detail}</span>
                </li>
              ))}
            </ol>
            {judge.disagreement ? <p>{judge.disagreement}</p> : null}
          </div>
        </section>
      </main>

      <footer className="colophon">
        <BrandMark href="#arrive" />
        <p>Lodge is a friend in iMessage.</p>
        <p>
          <a href="#start">How to start</a>
          <span aria-hidden="true"> · </span>
          <a href="#judge">Reviewers</a>
        </p>
      </footer>
    </div>
  );
}
