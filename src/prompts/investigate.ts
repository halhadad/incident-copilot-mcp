export const INVESTIGATE_PROMPT_NAME = "investigate";

export function buildInvestigatePrompt(symptom: string): string {
  return [
    `A production incident has been reported: "${symptom}".`,
    "",
    "Investigate and find the root cause using the available tools. Follow this method:",
    "1. Call `catalog` first to learn the services, tables, and time window.",
    "2. Use `logs_summarize` to triage the most likely service and find the dominant failure pattern.",
    "3. Drill in with `logs_query` to confirm specifics (timing, volume, request IDs).",
    "4. Form a hypothesis, then CONFIRM it against the database with `db_query`",
    "   (call `db_schema` first so your joins use the real foreign keys; use",
    "   `dryRun: true` for any query you expect to be heavy).",
    "5. Report the root cause in 2-3 sentences, citing the specific log signature",
    "   and the database evidence that supports it.",
  ].join("\n");
}
