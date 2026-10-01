import { FlaskConical } from "lucide-react";

type FixtureNoticeProps = {
  children?: string;
};

export function FixtureNotice({ children }: FixtureNoticeProps) {
  return (
    <div className="fixture-notice" role="note">
      <FlaskConical aria-hidden="true" size={18} strokeWidth={1.7} />
      <p>
        <strong>Fixture preview.</strong>{" "}
        {children ?? "The content on this screen is synthetic and is not live iMessage data."}
      </p>
    </div>
  );
}
