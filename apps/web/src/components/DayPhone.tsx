import { useEffect, useRef } from "react";
import {
  beatAt,
  buildTimeline,
  dayBeats,
  firstRoleUrl,
  lockNotes,
  phoneFace,
  visibleLineIds,
  type TapKind,
  type TimedLine,
} from "../data/day.js";

const timeline = buildTimeline();
const notices = lockNotes();

type DayPhoneProps = {
  progress: number;
  extraHearts: Record<string, boolean>;
  onTap: (id: string) => void;
  onOpenLock: () => void;
};

export function DayPhone({ progress, extraHearts, onTap, onOpenLock }: DayPhoneProps) {
  const innerRef = useRef<HTMLDivElement>(null);
  const beat = beatAt(progress);
  const face = phoneFace(progress, dayBeats, timeline);
  const visible = visibleLineIds(progress, timeline);
  const looking = timeline.find((line) => line.kind === "looking" && visible.has(line.id));
  const island = looking?.kind === "looking" ? looking.text : "";
  const open = face === "messages";

  const visibleCount = visible.size;
  useEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;
    inner.scrollTop = inner.scrollHeight;
  }, [visibleCount, extraHearts, face]);

  return (
    <figure className="handset-wrap">
      <div
        className={`handset${open ? " handset--open" : ""}${face === "sleep" ? " handset--sleep" : ""}`}
        aria-label="A day with Lodge on iPhone"
      >
        <span className="handset__btn handset__btn--ring" />
        <span className="handset__btn handset__btn--rocker" />
        <span className="handset__btn handset__btn--power" />
        <div className="handset__body">
          <div className="handset__bezel">
            <div className="handset__screen">
              <LockScreen
                clock={beat.clock}
                off={open}
                onOpen={onOpenLock}
                sleeping={face === "sleep"}
              />
              <div className={open ? "imsg" : "imsg imsg--off"} aria-hidden={!open}>
                <header className="imsg__nav">
                  <span className="imsg__back" aria-hidden="true">
                    <ChevronIcon />
                    <em>3</em>
                  </span>
                  <p className="imsg__who">
                    <span className="imsg__face">L</span>
                    <span className="imsg__name">Lodge</span>
                  </p>
                  <span className="imsg__video" aria-hidden="true">
                    <VideoIcon />
                  </span>
                </header>
                <div className="imsg__thread" ref={innerRef}>
                  <Thread extraHearts={extraHearts} onTap={onTap} progress={progress} visible={visible} />
                </div>
                <div className="imsg__bar" aria-hidden="true">
                  <span className="imsg__plus">+</span>
                  <span className="imsg__field">
                    iMessage
                    <MicIcon />
                  </span>
                </div>
              </div>
              <div className="handset__status">
                <span className="handset__clock">{beat.clock}</span>
                <span className="handset__radios">
                  <SignalIcon />
                  <WifiIcon />
                  <BatteryIcon />
                </span>
              </div>
              <div className="handset__notch" aria-hidden="true">
                <i className="handset__ear" />
                <i className="handset__lens" />
              </div>
              {island ? <p className="handset__listen">{island}</p> : null}
              <div className="handset__home" />
            </div>
          </div>
        </div>
      </div>
      <figcaption>
        Open a banner, tap a bubble to heart it, then open a slip or tap Save. Lodge never adds the
        week for you.
      </figcaption>
    </figure>
  );
}

function LockScreen({
  clock,
  sleeping,
  off,
  onOpen,
}: {
  clock: string;
  sleeping: boolean;
  off: boolean;
  onOpen: () => void;
}) {
  return (
    <div className={off ? "lock lock--off" : "lock"} data-sleep={sleeping ? "true" : undefined} aria-hidden={off}>
      <div className="lock__wall" />
      <div className="lock__dim" />
      <p className="lock__date">{sleeping ? "Quiet hours" : "Wednesday"}</p>
      <p className="lock__time">{clock}</p>
      <ul className="lock__notes">
        {notices.map((note) => (
          <li key={note}>
            <button type="button" onClick={onOpen}>
              <i className="lock__mark">L</i>
              <p>
                <strong>Lodge</strong>
                <span>{note}</span>
              </p>
            </button>
          </li>
        ))}
      </ul>
      <div className="lock__tools" aria-hidden="true">
        <span>
          <FlashIcon />
        </span>
        <span>
          <CameraIcon />
        </span>
      </div>
    </div>
  );
}

