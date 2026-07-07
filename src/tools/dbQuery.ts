import { z } from "zod";
import { guardSelect } from "../core/sqlGuard.js";
import { explainQuery, readOnlyQuery } from "../core/pg.js";
import { redactRows } from "../core/redact.js";
import { budgetRows, decodeCursor } from "../core/budget.js";
import { config } from "../config.js";
import { audit } from "../core/log.js";
import { describe } from "./descriptions.js";
import { errorResult, jsonResult, type ToolDef } from "./types.js";

export const dbQueryTool: ToolDef = {
  name: "db_query",
  description: describe("db_query"),
  inputSchema: {
    sql: z.string().describe("A single read-only SELECT statement."),
    dryRun: z
      .boolean()
      .optional()
      .describe(
        "If true, return the EXPLAIN plan and estimated cost WITHOUT executing the query.",
      ),
    cursor: z
      .string()
      .optional()
      .describe("Opaque pagination cursor from a previous db_query result."),
  },
  handler: async (args) => {
    const sql = String(args.sql ?? "");
    const dryRun = Boolean(args.dryRun);
    const cursor = args.cursor as string | undefined;

    const guard = guardSelect(sql, {
      defaultRowLimit: config.defaultRowLimit,
      maxRowLimit: config.maxRowLimit,
    });
    if (!guard.ok) {
      audit.warn({ event: "sql_guard_denied", sql, reason: guard.reason }, "sql_guard_denied");
      return errorResult(guard.reason);
    }

    if (dryRun) {
      try {
        const plan = await explainQuery(guard.sql);
        return jsonResult({
          dryRun: true,
          executedSql: guard.sql,
          estimatedRows: plan.planRows,
          estimatedCost: plan.totalCost,
          guardrails: {
            injectedLimit: guard.injectedLimit,
            clampedLimit: guard.clampedLimit,
          },
          note: "This is the planner estimate only; no rows were read.",
        });
      } catch (err) {
        return errorResult(
          `EXPLAIN failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    let result;
    try {
      result = await readOnlyQuery(guard.sql);
    } catch (err) {
      return errorResult(
        `Query failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const redacted = redactRows(result.rows);
    const budgeted = budgetRows(redacted, {
      tokenBudget: config.resultTokenBudget,
      offset: decodeCursor(cursor),
    });

    return jsonResult({
      executedSql: guard.sql,
      columns: result.fields.map((f) => f.name),
      rows: budgeted.rows,
      rowCount: budgeted.rows.length,
      totalRows: budgeted.totalRows,
      truncated: budgeted.truncated,
      nextCursor: budgeted.nextCursor,
      guardrails: {
        injectedLimit: guard.injectedLimit,
        clampedLimit: guard.clampedLimit,
        piiRedacted: true,
      },
    });
  },
};
