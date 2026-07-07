import { describe, it, expect } from "vitest";
import { guardSelect } from "../src/core/sqlGuard.js";

const opts = { defaultRowLimit: 100, maxRowLimit: 1000 };

describe("guardSelect", () => {
  it("accepts a plain SELECT and injects a default LIMIT", () => {
    const r = guardSelect("SELECT * FROM orders", opts);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.injectedLimit).toBe(true);
      expect(r.sql).toMatch(/LIMIT 100$/);
    }
  });

  it("leaves an in-bounds LIMIT untouched", () => {
    const r = guardSelect("SELECT id FROM orders LIMIT 10", opts);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.injectedLimit).toBe(false);
      expect(r.clampedLimit).toBe(false);
      expect(r.sql).toContain("LIMIT 10");
    }
  });

  it("clamps an over-large LIMIT down to the max", () => {
    const r = guardSelect("SELECT id FROM orders LIMIT 999999", opts);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.clampedLimit).toBe(true);
      expect(r.sql).toMatch(/LIMIT 1000/i);
      expect(r.sql).not.toContain("999999");
    }
  });

  it("rejects INSERT", () => {
    const r = guardSelect("INSERT INTO orders (id) VALUES (1)", opts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/only select/i);
  });

  it("rejects UPDATE", () => {
    const r = guardSelect("UPDATE orders SET status='x'", opts);
    expect(r.ok).toBe(false);
  });

  it("rejects DELETE", () => {
    const r = guardSelect("DELETE FROM orders", opts);
    expect(r.ok).toBe(false);
  });

  it("rejects DROP (DDL)", () => {
    const r = guardSelect("DROP TABLE orders", opts);
    expect(r.ok).toBe(false);
  });

  it("rejects multi-statement injection", () => {
    const r = guardSelect("SELECT 1; DROP TABLE orders", opts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/single statement|multiple/i);
  });

  it("rejects unparseable garbage", () => {
    const r = guardSelect("not even sql ;;;", opts);
    expect(r.ok).toBe(false);
  });

  it("accepts a JOIN across tables", () => {
    const r = guardSelect(
      "SELECT o.id, u.id FROM orders o JOIN users u ON u.id = o.user_id",
      opts,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.sql).toMatch(/LIMIT 100$/);
  });

  it("handles a trailing semicolon", () => {
    const r = guardSelect("SELECT 1;", opts);
    expect(r.ok).toBe(true);
  });

  it("rejects SELECT ... INTO (creates a table)", () => {
    const r = guardSelect("SELECT * INTO backup_orders FROM orders", opts);
    expect(r.ok).toBe(false);
  });

  it("rejects a data-modifying CTE (WITH ... INSERT)", () => {
    const r = guardSelect(
      "WITH x AS (INSERT INTO orders (user_id, status, total_cents) VALUES (1,'x',1) RETURNING *) SELECT * FROM x",
      opts,
    );
    expect(r.ok).toBe(false);
  });

  it("rejects a data-modifying CTE (WITH ... DELETE)", () => {
    const r = guardSelect(
      "WITH gone AS (DELETE FROM orders RETURNING *) SELECT count(*) FROM gone",
      opts,
    );
    expect(r.ok).toBe(false);
  });

  it("rejects SELECT ... FOR UPDATE (locking)", () => {
    const r = guardSelect("SELECT * FROM orders WHERE id = 1 FOR UPDATE", opts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/locking/i);
  });

  it("rejects SELECT ... FOR SHARE (locking)", () => {
    const r = guardSelect("SELECT * FROM orders FOR SHARE", opts);
    expect(r.ok).toBe(false);
  });

  it("still allows a read-only CTE", () => {
    const r = guardSelect(
      "WITH recent AS (SELECT * FROM orders WHERE created_at > now() - interval '1 hour') SELECT status, count(*) FROM recent GROUP BY status",
      opts,
    );
    expect(r.ok).toBe(true);
  });

  it("still allows subqueries and UNION of selects", () => {
    const r = guardSelect(
      "SELECT id FROM orders WHERE user_id IN (SELECT id FROM users) UNION SELECT order_id FROM payments",
      opts,
    );
    expect(r.ok).toBe(true);
  });
});
