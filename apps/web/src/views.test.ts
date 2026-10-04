import { describe, expect, it } from "vitest";
import { landingSections, viewFromHash } from "./views.js";

describe("viewFromHash", () => {
  it("defaults to the landing hero", () => {
    expect(viewFromHash("")).toBe("arrive");
    expect(viewFromHash("#")).toBe("arrive");
    expect(viewFromHash("#unknown")).toBe("arrive");
  });

  it("keeps #demo and #judge as landing sections", () => {
    expect(viewFromHash("#demo")).toBe("demo");
    expect(viewFromHash("#judge")).toBe("judge");
    expect(viewFromHash("#roles")).toBe("roles");
    expect(viewFromHash("#start")).toBe("start");
    expect(viewFromHash("#rules")).toBe("rules");
    expect(viewFromHash("#arrive")).toBe("arrive");
  });

  it("folds old field-guide hashes into the product story", () => {
    expect(viewFromHash("#today")).toBe("arrive");
    expect(viewFromHash("#connect")).toBe("start");
    expect(viewFromHash("#example")).toBe("demo");
    expect(viewFromHash("#commands")).toBe("start");
    expect(viewFromHash("#memory")).toBe("start");
    expect(viewFromHash("#watches")).toBe("start");
    expect(viewFromHash("#privacy")).toBe("rules");
    expect(viewFromHash("#receipt")).toBe("judge");
    expect(viewFromHash("#sources")).toBe("judge");
  });
});

describe("landingSections", () => {
  it("labels the product story in Lodge voice", () => {
    expect(landingSections.map((section) => section.id)).toEqual([
      "arrive",
      "demo",
      "roles",
      "start",
      "rules",
      "judge",
    ]);
    const corpus = JSON.stringify(landingSections);
    expect(corpus).not.toMatch(/CourseSignal|STAT 210|SOURCES|WATCH/);
  });
});
