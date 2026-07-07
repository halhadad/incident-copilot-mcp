export interface Incident {
  id: string;
  symptom: string;
  service: string;
  expectedRootCause: string;
  expectedTables: string[];
  expectedTools: string[];
  rubric: string;
}

export const incidents: Incident[] = [
  {
    id: "slow_query",
    symptom: "Checkout latency has spiked over the last 30 minutes.",
    service: "checkout",
    expectedRootCause:
      "Queries filtering orders by user_id are doing sequential scans because orders.user_id has no index, causing high latency.",
    expectedTables: ["orders"],
    expectedTools: ["logs_summarize", "db_query"],
    rubric: [
      "The answer is correct if it identifies that checkout latency is caused by",
      "slow database queries on the orders table, specifically a missing index on",
      "orders.user_id leading to sequential scans. Bonus if it references the",
      "EXPLAIN cost or the latency percentiles. It is INCORRECT if it blames the",
      "network, the payment provider, or an unrelated table.",
    ].join(" "),
  },
  {
    id: "payment_failures",
    symptom: "Customers report that their payments are not completing.",
    service: "payments",
    expectedRootCause:
      "The payment provider is timing out, leaving a large number of payments stuck in the 'pending' status.",
    expectedTables: ["payments"],
    expectedTools: ["logs_summarize", "db_query"],
    rubric: [
      "The answer is correct if it identifies payment-provider timeouts/errors",
      "leaving payments stuck in the 'pending' state, and supports this with the",
      "count of pending rows in the payments table. It is INCORRECT if it blames",
      "the database being down, the orders table, or inventory.",
    ].join(" "),
  },
  {
    id: "inventory_oversell",
    symptom: "Support says some products sold more units than we had in stock.",
    service: "inventory",
    expectedRootCause:
      "A race condition allowed orders to deplete stock below zero, producing negative inventory quantities (oversell).",
    expectedTables: ["inventory"],
    expectedTools: ["logs_summarize", "db_query"],
    rubric: [
      "The answer is correct if it identifies an oversell / negative inventory",
      "condition (inventory.quantity < 0) caused by a race condition, supported by",
      "the count of negative-quantity rows. It is INCORRECT if it blames pricing,",
      "payments, or latency.",
    ].join(" "),
  },
  {
    id: "deploy_regression",
    symptom: "Error rate on the API jumped suddenly this afternoon.",
    service: "api",
    expectedRootCause:
      "The error-rate spike begins immediately after the most recent deploy marker, indicating a regression introduced by that deploy.",
    expectedTables: [],
    expectedTools: ["logs_summarize", "logs_query"],
    rubric: [
      "The answer is correct if it identifies that the error-rate spike started",
      "right after a deploy (found via a deploy marker in the logs) and attributes",
      "the regression to that deploy. It is INCORRECT if it blames a specific",
      "database table or an unrelated service without connecting it to the deploy.",
    ].join(" "),
  },
];

export function incidentById(id: string): Incident | undefined {
  return incidents.find((i) => i.id === id);
}
