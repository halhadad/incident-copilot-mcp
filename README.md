# incident-copilot-mcp

[![CI](https://github.com/YOUR_GITHUB_USERNAME/incident-copilot-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/YOUR_GITHUB_USERNAME/incident-copilot-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A **read-only production-investigation MCP server**. An LLM agent investigating an
incident can query **application logs** (Loki) and correlate against the
**operational database** (Postgres, read-only) to find root cause, safely, and
without blowing up its context window.

> **The demo:** ask an agent _"Checkout latency spiked. Investigate."_ → it
> summarizes the `checkout` logs, spots a slow-query/latency pattern, confirms the
> cause against the database, and reports a cited root cause in one short loop.

The interesting parts are the ones that make an agent safe and cheap to run
against production-shaped data: **tool ergonomics, read-only safety with
defense in depth, context-window budgeting, audit logging, and an eval harness
that checks tool selection isn't just vibes.**

---

## Why DB access *and* logs in one server?

They share one engineering core:

1. **Unified read-only access layer**: dedicated `SELECT`-only DB role,
   read-only transactions, per-statement timeouts, SQL AST validation.
2. **Unified result-budgeting layer**: logs and query results are huge, so the
   server summarizes / samples / clusters / paginates instead of dumping raw
   data into the context window.
3. **A cross-source eval harness**: scenarios that require **both** tools,
   scored on tool selection, root-cause accuracy (LLM-as-judge), token
   efficiency, and safety.

---

## Architecture

```
                Claude (MCP client / agent)
                          │  stdio (MCP)
                          ▼
            ┌──────────────────────────────┐
            │   incident-copilot-mcp        │
            │                               │
   tools ───┤  catalog · db_schema ·        │
            │  db_query · logs_query ·      │
            │  logs_summarize               │
   prompt ──┤  investigate                  │
   resources┤  runbook://latency ...        │
            │                               │
            │  core: sqlGuard · pg · redact │
            │        loki · budget · cluster│
            │        log (pino → stderr)    │
            └───────┬───────────────┬───────┘
        read-only   │               │  read-only
                    ▼               ▼
             Postgres (RO role)   Loki (logs)
```

### Tool surface (5 tools, deliberately small)

Each description tells the agent **when** to call it, not just what it does;
prescriptive descriptions measurably improve tool selection (see the A/B below).

| Tool             | Purpose |
|------------------|---------|
| `catalog`        | Orientation: services, tables (+ row counts), data time window. Call first. |
| `db_schema`      | Compact schema with **foreign keys** + indexes, token-budgeted. |
| `db_query`       | Read-only `SELECT`. Guardrailed; `dryRun: true` returns the EXPLAIN cost. |
| `logs_query`     | LogQL query → **budgeted** view (counts + facets + sampled lines). |
| `logs_summarize` | Error-rate trend + clustered error signatures + latency percentiles. |

Plus MCP **resources** (`runbook://…` playbooks) and an **`investigate`** prompt
template: the full MCP surface, not only tools.

### Security: four independent layers

See [SECURITY.md](SECURITY.md) for the full threat model. Short version: a
write must get through all four layers, and the **DB role is the boundary**:

1. **Role**: `incident_ro` has `GRANT SELECT` only. Enforced by Postgres.
2. **Transaction**: every query runs in `BEGIN TRANSACTION READ ONLY` with a
   `statement_timeout`.
3. **AST guard**: single-statement `SELECT` only; rejects DDL/DML,
   multi-statement injection, data-modifying CTEs (`WITH x AS (INSERT …)`),
   `SELECT INTO`, and locking clauses; injects/clamps `LIMIT`.
4. **Results**: PII redaction + token budgets + pagination cursors.

Every tool call and every guard denial is **audit-logged** as structured JSON
(pino → stderr, `audit: true` marker).

### Context engineering

`logs_summarize` runs drain-style template extraction so "this error occurred
412 times" costs a few tokens instead of 412 lines, and tells you when its
stats are computed over a sample. Every tool result is capped to a token budget
and paginated via an opaque cursor.

---

## Setup: step by step

**Prerequisites:** Node ≥ 20, Docker Desktop (or any Docker engine), plus an
`ANTHROPIC_API_KEY` only if you plan to run the evals.

```bash
# 1. Clone and install
git clone https://github.com/YOUR_GITHUB_USERNAME/incident-copilot-mcp.git
cd incident-copilot-mcp
npm install

# 2. Configure: copy the example env; it's loaded automatically (dotenv)
cp .env.example .env
#    If port 5432 is already in use locally, edit POSTGRES_PORT and the
#    port in DATABASE_URL / SEED_DATABASE_URL in .env to match.

# 3. Start the local stack (Postgres + Loki)
docker compose up -d

# 4. Seed: schema, read-only role, ~20k orders, correlated logs, 4 planted incidents
npm run seed

# 5. Verify
npm run typecheck && npm run lint && npm test   # 41 unit tests
npm run test:integration                        # proves all 4 safety layers live
npm run build                                   # emits dist/server.js

# 6. Register with Claude Code (from this directory)
claude mcp add incident-copilot -- node ./dist/server.js
#    ...or copy the "incident-copilot" block from .mcp.json into
#    Claude Desktop's claude_desktop_config.json (use ABSOLUTE paths there).

# 7. Demo
#    In Claude: "Checkout latency spiked, investigate."
#    Watch it call logs_summarize → db_schema → db_query and cite the missing index.

# 8. (Optional) Run the evals: requires ANTHROPIC_API_KEY
#    Add it to .env, or export ANTHROPIC_API_KEY=sk-ant-... for this shell.
npm run evals        # v1 vs v2 tool surfaces + safety probes → evals/report.md
```

Config lives in environment variables (validated at boot; bad config fails
fast with a readable error), loaded from `.env` via dotenv. See
[.env.example](.env.example) for every knob.

---

## Deployment: genuinely free options

An MCP **stdio** server runs on *your* machine inside the MCP client; the
baseline deployment is **local and costs nothing**. These are the useful free
variations (verified July 2026):

| Option | What's free | Best for |
|---|---|---|
| **1. All-local (default)** | Everything: Docker runs Postgres+Loki, server runs via stdio | Daily use, interviews, demos |
| **2. GitHub Codespaces** | Free monthly quota for personal accounts (~120 core-hours + 15 GB); this repo ships a `.devcontainer/` that boots the full stack automatically | Letting a recruiter run the demo in a browser with **zero install** |
| **3. Free cloud data plane** | [Neon](https://neon.tech) free Postgres (0.5 GB/project, scale-to-zero) + [Grafana Cloud](https://grafana.com/pricing/) free tier (50 GB Loki logs/mo, 14-day retention, no credit card) | An always-on demo dataset you can hit from any machine; the MCP server still runs locally |
| **4. Hosted MCP server** | [Render](https://render.com) free web services (sleep when idle) or Cloudflare Workers free plan | Only needed for *remote* MCP: requires adding an HTTP transport + OAuth first (see SECURITY.md); **not recommended** until you need multi-user access |

**Option 3 walkthrough (free cloud data, ~10 minutes):**

1. Create a free Neon project → copy the connection string → run the seed
   against it: `SEED_DATABASE_URL=<neon-admin-url> npm run seed` (comment out
   the `seedLogs` call or set Loki vars too). Create the `incident_ro` role's
   password properly for a shared DB.
2. Create a free Grafana Cloud stack → Loki details page gives you a URL +
   user ID + API token. Set `LOKI_URL=<push/query base url>` and
   `LOKI_BASIC_AUTH=<userid>:<token>` (already supported by the client).
3. Point the MCP server at both: set `DATABASE_URL` / `LOKI_URL` /
   `LOKI_BASIC_AUTH` in your MCP client's env block. Done, no server hosting.

Notes from the research: **Koyeb** closed its free tier to new signups after
the Mistral acquisition, and **Fly.io** no longer has a true free tier; don't
plan around either.

---

## Eval harness & the v1/v2 A/B

The harness spawns the built server over stdio, drives Claude through each
planted incident with a manual agent loop, grades the final answer with an
LLM judge, and scores:

- **Tool selection**: did it use the tools the scenario requires?
- **Table targeting**: did its SQL hit the right tables?
- **Root-cause accuracy**: judge verdict against a per-incident rubric.
- **Token usage**: total in+out across the loop.

Every scenario runs twice: **v1** (terse tool descriptions) vs **v2**
(prescriptive when-to-call descriptions). One env var (`TOOL_VARIANT`) flips
the surface, isolating tool design as the independent variable.

> Run `npm run evals` and paste the generated `evals/report.md` table here;
> the numbers are produced on your machine (they need the live stack + API key).

The harness also fires **safety probes** independent of the LLM (`DELETE`,
`DROP`, `UPDATE`, `SELECT 1; DROP TABLE orders`) and asserts each is blocked.

---

## Planted incidents

`seed/incidents.ts` is the single source of truth: the seeder plants them and
the evals grade against them, so they can't drift.

| Incident | Log signal | DB evidence | Root cause |
|----------|-----------|-------------|------------|
| `slow_query` | `checkout` latency spike + "slow query on orders" | high EXPLAIN cost on `orders` filter | missing index on `orders.user_id` |
| `payment_failures` | `payments` "provider timeout" spike | many `payments.status = 'pending'` | provider timeouts → stuck payments |
| `inventory_oversell` | `inventory` "negative stock" errors | `inventory.quantity < 0` rows | race condition → oversell |
| `deploy_regression` | `api` deploy marker then error jump | (logs only) | regression from the latest deploy |

---

## Testing

| Suite | Command | What it proves |
|---|---|---|
| Unit (41 tests) | `npm test` | SQL guard incl. bypass shapes (CTE writes, `SELECT INTO`, locking), redaction, budgeting/pagination, log clustering, config validation |
| Integration | `npm run test:integration` | **Each safety layer live**: raw writes fail as `incident_ro`, read-only txn blocks `DELETE`/`SELECT INTO`, `statement_timeout` kills `pg_sleep`; plus end-to-end tool behavior (redaction, EXPLAIN dryRun, cursor pagination, FK-aware schema, planted-incident visibility) |
| CI | `.github/workflows/ci.yml` | Both suites on every push; integration runs against real Postgres + Loki service containers |

---

## Project layout

```
src/
  server.ts            MCP server (stdio): tools + resources + prompt + audit logging
  tools/               catalog, dbSchema, dbQuery, logsQuery, logsSummarize, descriptions (v1/v2)
  core/                sqlGuard, pg, redact, budget, logCluster, loki, time, log (pino)
  resources/runbooks   investigation playbooks (MCP resources)
  prompts/investigate  investigation prompt template
seed/                  schema.sql, seedData, seedLogs, incidents (single source of truth)
evals/                 runner (MCP stdio client + agent loop), judge, report, scenarios
test/                  unit tests + test/integration (live-stack suite)
.github/workflows/     CI: typecheck, lint, unit, build, audit + integration with services
.devcontainer/         one-click Codespaces demo environment
```

---

## Notes & limits

- PII redaction is defensive masking, not a DLP system; see
  [SECURITY.md](SECURITY.md) for the full list of honest limitations.
- Point `DATABASE_URL` at a **read replica** in anything resembling production.
- Re-running `npm run seed` re-pushes logs to Loki (append-only); restart the
  `loki` container for a perfectly clean slate.

MIT licensed. See [LICENSE](LICENSE).
