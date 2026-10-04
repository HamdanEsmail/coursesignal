import { cubbies, type AppView } from "../views.js";

type CubbyWallProps = {
  view: AppView;
  onNavigate: (view: AppView) => void;
};

export function CubbyWall({ view, onNavigate }: CubbyWallProps) {
  return (
    <nav className="cubby-wall" aria-label="Lodge cubbies">
      {cubbies.map((cubby) => {
        const open = cubby.id === view;
        return (
          <button
            key={cubby.id}
            type="button"
            className={open ? "cubby cubby--open" : "cubby"}
            aria-current={open ? "page" : undefined}
            onClick={() => onNavigate(cubby.id)}
          >
            <span className="cubby__recess">
              {open ? <span className="cubby__void" /> : <span className="cubby__tab" />}
            </span>
            <span className="cubby__plate">{cubby.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