function Thread({
  visible,
  extraHearts,
  onTap,
  progress,
}: {
  visible: Set<string>;
  extraHearts: Record<string, boolean>;
  onTap: (id: string) => void;
  progress: number;
}) {
  const taps = new Map<string, TapKind>();
  for (const line of timeline) {
    if (line.kind === "tapback" && visible.has(line.id)) taps.set(line.on, line.tap);
  }
  const rows = timeline.filter((line) => line.kind !== "tapback" && visible.has(line.id));
  return (
    <ol className="imsg__list" aria-label="A day with Lodge">
      {rows.map((line, index) => (
        <Bubble
          extraHeart={Boolean(extraHearts[line.id])}
          key={line.id}
          line={line}
          onTap={onTap}
          previous={previousSide(rows, index)}
          tap={taps.get(line.id) ?? undefined}
          tail={isTail(rows, index)}
        />
      ))}
      {delivered(progress, visible) ? <li className="imsg__delivered">Delivered</li> : null}
    </ol>
  );
}

function previousSide(rows: TimedLine[], index: number): "you" | "lodge" | null {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const line = rows[cursor];
    if (!line || line.kind === "stamp" || line.kind === "looking") continue;
    return line.kind === "you" ? "you" : "lodge";
  }
  return null;
}

function isTail(rows: TimedLine[], index: number): boolean {
  const line = rows[index];
  if (!line || line.kind === "stamp" || line.kind === "looking") return line?.kind === "looking";
  const side = line.kind === "you" ? "you" : "lodge";
  const next = rows[index + 1];
  if (!next || next.kind === "stamp" || next.kind === "looking") return true;
  return (next.kind === "you" ? "you" : "lodge") !== side;
}

function delivered(progress: number, visible: Set<string>): boolean {
  const lastYou = [...timeline].reverse().find((line) => line.kind === "you" && visible.has(line.id));
  if (!lastYou) return false;
  const later = timeline.some(
    (line) =>
      line.at > lastYou.at &&
      visible.has(line.id) &&
      line.kind !== "you" &&
      line.kind !== "stamp" &&
      line.kind !== "tapback",
  );
  return !later && progress < 0.97;
}

function Bubble({
  line,
  previous,
  tail,
  tap,
  extraHeart,
  onTap,
}: {
  line: TimedLine;
  previous: "you" | "lodge" | null;
  tail: boolean;
  tap?: TapKind | undefined;
  extraHeart: boolean;
  onTap: (id: string) => void;
}) {
  const mark = tap ?? (extraHeart ? "heart" : undefined);

  if (line.kind === "stamp") {
    return <li className="imsg__stamp">{line.text}</li>;
  }

  if (line.kind === "looking") {
    return (
      <li className="imsg__row imsg__row--in imsg__row--tail">
        <div className="imsg__bubble imsg__bubble--type" aria-label="Lodge is typing">
          <i />
          <i />
          <i />
        </div>
      </li>
    );
  }

  const outgoing = line.kind === "you";
  const side = outgoing ? "out" : "in";
  const gap = previous && previous !== (outgoing ? "you" : "lodge") ? " imsg__row--gap" : "";
  const tailClass = tail ? " imsg__row--tail" : "";
  const tapClass = mark ? " imsg__row--tap" : "";

  if (line.kind === "slip" || line.kind === "save") {
    return (
      <li className={`imsg__row imsg__row--${side}${gap}${tailClass}${tapClass}`}>
        <a className="imsg__bubble imsg__bubble--card" href={line.href}>
          <strong>{line.title}</strong>
          <span>{line.body}</span>
          <small>{line.kind === "save" ? "Save — you approve" : "Open slip"}</small>
          {mark ? <Tap mark={mark} /> : null}
        </a>
      </li>
    );
  }

  if (line.kind === "role") {
    return (
      <li className={`imsg__row imsg__row--${side}${gap}${tailClass}${tapClass}`}>
        <button className="imsg__bubble imsg__bubble--card" type="button" onClick={() => onTap(line.id)}>
          <strong>{line.company}</strong>
          <span>{line.title}</span>
          <small>{line.open ? "Still open" : "Not checked live"}</small>
          {line.open ? (
            <a className="imsg__more" href={firstRoleUrl()} onClick={(event) => event.stopPropagation()}>
              FirstRole
            </a>
          ) : null}
          {mark ? <Tap mark={mark} /> : null}
        </button>
      </li>
    );
  }

  const text = line.kind === "you" || line.kind === "lodge" ? line.text : "";
  return (
    <li className={`imsg__row imsg__row--${side}${gap}${tailClass}${tapClass}`}>
      <button className="imsg__bubble" type="button" onClick={() => onTap(line.id)}>
        {text}
        {mark ? <Tap mark={mark} /> : null}
      </button>
    </li>
  );
}

