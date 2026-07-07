import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { scenarios, type Scenario } from "./scenarios.js";
import { judge } from "./judge.js";
import {
  renderReport,
  type ScenarioResult,
  type VariantReport,
  type SafetyResult,
} from "./report.js";
import { buildInvestigatePrompt } from "../src/prompts/investigate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = join(__dirname, "..", "dist", "server.js");

const AGENT_MODEL = process.env.AGENT_MODEL ?? "claude-opus-4-8";
const MAX_STEPS = 12;

const anthropic = new Anthropic();

function childEnv(variant: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") env[k] = v;
  }
  env.TOOL_VARIANT = variant;
  return env;
}

async function connect(variant: string): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_ENTRY],
    env: childEnv(variant),
  });
  const client = new Client({ name: "incident-copilot-evals", version: "0.1.0" });
  await client.connect(transport);
  return client;
}

async function anthropicTools(client: Client): Promise<Anthropic.Tool[]> {
  const { tools } = await client.listTools();
  return tools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
  }));
}

function toolResultText(result: unknown): string {
  const content = ((result as { content?: unknown }).content ?? []) as {
    type: string;
    text?: string;
  }[];
  return content
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n");
}

interface RunOutcome {
  answer: string;
  toolsUsed: string[];
  sqlSeen: string[];
  totalTokens: number;
}

async function runScenario(
  client: Client,
  tools: Anthropic.Tool[],
  scenario: Scenario,
): Promise<RunOutcome> {
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: buildInvestigatePrompt(scenario.symptom) },
  ];
  const toolsUsed: string[] = [];
  const sqlSeen: string[] = [];
  let totalTokens = 0;

  for (let step = 0; step < MAX_STEPS; step++) {
    // cast: installed SDK types lag adaptive thinking
    const resp = await anthropic.messages.create({
      model: AGENT_MODEL,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      system:
        "You are a senior SRE investigating a production incident. Use the tools to find the root cause, then give a concise final answer (2-3 sentences) naming the root cause and the evidence. Do not ask clarifying questions.",
      tools,
      messages,
    } as unknown as Anthropic.Messages.MessageCreateParamsNonStreaming);
    totalTokens += resp.usage.input_tokens + resp.usage.output_tokens;
    messages.push({ role: "assistant", content: resp.content });

    if (resp.stop_reason !== "tool_use") {
      const answer = resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      return { answer, toolsUsed, sqlSeen, totalTokens };
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of resp.content) {
      if (block.type !== "tool_use") continue;
      toolsUsed.push(block.name);
      const input = (block.input ?? {}) as Record<string, unknown>;
      if (block.name === "db_query" && typeof input.sql === "string") {
        sqlSeen.push(input.sql);
      }
      let text: string;
      let isError: boolean;
      try {
        const result = await client.callTool({ name: block.name, arguments: input });
        text = toolResultText(result);
        isError = Boolean((result as { isError?: boolean }).isError);
      } catch (err) {
        text = `Tool call failed: ${err instanceof Error ? err.message : String(err)}`;
        isError = true;
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: text,
        is_error: isError,
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  return {
    answer: "(no final answer — step limit reached)",
    toolsUsed,
    sqlSeen,
    totalTokens,
  };
}

function scoreTools(used: string[], expected: string[]): number {
  if (expected.length === 0) return 1;
  const hit = expected.filter((t) => used.includes(t)).length;
  return hit / expected.length;
}

function scoreTables(sqlSeen: string[], expected: string[]): number {
  if (expected.length === 0) return 1;
  const blob = sqlSeen.join(" ").toLowerCase();
  const hit = expected.filter((t) => new RegExp(`\\b${t}\\b`).test(blob)).length;
  return hit / expected.length;
}

async function runVariant(variant: string): Promise<VariantReport> {
  console.error(`\n=== Running variant ${variant} ===`);
  const client = await connect(variant);
  try {
    const tools = await anthropicTools(client);
    const results: ScenarioResult[] = [];
    for (const scenario of scenarios) {
      console.error(`  - scenario: ${scenario.id}`);
      const outcome = await runScenario(client, tools, scenario);
      const verdict = await judge(
        scenario.symptom,
        scenario.rubric,
        scenario.expectedRootCause,
        outcome.answer,
      );
      results.push({
        scenarioId: scenario.id,
        toolsUsed: [...new Set(outcome.toolsUsed)],
        toolCorrectness: scoreTools(outcome.toolsUsed, scenario.expectedTools),
        tableCorrectness: scoreTables(outcome.sqlSeen, scenario.expectedTables),
        rootCauseCorrect: verdict.correct,
        totalTokens: outcome.totalTokens,
        judgeReasoning: verdict.reasoning,
      });
    }
    return { variant, results };
  } finally {
    await client.close();
  }
}

async function runSafetyProbes(): Promise<SafetyResult[]> {
  console.error("\n=== Safety probes ===");
  const client = await connect("v2");
  const probes: { check: string; sql: string }[] = [
    { check: "DELETE is blocked", sql: "DELETE FROM orders" },
    { check: "DROP TABLE is blocked", sql: "DROP TABLE orders" },
    { check: "Multi-statement injection is blocked", sql: "SELECT 1; DROP TABLE orders" },
    { check: "UPDATE is blocked", sql: "UPDATE payments SET status='captured'" },
  ];
  const out: SafetyResult[] = [];
  try {
    for (const p of probes) {
      const result = await client.callTool({ name: "db_query", arguments: { sql: p.sql } });
      const blocked = Boolean((result as { isError?: boolean }).isError);
      out.push({ check: p.check, blocked, detail: toolResultText(result).slice(0, 120) });
    }
  } finally {
    await client.close();
  }
  return out;
}

async function main() {
  const requested = process.argv.slice(2);
  const variants = requested.length > 0 ? requested : ["v1", "v2"];

  const reports: VariantReport[] = [];
  for (const v of variants) {
    reports.push(await runVariant(v));
  }
  const safety = await runSafetyProbes();

  const report = renderReport(reports, safety);
  const outPath = join(__dirname, "report.md");
  writeFileSync(outPath, report, "utf8");
  console.error(`\nWrote ${outPath}\n`);
  console.log(report);
}

main().catch((err) => {
  console.error("[evals] failed:", err);
  process.exit(1);
});
