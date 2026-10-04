import type { ReactNode } from "react";

type PageIntroProps = {
  kicker?: string;
  title: string;
  description: string;
  aside?: ReactNode;
};

export function PageIntro({ kicker, title, description, aside }: PageIntroProps) {
  return (
    <header className="page-intro">
      <div>
        {kicker ? <p className="worksheet__kicker">{kicker}</p> : null}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {aside ? <div className="page-intro__aside">{aside}</div> : null}
    </header>
  );
}
