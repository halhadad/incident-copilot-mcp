import { config } from "../config.js";

export function lokiHeaders(): Record<string, string> {
  const basic = process.env.LOKI_BASIC_AUTH;
  if (basic) {
    return { Authorization: `Basic ${Buffer.from(basic, "utf8").toString("base64")}` };
  }
  const bearer = process.env.LOKI_BEARER_TOKEN;
  if (bearer) {
    return { Authorization: `Bearer ${bearer}` };
  }
  return {};
}

export interface LokiStreamEntry {
  ts: string;
  line: string;
  labels: Record<string, string>;
}

interface LokiQueryRangeResponse {
  status: string;
  data: {
    resultType: string;
    result: {
      stream: Record<string, string>;
      values: [string, string][];
    }[];
  };
}

function nanoToIso(nano: string): string {
  const ms = Math.floor(Number(nano) / 1_000_000);
  return new Date(ms).toISOString();
}

export interface QueryRangeOptions {
  query: string;
  startMs: number;
  endMs: number;
  limit?: number;
  direction?: "forward" | "backward";
}

export async function queryRange(
  opts: QueryRangeOptions,
): Promise<LokiStreamEntry[]> {
  const url = new URL("/loki/api/v1/query_range", config.lokiUrl);
  url.searchParams.set("query", opts.query);
  url.searchParams.set("start", String(opts.startMs * 1_000_000));
  url.searchParams.set("end", String(opts.endMs * 1_000_000));
  url.searchParams.set("limit", String(opts.limit ?? 1000));
  url.searchParams.set("direction", opts.direction ?? "backward");

  const res = await fetch(url, { method: "GET", headers: lokiHeaders() });
  if (!res.ok) {
    throw new Error(`Loki query_range failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as LokiQueryRangeResponse;
  const entries: LokiStreamEntry[] = [];
  for (const stream of body.data.result) {
    for (const [nano, line] of stream.values) {
      entries.push({ ts: nanoToIso(nano), line, labels: stream.stream });
    }
  }
  entries.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
  return entries;
}

export async function labelValues(label: string): Promise<string[]> {
  const url = new URL(
    `/loki/api/v1/label/${encodeURIComponent(label)}/values`,
    config.lokiUrl,
  );
  const res = await fetch(url, { method: "GET", headers: lokiHeaders() });
  if (!res.ok) {
    throw new Error(`Loki label values failed: ${res.status}`);
  }
  const body = (await res.json()) as { data?: string[] };
  return body.data ?? [];
}
