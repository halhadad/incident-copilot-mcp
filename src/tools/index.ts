import type { ToolDef } from "./types.js";
import { catalogTool } from "./catalog.js";
import { dbSchemaTool } from "./dbSchema.js";
import { dbQueryTool } from "./dbQuery.js";
import { logsQueryTool } from "./logsQuery.js";
import { logsSummarizeTool } from "./logsSummarize.js";

export const tools: ToolDef[] = [
  catalogTool,
  dbSchemaTool,
  dbQueryTool,
  logsQueryTool,
  logsSummarizeTool,
];
