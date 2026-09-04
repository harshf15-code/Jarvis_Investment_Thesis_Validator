import { describe, expect, it } from "vitest";

import {
  ownedOnly,
  parsePortfolioParam,
  resolveScope,
  resolveWriteTarget,
} from "@/lib/portfolio/scope";
import { fakePortfolio } from "@/lib/testing/supabase-mock";
import type { Portfolio } from "@/lib/types";

const PF1 = "11111111-1111-4111-8111-111111111111";
const PF2 = "22222222-2222-4222-8222-222222222222";

const owned = fakePortfolio({ id: PF1 }) as Portfolio;
const managed = fakePortfolio({
  id: PF2,
  name: "Mom",
  ownership: "managed",
  beneficiary_name: "Mom",
  is_default: false,
}) as Portfolio;

describe("parsePortfolioParam", () => {
  it("reads a uuid as one book", () => {
    expect(parsePortfolioParam(PF1)).toEqual({ mode: "one", id: PF1 });
  });

  it("reads the literal 'all' as the roll-up", () => {
    expect(parsePortfolioParam("all")).toEqual({ mode: "all" });
  });

  it("tolerates surrounding whitespace", () => {
    expect(parsePortfolioParam(`  ${PF1} `)).toEqual({ mode: "one", id: PF1 });
    expect(parsePortfolioParam(" all ")).toEqual({ mode: "all" });
  });

  it("is case-insensitive about the uuid, since Postgres is", () => {
    expect(parsePortfolioParam(PF1.toUpperCase())?.mode).toBe("one");
  });

  it("refuses a missing parameter rather than defaulting", () => {
    // The whole point. A default here shows one person's money under another's
    // name, on the screen nobody re-reads because it looks familiar.
    expect(parsePortfolioParam(null)).toBeNull();
    expect(parsePortfolioParam("")).toBeNull();
  });

  it("refuses anything that is not a uuid or 'all'", () => {
    expect(parsePortfolioParam("pf-1")).toBeNull();
    expect(parsePortfolioParam("ALL")).toBeNull(); // exact literal only
    expect(parsePortfolioParam("1234")).toBeNull();
    expect(parsePortfolioParam(`${PF1}extra`)).toBeNull();
  });
});

describe("resolveScope", () => {
  it("returns every book for the roll-up", () => {
    expect(resolveScope([owned, managed], { mode: "all" })).toHaveLength(2);
  });

  it("returns just the named book", () => {
    expect(resolveScope([owned, managed], { mode: "one", id: PF2 })).toEqual([managed]);
  });

  it("returns null for a book this trader does not own", () => {
    // Which the routes turn into a 404 — the same answer RLS gives for someone
    // else's row, and for the same reason: a different refusal would confirm
    // the id exists.
    expect(resolveScope([owned], { mode: "one", id: PF2 })).toBeNull();
  });
});

describe("resolveWriteTarget", () => {
  it("finds the book a write names", () => {
    expect(resolveWriteTarget([owned, managed], PF2)).toEqual(managed);
  });

  it("returns null rather than falling back to the default", () => {
    expect(resolveWriteTarget([owned], PF2)).toBeNull();
  });
});

describe("ownedOnly", () => {
  it("keeps the trader's own books and drops the managed ones", () => {
    // The headline total sums these. Folding in a book run for someone else
    // would make a net-worth number mean something other than what it says.
    expect(ownedOnly([owned, managed])).toEqual([owned]);
  });

  it("is empty when every book is managed", () => {
    expect(ownedOnly([managed])).toEqual([]);
  });
});
