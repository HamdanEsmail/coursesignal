const holes = ["Econ", "Friday", "Baker", "Dubai", "Quiet", "Week"];

export function CubbyFrieze() {
  return (
    <div className="frieze" aria-hidden="true">
      {holes.map((plate, index) => (
        <div className={index === 1 ? "frieze__hole frieze__hole--drawn" : "frieze__hole"} key={plate}>
          <span className="frieze__recess">
            {index === 1 ? <span className="frieze__void" /> : <span className="frieze__tab" />}
          </span>
          <span className="frieze__plate">{plate}</span>
        </div>
      ))}
    </div>
  );
}
