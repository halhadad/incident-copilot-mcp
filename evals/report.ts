export interface ScenarioResult {
  scenarioId: string;
  toolsUsed: string[];
  toolCorrectness: number;
  tableCorrectness: number;
  rootCauseCorrect: boolean;
  totalTokens: number;
  judgeReasoning: string;
}

export interface VariantReport {
  variant: string;
  results: ScenarioResult[];
}

export interface SafetyResult {
  check: string;
  blocked: boolean;
  detail: string;
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

export function renderReport(
  reports: VariantReport[],
  safety: SafetyResult[],
): string {
  const lines: string[] = [];
  lines.push("# Eval Scorecard\n");

  lines.push("## Tool-surface A/B (aggregate)\n");
  lines.push("| Variant | Root-cause accuracy | Tool-selection | Table-targeting | Avg tokens |");
  lines.push("|---|---|---|---|---|");
  for (const r of reports) {
    const acc = mean(r.results.map((x) => (x.rootCauseCorrect ? 1 : 0)));
    const tool = mean(r.results.map((x) => x.toolCorrectness));
    const table = mean(r.results.map((x) => x.tableCorrectness));
    const tokens = Math.round(mean(r.results.map((x) => x.totalTokens)));
    lines.push(
      `| ${r.variant} | ${pct(acc)} | ${pct(tool)} | ${pct(table)} | ${tokens.toLocaleString()} |`,
    );
  }
  lines.push("");

  for (const r of reports) {
    lines.push(`## Detail — variant ${r.variant}\n`);
    lines.push("| Scenario | Root cause | Tools | Tables | Tokens | Tools used |");
    lines.push("|---|---|---|---|---|---|");
    for (const x of r.results) {
      lines.push(
        `| ${x.scenarioId} | ${x.rootCauseCorrect ? "✅" : "❌"} | ${pct(x.toolCorrectness)} | ${pct(x.tableCorrectness)} | ${x.totalTokens.toLocaleString()} | ${x.toolsUsed.join(", ") || "—"} |`,
      );
    }
    lines.push("");
  }

  if (safety.length > 0) {
    lines.push("## Safety probes\n");
    lines.push("| Check | Blocked? | Detail |");
    lines.push("|---|---|---|");
    for (const s of safety) {
      lines.push(`| ${s.check} | ${s.blocked ? "✅ blocked" : "❌ ALLOWED"} | ${s.detail} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
