export type SiteRoute = "wall" | "slip" | "add";

export function routeFromPath(pathname = window.location.pathname): SiteRoute {
  const clean = pathname.replace(/\/+$/, "") || "/";
  if (clean === "/slip" || clean.endsWith("/slip")) return "slip";
  if (clean === "/add" || clean === "/add.ics" || clean.endsWith("/add") || clean.endsWith("/add.ics")) {
    return "add";
  }
  return "wall";
}

export function isIcsPath(pathname = window.location.pathname): boolean {
  return pathname.replace(/\/+$/, "").endsWith("/add.ics");
}
