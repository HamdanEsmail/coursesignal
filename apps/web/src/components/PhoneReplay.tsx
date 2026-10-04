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
    }, 1400);
    return () => window.clearInterval(id);
  }, [autoplay, fixture, frames.length]);

  const visible = frames.slice(0, index + 1);
  const slipHref = fixture.events.length > 0 ? slipPath(fixture.events) : undefined;
  const weekHref = fixture.events.length > 0 ? icsPath(fixture.events) : undefined;

  return (
    <figure className="phone">
      <div className="phone__bezel">
        <div className="phone__ear" />
        <ol className="phone__thread" aria-label="Sanitized Lodge thread">
          {visible.map((frame) => (
            <li key={frame.id} className={`phone__row phone__row--${frame.role}`}>
              {frame.role === "you" ? (
                <p className="phone__you">{frame.text}</p>
              ) : (
                <article className="thread-slip">
                  <p>{frame.text}</p>
                  {frame.finished && weekHref ? (
                    <p className="thread-slip__meta">
                      <a href={slipHref}>Open the limestone slip</a>
                      <a href={weekHref}>Add this week</a>
                    </p>
                  ) : null}
                </article>
              )}
            </li>
          ))}
        </ol>
      </div>
      <figcaption>Sanitized fixture. No names, phones, or conversation keys.</figcaption>
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
  if (fixture.events.length > 0) {
    const titles = fixture.events.map((event) => event.title).join(" · ");
    return fixture.disagreement ? `${titles}. ${fixture.disagreement}` : titles;
  }
  if (fixture.roles) {
    return fixture.roles
      .map((listing) => `${listing.company} — ${listing.title} (${listing.openness})`)
      .join(" · ");
  }
  return fixture.summary;
}
