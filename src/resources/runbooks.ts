export interface RunbookResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  text: string;
}

export const runbooks: RunbookResource[] = [
  {
    uri: "runbook://latency",
    name: "Runbook: latency spike",
    description: "How to investigate elevated request latency.",
    mimeType: "text/markdown",
    text: [
      "# Runbook: Latency Spike",
      "",
      "1. `logs_summarize` the affected service and look at the latency p95/p99 and the error-rate trend.",
      "2. If latency dominates (not errors), suspect a slow query or missing index.",
      "3. `db_schema` the hot tables and check whether the filtered column is indexed.",
      "4. `db_query` with `dryRun: true` to read the planner cost / row estimate for the suspect query.",
      "5. Confirm the root cause: an absent index on a high-cardinality filter column.",
    ].join("\n"),
  },
  {
    uri: "runbook://payments",
    name: "Runbook: payment failures",
    description: "How to investigate a spike in failed or stuck payments.",
    mimeType: "text/markdown",
    text: [
      "# Runbook: Payment Failures",
      "",
      "1. `logs_summarize` the `checkout` (or `payments`) service and look for a provider-error signature.",
      "2. `logs_query` for the specific error to confirm volume and timing.",
      "3. `db_schema` the `payments` table.",
      "4. `db_query` the distribution of `payments.status` to quantify stuck rows (status='pending').",
      "5. Root cause: payment provider errors leaving payments stuck in 'pending'.",
    ].join("\n"),
  },
  {
    uri: "runbook://inventory",
    name: "Runbook: inventory oversell",
    description: "How to investigate negative inventory / oversell.",
    mimeType: "text/markdown",
    text: [
      "# Runbook: Inventory Oversell",
      "",
      "1. `logs_summarize` the `inventory` service and look for oversell/negative-stock errors.",
      "2. `db_schema` the `inventory` table.",
      "3. `db_query` for rows where `quantity < 0` to confirm the oversell.",
      "4. Root cause: a race condition allowed orders to deplete stock below zero.",
    ].join("\n"),
  },
  {
    uri: "runbook://deploy-regression",
    name: "Runbook: deploy regression",
    description: "How to confirm an error spike began at a deploy.",
    mimeType: "text/markdown",
    text: [
      "# Runbook: Deploy Regression",
      "",
      "1. `logs_summarize` the service and read the error-rate trend buckets.",
      "2. `logs_query` for a `deploy` marker line to find the deploy timestamp.",
      "3. Confirm the error rate jumps immediately AFTER the deploy timestamp.",
      "4. Root cause: a regression introduced by the most recent deploy.",
    ].join("\n"),
  },
];
