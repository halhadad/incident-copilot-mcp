export const INVESTIGATE_PROMPT_NAME = "investigate";

export function buildInvestigatePrompt(symptom: string): string {
  return [
    `A production incident has been reported: "${symptom}".`,
    "",
    "Investigate and find the root cause using the available tools. Follow this method:",
    "1. Call `catalog` first to learn the services, tables, and time window.",
    "2. Use `logs_summarize` to triage the most likely service and find the dominant",
    "   failure pattern, checking topWarnSignatures as well as topErrorSignatures;",
    "   elevated latency with zero errors usually still has a warn-level explanation.",
    "3. Drill in with `logs_query` to confirm specifics (timing, volume, request IDs).",
    "4. Read the matching `runbook://` resource (latency, payments, inventory, or",
    "   deploy-regression) if one matches the symptom; it lists the exact evidence",
    "   expected for that failure mode.",
    "5. Form a hypothesis, then CONFIRM it against the database with `db_query`",
    "   (call `db_schema` first so your joins use the real foreign keys; use",
    "   `dryRun: true` for any query you expect to be heavy).",
    "6. If more than one service shows an anomaly, verify each independently;",
    "   do not assume one root cause explains all of them without direct evidence.",
    "7. Report the root cause in 2-3 sentences, citing the specific log signature",
    "   and the database evidence that supports it.",
  ].join("\n");
}
