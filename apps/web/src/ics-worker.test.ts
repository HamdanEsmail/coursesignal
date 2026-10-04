import { describe, expect, it } from "vitest";
import { handleLodgeRequest } from "./ics-worker.js";

const assets = {
  fetch: async () =>
    new Response("<html>wall</html>", { headers: { "content-type": "text/html; charset=utf-8" } }),
};

describe("Pages /add.ics worker", () => {
  it("serves text/calendar for a Lodge event query", async () => {
    const response = await handleLodgeRequest(
      new Request("https://coursesignal-bzb.pages.dev/add.ics?title=Office+hours&start=2026-10-09T15:00:00&location=Baker+102"),
      { ASSETS: assets },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    const body = await response.text();
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain("SUMMARY:Office hours");
    expect(body).toContain("LOCATION:Baker 102");
    expect(body).not.toContain("<html>");
  });

  it("rejects an empty calendar query without falling back to HTML", async () => {
    const response = await handleLodgeRequest(
      new Request("https://coursesignal-bzb.pages.dev/add.ics"),
      { ASSETS: assets },
    );
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await response.text()).toContain("title and start");
  });

  it("leaves the companion pages on ASSETS", async () => {
    const response = await handleLodgeRequest(
      new Request("https://coursesignal-bzb.pages.dev/"),
      { ASSETS: assets },
    );
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("wall");
  });
});
