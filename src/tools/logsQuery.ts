import { z } from "zod";
import { queryRange } from "../core/loki.js";
import { resolveWindow } from "../core/time.js";
import { budgetRows, decodeCursor } from "../core/budget.js";
import { config } from "../config.js";
import { describe } from "./descriptions.js";
import { errorResult, jsonResult, type ToolDef } from "./types.js";

function summarizeLine(ts: string, line: string, labels: Record<string, string>) {
  let level = labels.level;
  let msg = line;
  let latencyMs: number | undefined;
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    level = level ?? (parsed.level as string | undefined);
    msg = (parsed.msg as string) ?? (parsed.message as string) ?? line;
    const lat = parsed.latency_ms;
    if (typeof lat === "number") latencyMs = lat;
  } catch {
    /* non-JSON line: keep the raw line as msg */
  }
  return { ts, level, msg, latencyMs };
}

export const logsQueryTool: ToolDef = {
  name: "logs_query",
  description: describe("logs_query"),
  inputSchema: {
    query: z
      .string()
      .describe(
        'A LogQL query, e.g. {service="checkout"} |= "timeout". Always include a {service=...} selector.',
      ),
    start: z.string().optional().describe("ISO start time (defaults to a wide window)."),
    end: z.string().optional().describe("ISO end time (defaults to now)."),
    cursor: z.string().optional().describe("Pagination cursor from a previous result."),
  },
  handler: async (args) => {
    const query = String(args.query ?? "");
    if (query.trim() === "") return errorResult("`query` (LogQL) is required.");

    const { startMs, endMs } = resolveWindow(
      args.start as string | undefined,
      args.end as string | undefined,
    );

    let entries;
    try {
      entries = await queryRange({ query, startMs, endMs, limit: 1000 });
    } catch (err) {
      return errorResult(
        `Loki query failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const levelFacet: Record<string, number> = {};
    const display = entries.map((e) => {
      const s = summarizeLine(e.ts, e.line, e.labels);
      const key = s.level ?? "unknown";
      levelFacet[key] = (levelFacet[key] ?? 0) + 1;
      return s;
    });

    const budgeted = budgetRows(display, {
      tokenBudget: config.resultTokenBudget,
      offset: decodeCursor(args.cursor as string | undefined),
    });

    return jsonResult({
      query,
      window: { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() },
      totalMatches: entries.length,
      levelFacet,
      sampleLines: budgeted.rows,
      truncated: budgeted.truncated,
      nextCursor: budgeted.nextCursor,
    });
  },
};
