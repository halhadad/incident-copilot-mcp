import { describe, it, expect } from "vitest";
import { redactRow, isSensitiveColumn, MASK } from "../src/core/redact.js";

describe("redact", () => {
  it("masks sensitive columns entirely", () => {
    const out = redactRow({ id: 1, password_hash: "abc", api_key: "k" });
    expect(out.id).toBe(1);
    expect(out.password_hash).toBe(MASK);
    expect(out.api_key).toBe(MASK);
  });

  it("masks an email column", () => {
    const out = redactRow({ email: "alice@example.com" });
    expect(out.email).toBe(MASK);
  });

  it("scrubs an embedded email in a non-sensitive column", () => {
    const out = redactRow({ notes: "contact bob@acme.io for refund" });
    expect(out.notes).toBe("contact ***@*** for refund");
  });

  it("scrubs a card-like number", () => {
    const out = redactRow({ memo: "card 4111 1111 1111 1111 charged" });
    expect(out.memo).toContain("****-****-****-****");
  });

  it("scrubs an api-token pattern", () => {
    const out = redactRow({ comment: "token sk-abcdefghijklmnop leaked" });
    expect(out.comment).toContain(MASK);
  });

  it("leaves benign values untouched", () => {
    const out = redactRow({ id: 7, status: "pending", qty: -3 });
    expect(out).toEqual({ id: 7, status: "pending", qty: -3 });
  });

  it("identifies sensitive column names", () => {
    expect(isSensitiveColumn("user_email")).toBe(true);
    expect(isSensitiveColumn("credit_card_number")).toBe(true);
    expect(isSensitiveColumn("status")).toBe(false);
  });

  it("preserves null in a sensitive column", () => {
    const out = redactRow({ secret: null });
    expect(out.secret).toBeNull();
  });
});
