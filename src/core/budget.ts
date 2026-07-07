// chars/4 heuristic, not a real tokenizer — close enough for budgeting decisions.
export function estimateTokens(value: unknown): number {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return Math.ceil(text.length / 4);
}

export interface BudgetedRows<T> {
  rows: T[];
  totalRows: number;
  truncated: boolean;
  nextCursor: string | null;
  estimatedTokens: number;
}

export interface BudgetOptions {
  tokenBudget: number;
  offset?: number;
}

export function budgetRows<T>(all: T[], opts: BudgetOptions): BudgetedRows<T> {
  const offset = opts.offset ?? 0;
  const window = all.slice(offset);
  const kept: T[] = [];
  let used = 0;

  for (const row of window) {
    const cost = estimateTokens(row);
    if (kept.length > 0 && used + cost > opts.tokenBudget) break;
    kept.push(row);
    used += cost;
  }

  const consumed = offset + kept.length;
  const truncated = consumed < all.length;
  return {
    rows: kept,
    totalRows: all.length,
    truncated,
    nextCursor: truncated ? encodeCursor(consumed) : null,
    estimatedTokens: used,
  };
}

export function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset }), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    const offset = Number(parsed?.o);
    return Number.isFinite(offset) && offset >= 0 ? offset : 0;
  } catch {
    return 0;
  }
}
