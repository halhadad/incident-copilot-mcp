import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";

import { seedData } from "../../seed/seedData.js";
import { seedLogs } from "../../seed/seedLogs.js";
import { readOnlyQuery, closePool } from "../../src/core/pg.js";
import { catalogTool } from "../../src/tools/catalog.js";
import { dbSchemaTool } from "../../src/tools/dbSchema.js";
import { dbQueryTool } from "../../src/tools/dbQuery.js";
import { logsSummarizeTool } from "../../src/tools/logsSummarize.js";
import { MASK } from "../../src/core/redact.js";
import type { ToolResult } from "../../src/tools/types.js";

const RO_URL =
  process.env.DATABASE_URL ??
  "postgres://incident_ro:incident_ro@localhost:5432/incident";

function payload(result: ToolResult): Record<string, unknown> {
  expect(result.isError ?? false).toBe(false);
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

beforeAll(async () => {
  await seedData();
  await seedLogs();
  // Loki indexes asynchronously
  await new Promise((r) => setTimeout(r, 2_000));
});

afterAll(async () => {
  await closePool();
});

describe("layer 1: database role", () => {
  it("incident_ro cannot INSERT even with raw SQL outside our code paths", async () => {
    const client = new pg.Client({ connectionString: RO_URL });
    await client.connect();
    try {
      await expect(
        client.query(
          "INSERT INTO orders (user_id, status, total_cents) VALUES (1, 'hacked', 1)",
        ),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await client.end();
    }
  });
});

describe("layer 2: read-only transaction + statement timeout", () => {
  it("blocks DELETE at the transaction level (bypassing the SQL guard)", async () => {
    await expect(readOnlyQuery("DELETE FROM orders WHERE id = 1")).rejects.toThrow(
      /read-only|permission denied/i,
    );
  });

  it("blocks SELECT ... INTO at the transaction level", async () => {
    await expect(
      readOnlyQuery("SELECT * INTO tmp_exfil FROM orders LIMIT 1"),
    ).rejects.toThrow(/read-only|permission denied/i);
  });

  it("kills a runaway query via statement_timeout", async () => {
    await expect(readOnlyQuery("SELECT pg_sleep(10)")).rejects.toThrow(
      /statement timeout/i,
    );
  });
});

describe("db_query tool (end-to-end)", () => {
  it("rejects a write with a readable error (guard layer)", async () => {
    const result = await dbQueryTool.handler({ sql: "DELETE FROM orders" });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/only select/i);
  });

  it("runs a SELECT and redacts PII", async () => {
    const p = payload(
      await dbQueryTool.handler({ sql: "SELECT id, name, email FROM users LIMIT 5" }),
    );
    const rows = p.rows as Record<string, unknown>[];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.email).toBe(MASK);
    }
    expect((p.guardrails as Record<string, unknown>).piiRedacted).toBe(true);
  });

  it("dryRun returns an EXPLAIN estimate without executing", async () => {
    const p = payload(
      await dbQueryTool.handler({
        sql: "SELECT * FROM orders WHERE user_id = 42",
        dryRun: true,
      }),
    );
    expect(p.dryRun).toBe(true);
    expect(Number(p.estimatedCost)).toBeGreaterThan(0);
  });

  it("the missing-index incident is visible: filtering orders.user_id seq-scans 20k rows", async () => {
    const p = payload(
      await dbQueryTool.handler({
        sql: "SELECT * FROM orders WHERE user_id = 42",
        dryRun: true,
      }),
    );
    expect(Number(p.estimatedCost)).toBeGreaterThan(100);
  });

  it("paginates large results with a cursor", async () => {
    const first = payload(
      await dbQueryTool.handler({ sql: "SELECT * FROM orders LIMIT 1000" }),
    );
    expect(first.truncated).toBe(true);
    expect(first.nextCursor).toBeTruthy();

    const second = payload(
      await dbQueryTool.handler({
        sql: "SELECT * FROM orders LIMIT 1000",
        cursor: first.nextCursor as string,
      }),
    );
    const firstIds = (first.rows as { id: number }[]).map((r) => r.id);
    const secondIds = (second.rows as { id: number }[]).map((r) => r.id);
    expect(secondIds[0]).not.toBe(firstIds[0]);
  });
});

describe("catalog + db_schema tools", () => {
  it("catalog lists tables, services, and a data window", async () => {
    const p = payload(await catalogTool.handler({}));
    const tables = (p.databaseTables as { table: string }[]).map((t) => t.table);
    expect(tables).toEqual(
      expect.arrayContaining(["orders", "payments", "inventory", "users"]),
    );
    expect(p.logServices as string[]).toEqual(expect.arrayContaining(["payments"]));
    expect(p.dataWindow).not.toBeNull();
  });

  it("db_schema exposes the foreign keys that enable correct joins", async () => {
    const p = payload(await dbSchemaTool.handler({ tables: ["orders"] }));
    const schema = (p.schemas as Record<string, unknown>[])[0]!;
    const fks = schema.foreignKeys as { column: string; references: string }[];
    expect(fks).toEqual(
      expect.arrayContaining([{ column: "user_id", references: "users.id" }]),
    );
  });
});

describe("logs_summarize tool (end-to-end)", () => {
  it("surfaces the planted payment-provider incident as the top error signature", async () => {
    const p = payload(await logsSummarizeTool.handler({ service: "payments" }));
    expect(Number(p.errorCount)).toBeGreaterThan(0);
    const sigs = p.topErrorSignatures as { template: string; count: number }[];
    expect(sigs[0]!.template).toContain("payment provider timeout");
  });

  it("rejects a LogQL-unsafe service name", async () => {
    const result = await logsSummarizeTool.handler({
      service: 'x"} |= "" or {service="',
    });
    expect(result.isError).toBe(true);
  });

  it("surfaces the planted slow-query warning even with zero errors", async () => {
    const p = payload(await logsSummarizeTool.handler({ service: "checkout" }));
    expect(Number(p.errorCount)).toBe(0);
    const sigs = p.topWarnSignatures as { template: string; count: number }[];
    expect(sigs[0]!.template).toContain("slow query on orders table");
  });
});
