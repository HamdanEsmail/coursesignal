import { buildIcs, LODGE_ICS_QUERY_HINT, parseEventQuery } from "./lib/calendar.js";

export type PagesAssetsEnv = {
  ASSETS: {
    fetch: (request: Request) => Promise<Response>;
  };
};

const ICS_HEADERS = {
  "content-type": "text/calendar; charset=utf-8",
  "content-disposition": 'attachment; filename="lodge.ics"',
};

export function isAddIcsPath(pathname: string): boolean {
  return pathname.replace(/\/+$/, "") === "/add.ics";
}

export async function handleLodgeRequest(request: Request, env: PagesAssetsEnv): Promise<Response> {
  const url = new URL(request.url);
  if (isAddIcsPath(url.pathname) && (request.method === "GET" || request.method === "HEAD")) {
    const events = parseEventQuery(url.searchParams);
    if (events.length === 0) {
      return new Response(LODGE_ICS_QUERY_HINT, {
        status: 400,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    if (request.method === "HEAD") {
      return new Response(null, { status: 200, headers: ICS_HEADERS });
    }
    return new Response(buildIcs(events), { status: 200, headers: ICS_HEADERS });
  }
  return env.ASSETS.fetch(request);
}

export default {
  fetch(request: Request, env: PagesAssetsEnv): Promise<Response> {
    return handleLodgeRequest(request, env);
  },
};
