import { z } from "zod";
import { queryRange } from "../core/loki.js";
import { resolveWindow } from "../core/time.js";
import { clusterMessages, percentile } from "../core/logCluster.js";
import { describe } from "./descriptions.js";
import { errorResult, jsonResult, type ToolDef } from "./types.js";

interface ParsedLog {
  ts: string;
  level: string;
  msg: string;
  latencyMs?: number;
}

function parseLine(ts: string, line: string, labels: Record<string, string>): ParsedLog {
  try {
    const p = JSON.parse(line) as Record<string, unknown>;
    return {
      ts,
      level: (p.level as string) ?? labels.level ?? "unknown",
      msg: (p.msg as string) ?? (p.message as string) ?? line,
      latencyMs: typeof p.latency_ms === "number" ? p.latency_ms : undefined,
    };
  } catch {
    return { ts, level: labels.level ?? "unknown", msg: line };
  }
}

export const logsSummarizeTool: ToolDef = {
  name: "logs_summarize",
  description: describe("logs_summarize"),
  inputSchema: {
    service: z.string().describe("The service name to summarize (see catalog)."),
    start: z.string().optional().describe("ISO start time (defaults to a wide window)."),
    end: z.string().optional().describe("ISO end time (defaults to now)."),
  },
  handler: async (args) => {
    const service = String(args.service ?? "");
    if (service.trim() === "") return errorResult("`service` is required.");
    if (!/^[A-Za-z0-9_\-./]+$/.test(service)) {
      return errorResult(
        "`service` may only contain letters, digits, and _ - . / characters. Call catalog for valid names.",
      );
    }

    const { startMs, endMs } = resolveWindow(
      args.start as string | undefined,
      args.end as string | undefined,
    );

    const SAMPLE_LIMIT = 5000;
    let entries;
    try {
      entries = await queryRange({
        query: `{service="${service}"}`,
        startMs,
        endMs,
        limit: SAMPLE_LIMIT,
      });
    } catch (err) {
      return errorResult(
        `Loki query failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (entries.length === 0) {
      return jsonResult({
        service,
        total: 0,
        note: "No logs for this service in the window. Check the service name via catalog.",
      });
    }

    const parsed = entries.map((e) => parseLine(e.ts, e.line, e.labels));
    const errors = parsed.filter((p) => p.level === "error" || p.level === "fatal");
    const latencies = parsed
      .map((p) => p.latencyMs)
      .filter((v): v is number => typeof v === "number");

    const buckets = bucketErrorRate(parsed, startMs, endMs, 6);
    const sampled = entries.length >= SAMPLE_LIMIT;

    return jsonResult({
      service,
      window: { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() },
      total: parsed.length,
      sampled,
      note: sampled
        ? `Stats are computed over the most recent ${SAMPLE_LIMIT} lines, not the full window. Narrow the time range for exact numbers.`
        : undefined,
      errorCount: errors.length,
      errorRate: Number((errors.length / parsed.length).toFixed(4)),
      errorRateTrend: buckets,
      topErrorSignatures: clusterMessages(errors.map((e) => e.msg), 8),
      latencyMs: latencies.length
        ? {
            p50: Math.round(percentile(latencies, 50)),
            p95: Math.round(percentile(latencies, 95)),
            p99: Math.round(percentile(latencies, 99)),
            max: Math.max(...latencies),
          }
        : null,
    });
  },
};

function bucketErrorRate(
  parsed: ParsedLog[],
  startMs: number,
  endMs: number,
  n: number,
): { window: string; total: number; errors: number }[] {
  const span = Math.max(1, endMs - startMs);
  const size = span / n;
  const buckets = Array.from({ length: n }, (_, i) => ({
    window: new Date(startMs + i * size).toISOString(),
    total: 0,
    errors: 0,
  }));
  for (const p of parsed) {
    const t = Date.parse(p.ts);
    let idx = Math.floor((t - startMs) / size);
    if (idx < 0) idx = 0;
    if (idx >= n) idx = n - 1;
    const b = buckets[idx]!;
    b.total += 1;
    if (p.level === "error" || p.level === "fatal") b.errors += 1;
  }
  return buckets;
}
