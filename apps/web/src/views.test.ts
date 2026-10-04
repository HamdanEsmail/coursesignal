import { describe, expect, it } from "vitest";
import { cubbies, viewFromHash } from "./views.js";

describe("viewFromHash", () => {
  it("defaults to Arrive", () => {
    expect(viewFromHash("")).toBe("arrive");
    expect(viewFromHash("#")).toBe("arrive");
    expect(viewFromHash("#unknown")).toBe("arrive");
  });

  it("maps the Lodge cubbies", () => {
    expect(viewFromHash("#arrive")).toBe("arrive");
    expect(viewFromHash("#run")).toBe("run");
    expect(viewFromHash("#demo")).toBe("demo");
    expect(viewFromHash("#text")).toBe("text");
    expect(viewFromHash("#desk")).toBe("desk");
    expect(viewFromHash("#roles")).toBe("roles");
    expect(viewFromHash("#rules")).toBe("rules");
    expect(viewFromHash("#judge")).toBe("judge");
  });

  it("folds old field-guide hashes into cubbies", () => {
    expect(viewFromHash("#start")).toBe("arrive");
    expect(viewFromHash("#today")).toBe("arrive");
    expect(viewFromHash("#connect")).toBe("arrive");
    expect(viewFromHash("#example")).toBe("run");
    expect(viewFromHash("#commands")).toBe("text");
    expect(viewFromHash("#memory")).toBe("desk");
    expect(viewFromHash("#watches")).toBe("desk");
    expect(viewFromHash("#privacy")).toBe("rules");
    expect(viewFromHash("#receipt")).toBe("judge");
    expect(viewFromHash("#sources")).toBe("judge");
  });
});

describe("cubbies", () => {
  it("labels the pigeon-hole wall in Lodge voice", () => {
    expect(cubbies.map((cubby) => cubby.label)).toEqual([
      "Arrive",
      "A run",
      "#demo",
      "What to text",
      "The desk",
      "Roles",
      "House rules",
      "#judge",
    ]);
    const corpus = JSON.stringify(cubbies);
    expect(corpus).not.toMatch(/CourseSignal|STAT 210|SOURCES|WATCH/);
  });
});
