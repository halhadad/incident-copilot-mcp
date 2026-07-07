import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { tools } from "./tools/index.js";
import { runbooks } from "./resources/runbooks.js";
import {
  INVESTIGATE_PROMPT_NAME,
  buildInvestigatePrompt,
} from "./prompts/investigate.js";
import { closePool, readOnlyQuery } from "./core/pg.js";
import { labelValues } from "./core/loki.js";
import { logger, audit } from "./core/log.js";
import { config } from "./config.js";
import { TOOL_VARIANT } from "./tools/descriptions.js";

const server = new McpServer({
  name: "incident-copilot-mcp",
  version: "0.1.0",
});

for (const tool of tools) {
  server.registerTool(
    tool.name,
    { description: tool.description, inputSchema: tool.inputSchema },
    async (args: Record<string, unknown>) => {
      const startedAt = Date.now();
      try {
        const result = await tool.handler(args ?? {});
        audit.info(
          {
            tool: tool.name,
            ms: Date.now() - startedAt,
            isError: Boolean(result.isError),
          },
          "tool_call",
        );
        logger.debug({ tool: tool.name, args }, "tool_args");
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        audit.warn(
          { tool: tool.name, ms: Date.now() - startedAt, error: msg },
          "tool_call_threw",
        );
        return {
          content: [{ type: "text", text: `Error: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}

for (const rb of runbooks) {
  server.registerResource(
    rb.name,
    rb.uri,
    { description: rb.description, mimeType: rb.mimeType },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: rb.mimeType, text: rb.text }],
    }),
  );
}

server.registerPrompt(
  INVESTIGATE_PROMPT_NAME,
  {
    description:
      "Kick off a structured root-cause investigation for a reported symptom.",
    argsSchema: { symptom: z.string().describe("The reported incident symptom.") },
  },
  ({ symptom }) => ({
    messages: [
      {
        role: "user",
        content: { type: "text", text: buildInvestigatePrompt(symptom) },
      },
    ],
  }),
);

async function preflight(): Promise<void> {
  try {
    await readOnlyQuery("SELECT 1");
    logger.info({ target: "postgres" }, "preflight_ok");
  } catch (err) {
    logger.warn(
      { target: "postgres", error: err instanceof Error ? err.message : String(err) },
      "preflight_failed — db tools will return errors until Postgres is reachable",
    );
  }
  try {
    await labelValues("service");
    logger.info({ target: "loki" }, "preflight_ok");
  } catch (err) {
    logger.warn(
      { target: "loki", error: err instanceof Error ? err.message : String(err) },
      "preflight_failed — log tools will return errors until Loki is reachable",
    );
  }
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info(
    {
      toolVariant: TOOL_VARIANT,
      lokiUrl: config.lokiUrl,
      statementTimeoutMs: config.statementTimeoutMs,
      resultTokenBudget: config.resultTokenBudget,
    },
    "server_started",
  );
  void preflight();
}

async function shutdown() {
  logger.info("server_shutdown");
  try {
    await closePool();
  } finally {
    process.exit(0);
  }
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((err) => {
  logger.fatal({ error: err instanceof Error ? err.message : String(err) }, "fatal");
  process.exit(1);
});
