import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("applies defaults when env is empty", () => {
    const c = loadConfig({});
    expect(c.databaseUrl).toContain("postgres://");
    expect(c.lokiUrl).toBe("http://localhost:3100");
    expect(c.statementTimeoutMs).toBe(5000);
    expect(c.defaultRowLimit).toBe(100);
  });

  it("reads overrides from env", () => {
    const c = loadConfig({
      DATABASE_URL: "postgresql://user:pw@db.example.com:5432/prod",
      LOKI_URL: "https://loki.example.com",
      STATEMENT_TIMEOUT_MS: "2500",
    });
    expect(c.databaseUrl).toBe("postgresql://user:pw@db.example.com:5432/prod");
    expect(c.lokiUrl).toBe("https://loki.example.com");
    expect(c.statementTimeoutMs).toBe(2500);
  });

  it("fails fast on a malformed DATABASE_URL", () => {
    expect(() => loadConfig({ DATABASE_URL: "not a url" })).toThrow(/DATABASE_URL/);
  });

  it("fails fast on a wrong-scheme LOKI_URL", () => {
    expect(() => loadConfig({ LOKI_URL: "postgres://oops" })).toThrow(/LOKI_URL/);
  });

  it("fails fast on an out-of-range numeric knob", () => {
    expect(() => loadConfig({ STATEMENT_TIMEOUT_MS: "-5" })).toThrow(/Invalid configuration/);
    expect(() => loadConfig({ STATEMENT_TIMEOUT_MS: "abc" })).toThrow(/Invalid configuration/);
  });
});
