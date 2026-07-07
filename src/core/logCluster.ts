export interface LogTemplate {
  template: string;
  count: number;
  example: string;
}

const NORMALIZERS: { re: RegExp; token: string }[] = [
  { re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, token: "<UUID>" },
  { re: /\b\d{1,3}(?:\.\d{1,3}){3}\b/g, token: "<IP>" },
  { re: /"[^"]*"/g, token: "<STR>" },
  { re: /'[^']*'/g, token: "<STR>" },
  { re: /\b0x[0-9a-f]+\b/gi, token: "<HEX>" },
  { re: /\b\d+(?:\.\d+)?(ms|s)?\b/g, token: "<NUM>" },
];

export function normalize(message: string): string {
  let out = message;
  for (const { re, token } of NORMALIZERS) {
    out = out.replace(re, token);
  }
  return out.replace(/\s+/g, " ").trim();
}

export function clusterMessages(
  messages: string[],
  topN = 10,
): LogTemplate[] {
  const groups = new Map<string, { count: number; example: string }>();
  for (const msg of messages) {
    const key = normalize(msg);
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      groups.set(key, { count: 1, example: msg });
    }
  }
  return [...groups.entries()]
    .map(([template, { count, example }]) => ({ template, count, example }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo]!;
  const frac = rank - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}
