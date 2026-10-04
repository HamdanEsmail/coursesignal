import { useEffect, useMemo, useState } from "react";
import { icsPath, slipPath } from "../lib/calendar.js";
import { prefersReducedMotion } from "../lib/motion.js";
import type { LodgeFixture } from "../data/fixtures.js";

type PhoneReplayProps = {
  fixture: LodgeFixture;
  autoplay: boolean;
};

export function PhoneReplay({ fixture, autoplay }: PhoneReplayProps) {
  const frames = useMemo(() => buildFrames(fixture), [fixture]);
  const [index, setIndex] = useState(() => (autoplay && !prefersReducedMotion() ? 0 : frames.length - 1));

  useEffect(() => {
    const reduce = prefersReducedMotion();
    setIndex(autoplay && !reduce ? 0 : frames.length - 1);
    if (!autoplay || reduce) return;
    const id = window.setInterval(() => {
      setIndex((current) => (current + 1) % frames.length);
    }, 1600);
    return () => window.clearInterval(id);
  }, [autoplay, fixture, frames.length]);

  const visible = frames.slice(0, index + 1);
  const slipHref = fixture.events.length > 0 ? slipPath(fixture.events) : undefined;
  const weekHref = fixture.events.length > 0 ? icsPath(fixture.events) : undefined;

  return (
    <figure className="phone">
      <div className="phone__bezel">
        <div className="phone__island" />
        <p className="phone__who">Lodge</p>
        <ol className="phone__thread" aria-label="A sample Lodge thread">
          {visible.map((frame) => (
            <li key={frame.id} className={`phone__row phone__row--${frame.role}`}>
              {frame.role === "you" ? (
                <p className="phone__you">{frame.text}</p>
              ) : (
                <article className="thread-slip">
                  <p>{frame.text}</p>
                  {frame.finished && (slipHref || weekHref) ? (
                    <p className="thread-slip__meta">
                      {slipHref ? <a href={slipHref}>Open the slip</a> : null}
                      {weekHref ? <a href={weekHref}>Add this week</a> : null}
                    </p>
                  ) : null}
                </article>
              )}
            </li>
          ))}
        </ol>
      </div>
      <figcaption>A sample week. No names.</figcaption>
    </figure>
  );
}

type Frame = {
  id: string;
  role: "you" | "lodge";
  text: string;
  finished?: boolean;
};

function buildFrames(fixture: LodgeFixture): Frame[] {
  const frames: Frame[] = [{ id: "ask", role: "you", text: fixture.asked }];
  for (const step of fixture.steps) {
    if (step.status === "skipped") continue;
    frames.push({
      id: `${step.endpoint}-${step.label}`,
      role: "lodge",
      text: step.studentSees,
    });
  }
  frames.push({
    id: "done",
    role: "lodge",
    text: finishLine(fixture),
    finished: true,
  });
  return frames;
}

function finishLine(fixture: LodgeFixture): string {
  if (fixture.id === "due-week") {
    return "Econ problem set, Friday 17:00. The syllabus says end of week — Lodge kept both.";
  }
  if (fixture.events.length > 0) {
    return fixture.events.map((event) => event.title).join(" · ");
  }
  if (fixture.roles) {
    return fixture.roles
      .map((listing) => `${listing.company} — ${listing.title}`)
      .join(" · ");
  }
  return fixture.summary;
}
