import { describe, expect, it } from "vitest";
import { viewFromHash } from "./views.js";

describe("viewFromHash", () => {
  it("defaults to start", () => {
    expect(viewFromHash("")).toBe("start");
    expect(viewFromHash("#")).toBe("start");
    expect(viewFromHash("#unknown")).toBe("start");
  });

  it("maps the field-guide routes", () => {
    expect(viewFromHash("#example")).toBe("example");
    expect(viewFromHash("#commands")).toBe("commands");
    expect(viewFromHash("#receipt")).toBe("receipt");
    expect(viewFromHash("#memory")).toBe("memory");
    expect(viewFromHash("#privacy")).toBe("privacy");
  });

  it("folds old dashboard hashes into the guide", () => {
    expect(viewFromHash("#today")).toBe("start");
    expect(viewFromHash("#connect")).toBe("start");
    expect(viewFromHash("#watches")).toBe("memory");
  });
});