function Tap({ mark }: { mark: TapKind }) {
  return <span className="imsg__tap">{mark === "heart" ? "❤️" : "👍"}</span>;
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 12 20" aria-hidden="true">
      <path d="M10 2 2 10l8 8" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

function VideoIcon() {
  return (
    <svg viewBox="0 0 28 18" aria-hidden="true">
      <rect x="1" y="2" width="17" height="14" rx="3.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M20 6.2 26 3.4v11.2L20 11.8z" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 14 20" aria-hidden="true">
      <rect x="4" y="1" width="6" height="11" rx="3" fill="currentColor" />
      <path d="M1.6 9a5.4 5.4 0 0 0 10.8 0M7 14.4V19" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function SignalIcon() {
  return (
    <svg viewBox="0 0 18 12" aria-hidden="true">
      <rect x="0" y="8" width="3" height="4" rx="0.7" fill="currentColor" />
      <rect x="5" y="5.4" width="3" height="6.6" rx="0.7" fill="currentColor" />
      <rect x="10" y="3" width="3" height="9" rx="0.7" fill="currentColor" />
      <rect x="15" y="0" width="3" height="12" rx="0.7" fill="currentColor" />
    </svg>
  );
}

function WifiIcon() {
  return (
    <svg viewBox="0 0 16 12" aria-hidden="true">
      <path
        d="M8 2.2c2.4 0 4.6.9 6.3 2.5l1.2-1.3A10.8 10.8 0 0 0 8 .4 10.8 10.8 0 0 0 .5 3.4L1.7 4.7A9 9 0 0 1 8 2.2zm0 3.5c1.4 0 2.7.5 3.7 1.4l1.2-1.3A7 7 0 0 0 8 4.1 7 7 0 0 0 3.1 5.8L4.3 7A5 5 0 0 1 8 5.7zm0 3.5c-.6 0-1.1.2-1.5.6L8 11.6l1.5-1.8c-.4-.4-.9-.6-1.5-.6z"
        fill="currentColor"
      />
    </svg>
  );
}

function BatteryIcon() {
  return (
    <svg viewBox="0 0 27 13" aria-hidden="true">
      <rect x="0.6" y="0.6" width="22" height="11.8" rx="3" fill="none" stroke="currentColor" opacity="0.4" />
      <rect x="2.2" y="2.2" width="16" height="8.6" rx="1.8" fill="currentColor" />
      <path d="M24.6 4.2v4.6c.9-.4 1.4-1.2 1.4-2.3s-.5-1.9-1.4-2.3z" fill="currentColor" opacity="0.45" />
    </svg>
  );
}

function FlashIcon() {
  return (
    <svg viewBox="0 0 20 28" aria-hidden="true">
      <path d="M11.2 1 3 16h7l-1.4 11L17 12h-7z" fill="currentColor" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 28 22" aria-hidden="true">
      <rect x="1.4" y="5" width="25.2" height="15.4" rx="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="14" cy="12.6" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9.2 5 11 2.2h6L18.8 5" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
