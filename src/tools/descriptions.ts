export type ToolVariant = "v1" | "v2";

export const TOOL_VARIANT: ToolVariant =
  process.env.TOOL_VARIANT === "v1" ? "v1" : "v2";

type Descriptions = Record<string, { v1: string; v2: string }>;

const DESCRIPTIONS: Descriptions = {
  catalog: {
    v1: "List available services, database tables, and the data time range.",
    v2: [
      "Orientation tool — CALL THIS FIRST when starting any investigation.",
      "Returns the available log services, the database tables (with approximate",
      "row counts), and the time window the data covers. Use it to ground every",
      "later query in real service names, real table names, and a valid time",
      "range instead of guessing.",
    ].join(" "),
  },
  db_schema: {
    v1: "Get the schema for database tables.",
    v2: [
      "Return the compact schema for one or more tables: columns with types,",
      "primary keys, FOREIGN KEYS, and indexes. Call this BEFORE writing any",
      "db_query that joins tables — the foreign keys tell you how tables relate,",
      "and the indexes tell you which columns are cheap to filter on. Pass the",
      "specific tables you care about to keep the result small.",
    ].join(" "),
  },
  db_query: {
    v1: "Run a SQL query against the database.",
    v2: [
      "Run a READ-ONLY SELECT against the operational database to confirm a",
      "hypothesis from the logs (e.g. count stuck rows, find negative inventory,",
      "check a status distribution). Only SELECT is allowed; a LIMIT is added",
      "automatically. Set dryRun=true to get the EXPLAIN plan and estimated cost",
      "WITHOUT executing — do this first for any query you expect to be heavy.",
      "Large results are paginated: pass the returned nextCursor to fetch more.",
    ].join(" "),
  },
  logs_query: {
    v1: "Query application logs with LogQL.",
    v2: [
      "Query application logs using LogQL over a service and time range. Returns",
      "a BUDGETED view — total match count, value facets, and a sample of",
      "representative lines — not a raw dump, so it is safe to call broadly.",
      "Use it to find error spikes, specific request IDs, or messages around an",
      "incident, then pivot to db_query to confirm the impact in the database.",
    ].join(" "),
  },
  logs_summarize: {
    v1: "Summarize logs for a service over a time window.",
    v2: [
      "Summarize a service's logs over a time window WITHOUT reading individual",
      "lines: error-rate trend, the top clustered error AND warning signatures",
      "(similar messages grouped into templates), and latency percentiles. Call",
      "this FIRST when triaging 'what's wrong with service X' — it surfaces the",
      "dominant failure pattern in a few hundred tokens. IMPORTANT: elevated",
      "latency with zero errors does not mean there is no explanation — check",
      "topWarnSignatures before assuming the cause lies in another service.",
      "Drill in with logs_query.",
    ].join(" "),
  },
};

export function describe(tool: keyof typeof DESCRIPTIONS): string {
  return DESCRIPTIONS[tool]![TOOL_VARIANT];
}
