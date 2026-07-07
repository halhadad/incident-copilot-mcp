export interface ResolvedWindow {
  startMs: number;
  endMs: number;
}

const DEFAULT_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_FORWARD_MS = 60 * 60 * 1000;

export function resolveWindow(start?: string, end?: string): ResolvedWindow {
  const now = Date.now();
  const endMs = end ? parseIso(end, now + DEFAULT_FORWARD_MS) : now + DEFAULT_FORWARD_MS;
  const startMs = start ? parseIso(start, now - DEFAULT_LOOKBACK_MS) : now - DEFAULT_LOOKBACK_MS;
  return { startMs, endMs };
}

function parseIso(value: string, fallback: number): number {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : fallback;
}
