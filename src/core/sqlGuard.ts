import sqlParser from "node-sql-parser";

const { Parser } = sqlParser;
const parser = new Parser();
const DIALECT = { database: "postgresql" } as const;

export type GuardResult =
  | { ok: true; sql: string; injectedLimit: boolean; clampedLimit: boolean }
  | { ok: false; reason: string };

type Ast = Record<string, any>;

const FORBIDDEN_NODE_TYPES = new Set([
  "insert",
  "replace",
  "update",
  "delete",
  "create",
  "drop",
  "alter",
  "truncate",
  "rename",
  "call",
  "grant",
  "revoke",
  "lock",
  "unlock",
  "use",
  "set",
  "copy",
  "comment",
  "declare",
  "exec",
  "execute",
  "load_data",
  "merge",
]);

function findForbiddenNode(node: unknown, depth = 0): string | null {
  if (depth > 64 || node === null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findForbiddenNode(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  const obj = node as Ast;
  if (typeof obj.type === "string" && FORBIDDEN_NODE_TYPES.has(obj.type)) {
    return obj.type;
  }
  for (const value of Object.values(obj)) {
    const hit = findForbiddenNode(value, depth + 1);
    if (hit) return hit;
  }
  return null;
}

function hasSelectInto(stmt: Ast): boolean {
  const into = stmt.into;
  if (!into || typeof into !== "object") return false;
  return Object.values(into as Record<string, unknown>).some(
    (v) => v !== null && v !== undefined,
  );
}

function topLimitCount(ast: Ast): number | undefined {
  const limit = ast.limit;
  if (!limit || !Array.isArray(limit.value) || limit.value.length === 0) {
    return undefined;
  }
  // Postgres never uses the MySQL "LIMIT offset, count" form
  const idx = limit.seperator === "," ? 1 : 0;
  const node = limit.value[idx];
  return node && node.type === "number" && typeof node.value === "number"
    ? node.value
    : undefined;
}

export interface GuardOptions {
  defaultRowLimit: number;
  maxRowLimit: number;
}

export function guardSelect(rawSql: string, opts: GuardOptions): GuardResult {
  const trimmed = rawSql.trim().replace(/;\s*$/, "");
  if (trimmed === "") return { ok: false, reason: "Empty query." };

  if (/\bfor\s+(update|share|no\s+key\s+update|key\s+share)\b/i.test(trimmed)) {
    return {
      ok: false,
      reason:
        "Locking clauses (FOR UPDATE / FOR SHARE) are not allowed on a read-only replica.",
    };
  }

  let parsed: Ast | Ast[];
  try {
    parsed = parser.astify(trimmed, DIALECT) as Ast | Ast[];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `Could not parse SQL: ${msg}` };
  }

  let stmt: Ast;
  if (Array.isArray(parsed)) {
    if (parsed.length !== 1) {
      return {
        ok: false,
        reason:
          "Only a single statement is allowed. Multiple statements (`;`-separated) are rejected.",
      };
    }
    stmt = parsed[0]!;
  } else {
    stmt = parsed;
  }

  if (stmt.type !== "select") {
    return {
      ok: false,
      reason: `Only SELECT queries are allowed; received a "${stmt.type}" statement. This server is read-only.`,
    };
  }

  if (hasSelectInto(stmt)) {
    return {
      ok: false,
      reason: "SELECT ... INTO creates a table and is not allowed. This server is read-only.",
    };
  }

  const forbidden = findForbiddenNode(stmt);
  if (forbidden) {
    return {
      ok: false,
      reason: `Query contains a nested "${forbidden}" operation (e.g. inside a CTE). Only pure SELECTs are allowed.`,
    };
  }

  const existing = topLimitCount(stmt);

  if (existing === undefined) {
    return {
      ok: true,
      sql: `${trimmed} LIMIT ${opts.defaultRowLimit}`,
      injectedLimit: true,
      clampedLimit: false,
    };
  }

  if (existing <= opts.maxRowLimit) {
    return { ok: true, sql: trimmed, injectedLimit: false, clampedLimit: false };
  }

  const idx = stmt.limit.seperator === "," ? 1 : 0;
  stmt.limit.value[idx].value = opts.maxRowLimit;
  let rewritten: string;
  try {
    rewritten = parser.sqlify(stmt as Parameters<typeof parser.sqlify>[0], DIALECT);
  } catch {
    return {
      ok: false,
      reason: `LIMIT ${existing} exceeds the maximum of ${opts.maxRowLimit}. Lower the LIMIT and retry.`,
    };
  }
  return { ok: true, sql: rewritten, injectedLimit: false, clampedLimit: true };
}
