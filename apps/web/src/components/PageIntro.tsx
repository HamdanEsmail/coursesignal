import type { ReactNode } from "react";

type PageIntroProps = {
  title: string;
  description: string;
  aside?: ReactNode;
};

export function PageIntro({ title, description, aside }: PageIntroProps) {
  return (
    <header className="page-intro">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {aside ? <div className="page-intro__aside">{aside}</div> : null}
    </header>
  );
}
