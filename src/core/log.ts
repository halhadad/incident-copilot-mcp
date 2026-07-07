import { pino, destination, stdTimeFunctions } from "pino";

// stdout is the MCP transport channel; logs must go to stderr (fd 2) only.
export const logger = pino(
  {
    name: "incident-copilot-mcp",
    level: process.env.LOG_LEVEL ?? "info",
    timestamp: stdTimeFunctions.isoTime,
    base: undefined,
  },
  destination(2),
);

export const audit = logger.child({ audit: true });
