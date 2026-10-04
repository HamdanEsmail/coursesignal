import { useEffect, useState } from "react";
import {
  CHAPTER_PLAY_MS,
  beatAt,
  beatEndProgress,
  beatIndex,
  beatStartProgress,
  dayBeats,
} from "../data/day.js";
import { prefersReducedMotion } from "../lib/motion.js";
import { DayPhone } from "./DayPhone.js";

export function DayStage() {
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [token, setToken] = useState(0);
  const [range, setRange] = useState({ from: 0, to: 0 });
  const [hearts, setHearts] = useState<Record<string, boolean>>({});
  const beat = beatAt(progress);
  const index = beatIndex(progress);
  const held = !playing && progress > 0;
  const next = dayBeats[index + 1];

  useEffect(() => {
    if (!playing) return;
    if (prefersReducedMotion()) {
      setProgress(range.to);
      setPlaying(false);
      return;
    }
    const started = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / CHAPTER_PLAY_MS);
      setProgress(range.from + (range.to - range.from) * t);
      if (t < 1) frame = window.requestAnimationFrame(tick);
      else setPlaying(false);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [playing, range, token]);

  const playChapter = (chapter: number) => {
    const from = beatStartProgress(chapter);
    const to = beatEndProgress(chapter);
    setHearts((current) => (chapter === 0 ? {} : current));
    setRange({ from, to });
    setProgress(from);
    setPlaying(true);
    setToken((value) => value + 1);
  };

  const holdChapter = (chapter: number) => {
    setPlaying(false);
    setProgress(beatEndProgress(chapter));
  };

  const primary = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (held && next) {
      playChapter(index + 1);
      return;
    }
    playChapter(held ? 0 : index);
  };

  const primaryLabel = playing
    ? "Pause this moment"
    : held && next
      ? `Play ${next.rail.toLowerCase()}`
      : held
        ? "Play Wednesday again"
        : "Play this moment";

  return (
    <section className="desk" id="arrive" aria-labelledby="hero-title">
      <div className="desk__copy">
        <h1 id="hero-title">A friend at the dusk desk.</h1>
        <p>
          Lodge lives in iMessage. It texts first when something is due, keeps both dates if pages
          disagree, and only puts the week on your calendar if you tap Save. Heart a slip to pin it.
        </p>
        <div className="hero__actions">
          <a className="key-link" href="#start">
            Text START
          </a>
          <button className="ghost-link" type="button" onClick={primary}>
            {primaryLabel}
          </button>
        </div>
        <div className="desk__happen">
          <p className="desk__clock">{beat.clock}</p>
          <h2>{beat.title}</h2>
          <p>{beat.happen}</p>
          <p className="desk__say">
            Try this in the thread: <kbd>{beat.say}</kbd>
          </p>
          <p className="desk__cue">{beat.cue}</p>
        </div>
        <ol className="ledger-day" aria-label="Wednesday, moment by moment">
          {dayBeats.map((item, chapter) => {
            const current = item.id === beat.id;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  aria-current={current ? "true" : undefined}
                  onClick={() => (current && !playing ? holdChapter(chapter) : playChapter(chapter))}
                >
                  <span className="ledger-day__clock">{item.clock}</span>
                  <span className="ledger-day__copy">
                    <strong>{item.rail}</strong>
                    <em>{item.say}</em>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="desk__stage">
        <DayPhone
          extraHearts={hearts}
          onOpenLock={() => playChapter(0)}
          onTap={(id) => setHearts((current) => ({ ...current, [id]: !current[id] }))}
          progress={progress}
        />
      </div>
    </section>
  );
}
