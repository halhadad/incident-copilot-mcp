import { describe, it, expect } from "vitest";
import { budgetRows, encodeCursor, decodeCursor } from "../src/core/budget.js";

describe("budgetRows", () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({
    i,
    payload: "x".repeat(100),
  }));

  it("truncates when the token budget is exceeded and returns a cursor", () => {
    const r = budgetRows(rows, { tokenBudget: 200 });
    expect(r.truncated).toBe(true);
    expect(r.rows.length).toBeLessThan(rows.length);
    expect(r.nextCursor).not.toBeNull();
    expect(r.totalRows).toBe(50);
  });

  it("returns all rows and no cursor when within budget", () => {
    const r = budgetRows(rows.slice(0, 2), { tokenBudget: 100_000 });
    expect(r.truncated).toBe(false);
    expect(r.nextCursor).toBeNull();
    expect(r.rows.length).toBe(2);
  });

  it("always makes progress with at least one oversized row", () => {
    const big = [{ blob: "y".repeat(10_000) }];
    const r = budgetRows(big, { tokenBudget: 1 });
    expect(r.rows.length).toBe(1);
  });

  it("resumes from a cursor offset", () => {
    const first = budgetRows(rows, { tokenBudget: 200 });
    const offset = decodeCursor(first.nextCursor ?? undefined);
    const second = budgetRows(rows, { tokenBudget: 200, offset });
    // The second page should start after the first page's rows.
    expect((second.rows[0] as { i: number }).i).toBe(first.rows.length);
  });

  it("round-trips a cursor", () => {
    expect(decodeCursor(encodeCursor(17))).toBe(17);
  });

  it("decodes a bad cursor as offset 0", () => {
    expect(decodeCursor("not-a-cursor")).toBe(0);
    expect(decodeCursor(undefined)).toBe(0);
  });
});
