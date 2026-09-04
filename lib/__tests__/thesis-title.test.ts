import { describe, expect, it } from "vitest";

import { thesisTitle } from "@/lib/thesis-title";

describe("thesisTitle", () => {
  it("prefers the thesis's own name", () => {
    expect(thesisTitle({ title: "Indian IT bottoming on AI spend", ticker: "INFY" })).toBe(
      "Indian IT bottoming on AI spend",
    );
  });

  it("falls back to the ticker when there is no name", () => {
    expect(thesisTitle({ title: null, ticker: "HAL" })).toBe("HAL");
  });

  it("falls back again when there is neither", () => {
    // Note what this is NOT: "Macro Thesis". That was a category wearing the
    // costume of a name — every macro thesis rendered it, so the one string
    // meant to tell six of them apart was the thing they had in common.
    expect(thesisTitle({ title: null, ticker: null })).toBe("Untitled thesis");
  });

  it("treats a whitespace-only title as no title", () => {
    expect(thesisTitle({ title: "   ", ticker: "TCS" })).toBe("TCS");
    expect(thesisTitle({ title: "  ", ticker: "  " })).toBe("Untitled thesis");
  });

  it("trims a title rather than rendering its padding", () => {
    expect(thesisTitle({ title: "  Defence capex cycle  ", ticker: null })).toBe(
      "Defence capex cycle",
    );
  });
});
