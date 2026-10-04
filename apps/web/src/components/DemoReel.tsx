import { useEffect, useState } from "react";
import { dueWeekFixture } from "../data/fixtures.js";
import { PhoneReplay } from "./PhoneReplay.js";

export function DemoReel() {
  const [film, setFilm] = useState<"unknown" | "ready" | "missing">("unknown");

  useEffect(() => {
    let alive = true;
    fetch("/demo.mp4", { method: "HEAD" })
      .then((response) => {
        const type = response.headers.get("content-type") ?? "";
        if (alive) setFilm(response.ok && type.startsWith("video/") ? "ready" : "missing");
      })
      .catch(() => {
        if (alive) setFilm("missing");
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <figure className="device">
      <div className="device__bezel">
        <div className="device__island" />
        {film === "ready" ? (
          <video
            className="device__film"
            src="/demo.mp4"
            poster="/poster.jpg"
            autoPlay
            muted
            loop
            playsInline
            controls={false}
            onError={() => setFilm("missing")}
          />
        ) : (
          <div className="device__placeholder">
            <PhoneReplay fixture={dueWeekFixture} autoplay={film === "missing"} />
            {film === "missing" ? (
              <p className="device__slot">Hamdan’s portrait iPhone clip of texting Lodge belongs in this frame.</p>
            ) : null}
          </div>
        )}
      </div>
      <figcaption>
        {film === "ready"
          ? "A real iMessage thread with Lodge."
          : "See it on iMessage. A short portrait recording of Hamdan texting Lodge belongs in this frame."}
      </figcaption>
    </figure>
  );
}
