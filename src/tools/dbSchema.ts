import { z } from "zod";
import { readOnlyQuery } from "../core/pg.js";
import { estimateTokens } from "../core/budget.js";
import { config } from "../config.js";
import { describe } from "./descriptions.js";
import { errorResult, jsonResult, type ToolDef } from "./types.js";

interface TableSchema {
  table: string;
  columns: { name: string; type: string; nullable: boolean }[];
  primaryKey: string[];
  foreignKeys: { column: string; references: string }[];
  indexes: string[];
}

async function columnsFor(table: string): Promise<TableSchema["columns"]> {
  const res = await readOnlyQuery(
    `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position`,
    [table],
  );
  return res.rows.map((r) => ({
    name: String(r.column_name),
    type: String(r.data_type),
    nullable: r.is_nullable === "YES",
  }));
}

async function primaryKeyFor(table: string): Promise<string[]> {
  const res = await readOnlyQuery(
    `SELECT a.attname AS col
       FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = ('public.' || $1)::regclass AND i.indisprimary`,
    [table],
  );
  return res.rows.map((r) => String(r.col));
}

async function foreignKeysFor(
  table: string,
): Promise<TableSchema["foreignKeys"]> {
  const res = await readOnlyQuery(
    `SELECT kcu.column_name AS col,
            ccu.table_name  AS ref_table,
            ccu.column_name AS ref_col
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public' AND tc.table_name = $1`,
    [table],
  );
  return res.rows.map((r) => ({
    column: String(r.col),
    references: `${r.ref_table}.${r.ref_col}`,
  }));
}

async function indexesFor(table: string): Promise<string[]> {
  const res = await readOnlyQuery(
    `SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = $1`,
    [table],
  );
  return res.rows.map((r) => String(r.indexdef).replace(/^CREATE (UNIQUE )?INDEX /, ""));
}

async function allPublicTables(): Promise<string[]> {
  const res = await readOnlyQuery(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
  );
  return res.rows.map((r) => String(r.table_name));
}

export const dbSchemaTool: ToolDef = {
  name: "db_schema",
  description: describe("db_schema"),
  inputSchema: {
    tables: z
      .array(z.string())
      .optional()
      .describe(
        "Tables to describe. Omit to list all tables (capped to stay within the token budget).",
      ),
  },
  handler: async (args) => {
    const requested = (args.tables as string[] | undefined) ?? [];
    let tables = requested;
    if (tables.length === 0) {
      tables = await allPublicTables();
    }

    const schemas: TableSchema[] = [];
    let usedTokens = 0;
    let truncated = false;

    for (const table of tables) {
      const [columns, primaryKey, foreignKeys, indexes] = await Promise.all([
        columnsFor(table),
        primaryKeyFor(table),
        foreignKeysFor(table),
        indexesFor(table),
      ]);
      if (columns.length === 0) {
        return errorResult(
          `Table "${table}" not found in schema "public". Call catalog to see available tables.`,
        );
      }
      const schema: TableSchema = { table, columns, primaryKey, foreignKeys, indexes };
      const cost = estimateTokens(schema);
      if (schemas.length > 0 && usedTokens + cost > config.resultTokenBudget) {
        truncated = true;
        break;
      }
      schemas.push(schema);
      usedTokens += cost;
    }

    return jsonResult({
      schemas,
      truncated,
      note: truncated
        ? "Output truncated to fit the token budget; request specific tables to see the rest."
        : undefined,
    });
  },
};
