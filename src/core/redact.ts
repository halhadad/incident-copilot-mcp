const SENSITIVE_COLUMN = /(password|passwd|secret|token|api[_-]?key|ssn|social|credit[_-]?card|card[_-]?number|cvv|auth)/i;
const EMAIL_COLUMN = /(^|_)(email|e[_-]?mail)($|_)/i;

const EMAIL_VALUE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const CARD_VALUE = /\b(?:\d[ -]?){13,19}\b/g;
const TOKEN_VALUE = /\b(?:sk|pk|ghp|xox[bpoa])[-_][A-Za-z0-9]{12,}\b/g;

export const MASK = "***REDACTED***";

function maskEmail(_match: string): string {
  return "***@***";
}

function redactString(value: string): string {
  return value
    .replace(EMAIL_VALUE, maskEmail)
    .replace(TOKEN_VALUE, MASK)
    .replace(CARD_VALUE, (m) => (/\d/.test(m) ? "****-****-****-****" : m));
}

export function isSensitiveColumn(name: string): boolean {
  return SENSITIVE_COLUMN.test(name) || EMAIL_COLUMN.test(name);
}

export function redactRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (isSensitiveColumn(key)) {
      out[key] = value === null || value === undefined ? value : MASK;
    } else if (typeof value === "string") {
      out[key] = redactString(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function redactRows(
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  return rows.map(redactRow);
}
