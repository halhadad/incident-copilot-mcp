import { describe, it, expect } from "vitest";
import { normalize, clusterMessages, percentile } from "../src/core/logCluster.js";

describe("logCluster", () => {
  it("normalizes variable parts into placeholders", () => {
    expect(normalize("request 12345 took 678ms")).toBe("request <NUM> took <NUM>");
    expect(normalize("user 550e8400-e29b-41d4-a716-446655440000 failed")).toBe(
      "user <UUID> failed",
    );
    expect(normalize("connect to 10.0.0.5 refused")).toBe("connect to <IP> refused");
  });

  it("clusters similar messages and counts them", () => {
    const msgs = [
      "payment provider timeout after 1200ms",
      "payment provider timeout after 3400ms",
      "payment provider timeout after 900ms",
      "inventory check ok",
    ];
    const templates = clusterMessages(msgs);
    expect(templates[0]?.count).toBe(3);
    expect(templates[0]?.template).toContain("payment provider timeout");
    expect(templates.length).toBe(2);
  });

  it("respects topN", () => {
    const msgs = ["a 1", "b 2", "c 3", "d 4"];
    expect(clusterMessages(msgs, 2).length).toBe(2);
  });

  it("computes percentiles", () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(values, 50)).toBeCloseTo(55, 0);
    expect(percentile(values, 99)).toBeGreaterThan(95);
    expect(percentile([], 95)).toBe(0);
  });
});
