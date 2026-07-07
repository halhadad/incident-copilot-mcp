import pg from "pg";
import { config } from "../config.js";

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: config.dbPoolSize,
  idleTimeoutMillis: config.dbIdleTimeoutMs,
});

export interface QueryResult {
  rows: Record<string, unknown>[];
  fields: { name: string; dataTypeID: number }[];
  rowCount: number;
}

export async function readOnlyQuery(
  sql: string,
  params: unknown[] = [],
): Promise<QueryResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    await client.query(`SET LOCAL statement_timeout = ${config.statementTimeoutMs}`);
    const res = await client.query(sql, params);
    await client.query("COMMIT");
    return {
      rows: res.rows as Record<string, unknown>[],
      fields: res.fields.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
      rowCount: res.rowCount ?? res.rows.length,
    };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

export interface ExplainResult {
  planRows: number;
  totalCost: number;
  planText: string;
}

export async function explainQuery(sql: string): Promise<ExplainResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    await client.query(`SET LOCAL statement_timeout = ${config.statementTimeoutMs}`);
    const res = await client.query(`EXPLAIN (FORMAT JSON) ${sql}`);
    await client.query("COMMIT");
    // QUERY PLAN column is an array with a single { Plan: {...} } object
    const planWrapper = (res.rows[0] as Record<string, unknown>)["QUERY PLAN"] as
      | { Plan: { "Total Cost": number; "Plan Rows": number } }[]
      | undefined;
    const plan = planWrapper?.[0]?.Plan;
    return {
      planRows: plan?.["Plan Rows"] ?? 0,
      totalCost: plan?.["Total Cost"] ?? 0,
      planText: JSON.stringify(planWrapper, null, 2),
    };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
