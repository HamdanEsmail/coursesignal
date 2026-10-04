import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "../lib/motion.js";

export function DemoReel() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || prefersReducedMotion()) return;
    void video
      .play()
      .then(() => setPlaying(true))
      .catch(() => setPlaying(false));
  }, []);

  const toggle = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play().then(() => setPlaying(true));
      return;
    }
    video.pause();
    setPlaying(false);
  };

  return (
    <figure className="device">
      <div className="device__stage">
        <video
          ref={videoRef}
          className="device__film"
          src="/demo.mp4"
          poster="/poster.jpg"
          muted
          loop
          playsInline
          preload="metadata"
          width={390}
          height={488}
        >
          Hamdan texting Lodge
        </video>
        <button
          type="button"
          className="device__play"
          onClick={toggle}
          aria-pressed={playing}
        >
          {playing ? "Pause" : "Play"}
        </button>
      </div>
      <figcaption>Hamdan texting Lodge. A week, Save, then a heart.</figcaption>
    </figure>
  );
}
