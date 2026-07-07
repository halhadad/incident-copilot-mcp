import { z } from "zod";
import { readOnlyQuery } from "../core/pg.js";
import { labelValues } from "../core/loki.js";
import { describe } from "./descriptions.js";
import { jsonResult, type ToolDef } from "./types.js";

async function listTables(): Promise<{ table: string; approxRows: number }[]> {
  const res = await readOnlyQuery(
    `SELECT c.relname AS table, c.reltuples::bigint AS approx_rows
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY c.relname`,
  );
  return res.rows.map((r) => ({
    table: String(r.table),
    approxRows: Number(r.approx_rows ?? 0),
  }));
}

async function dataWindow(): Promise<{ from: string; to: string } | null> {
  try {
    const tablesRes = await readOnlyQuery(
      `SELECT table_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'created_at'`,
    );
    const tables = tablesRes.rows.map((r) => String(r.table_name));
    if (tables.length === 0) return null;

    // identifiers from information_schema, not user input — quoted defensively
    const union = tables
      .map((t) => `SELECT min(created_at) AS lo, max(created_at) AS hi FROM "${t.replace(/"/g, '""')}"`)
      .join(" UNION ALL ");
    const res = await readOnlyQuery(
      `SELECT min(lo) AS from_ts, max(hi) AS to_ts FROM (${union}) w`,
    );
    const row = res.rows[0];
    if (!row || !row.from_ts) return null;
    return { from: String(row.from_ts), to: String(row.to_ts) };
  } catch {
    return null;
  }
}

async function listServices(): Promise<string[]> {
  try {
    return await labelValues("service");
  } catch {
    return [];
  }
}

export const catalogTool: ToolDef = {
  name: "catalog",
  description: describe("catalog"),
  inputSchema: {},
  handler: async () => {
    const [tables, services, window] = await Promise.all([
      listTables(),
      listServices(),
      dataWindow(),
    ]);
    return jsonResult({
      logServices: services,
      databaseTables: tables,
      dataWindow: window,
      hint:
        "Use logs_summarize to triage a service, db_schema before joining tables, " +
        "and db_query (dryRun first for heavy queries) to confirm impact.",
    });
  },
};

export const catalogInput = z.object({});
