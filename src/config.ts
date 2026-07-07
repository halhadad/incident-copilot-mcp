import { z } from "zod";

const urlWithScheme = (schemes: string[], label: string) =>
  z
    .string()
    .refine((v) => {
      try {
        const u = new URL(v);
        return schemes.includes(u.protocol.replace(/:$/, ""));
      } catch {
        return false;
      }
    }, `${label} must be a valid URL (${schemes.map((s) => s + "://").join(" or ")})`);

const intWithDefault = (fallback: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(fallback);

const ConfigSchema = z.object({
  databaseUrl: urlWithScheme(["postgres", "postgresql"], "DATABASE_URL"),
  statementTimeoutMs: intWithDefault(5_000, 100, 120_000),
  defaultRowLimit: intWithDefault(100, 1, 10_000),
  maxRowLimit: intWithDefault(1_000, 1, 100_000),
  lokiUrl: urlWithScheme(["http", "https"], "LOKI_URL"),
  resultTokenBudget: intWithDefault(4_000, 200, 100_000),
  dbPoolSize: intWithDefault(4, 1, 50),
  dbIdleTimeoutMs: intWithDefault(30_000, 1_000, 600_000),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse({
    databaseUrl:
      env.DATABASE_URL ?? "postgres://incident_ro:incident_ro@localhost:5432/incident",
    statementTimeoutMs: env.STATEMENT_TIMEOUT_MS,
    defaultRowLimit: env.DEFAULT_ROW_LIMIT,
    maxRowLimit: env.MAX_ROW_LIMIT,
    lokiUrl: env.LOKI_URL ?? "http://localhost:3100",
    resultTokenBudget: env.RESULT_TOKEN_BUDGET,
    dbPoolSize: env.DB_POOL_SIZE,
    dbIdleTimeoutMs: env.DB_IDLE_TIMEOUT_MS,
  });
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  return parsed.data;
}

export const config = loadConfig();
