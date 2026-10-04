import { describe, expect, it } from "vitest";
import { isIcsPath, routeFromPath } from "./route.js";

describe("routeFromPath", () => {
  it("sends hosted slips and calendar files off the wall", () => {
    expect(routeFromPath("/")).toBe("wall");
    expect(routeFromPath("/slip")).toBe("slip");
    expect(routeFromPath("/add")).toBe("add");
    expect(routeFromPath("/add.ics")).toBe("add");
    expect(isIcsPath("/add.ics")).toBe(true);
    expect(isIcsPath("/add")).toBe(false);
  });
});
