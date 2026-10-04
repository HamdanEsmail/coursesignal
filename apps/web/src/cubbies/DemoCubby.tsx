import { PhoneReplay } from "../components/PhoneReplay.js";
import { dueWeekFixture } from "../data/fixtures.js";
import { prefersReducedMotion } from "../lib/motion.js";

export function DemoCubby() {
  const still = prefersReducedMotion();

  return (
    <article className="slip-copy">
      <h1>#demo</h1>
      <p>
        A due-week run on a dusk phone. The slip updates in place: looking it
        up, reading the page, then the week. Motion is 420ms. If you asked the
        system to reduce motion, this cubby stays on the finished slip.
      </p>
      <PhoneReplay fixture={dueWeekFixture} autoplay={!still} />
      <p className="quiet-line">
        Fixture replay only. Lodge is not fetching from this page, and the
        thread has no sender identity.
      </p>
    </article>
  );
}
