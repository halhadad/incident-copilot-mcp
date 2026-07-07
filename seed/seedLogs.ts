import { config } from "../src/config.js";
import { lokiHeaders } from "../src/core/loki.js";
import { randomUUID } from "node:crypto";

interface RawLog {
  service: string;
  level: string;
  tsMs: number;
  msg: string;
  extra?: Record<string, unknown>;
}

const MIN = 60_000;
const now = Date.now();
const ago = (m: number) => now - m * MIN;

const randInt = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1));
const choice = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]!;

const SERVICES = ["api", "checkout", "payments", "inventory"];

function baseline(): RawLog[] {
  const logs: RawLog[] = [];
  for (const service of SERVICES) {
    for (let i = 0; i < 150; i++) {
      const tsMs = ago(Math.random() * 60);
      const isCheckoutOrApi = service === "checkout" || service === "api";
      logs.push({
        service,
        level: Math.random() < 0.05 ? "warn" : "info",
        tsMs,
        msg: "request completed",
        extra: {
          request_id: randomUUID(),
          path: choice(["/cart", "/orders", "/checkout", "/products", "/health"]),
          ...(isCheckoutOrApi ? { latency_ms: randInt(40, 120) } : {}),
        },
      });
    }
  }
  return logs;
}

function slowQuery(): RawLog[] {
  const logs: RawLog[] = [];
  for (let i = 0; i < 300; i++) {
    const tsMs = ago(Math.random() * 30);
    const slow = Math.random() < 0.7;
    logs.push({
      service: "checkout",
      level: slow ? "warn" : "info",
      tsMs,
      msg: slow ? "slow query on orders table" : "request completed",
      extra: {
        request_id: randomUUID(),
        query: "SELECT * FROM orders WHERE user_id = $1",
        latency_ms: slow ? randInt(1200, 4200) : randInt(60, 150),
      },
    });
  }
  return logs;
}

function paymentFailures(): RawLog[] {
  const logs: RawLog[] = [];
  for (let i = 0; i < 220; i++) {
    const tsMs = ago(Math.random() * 30);
    logs.push({
      service: "payments",
      level: "error",
      tsMs,
      msg: "payment provider timeout",
      extra: {
        request_id: randomUUID(),
        provider: choice(["stripe", "paypal", "adyen"]),
        latency_ms: randInt(8000, 15000),
      },
    });
  }
  return logs;
}

function inventoryOversell(): RawLog[] {
  const logs: RawLog[] = [];
  for (let i = 0; i < 60; i++) {
    const tsMs = ago(Math.random() * 40);
    const productId = randInt(1, 3);
    logs.push({
      service: "inventory",
      level: "error",
      tsMs,
      msg: "oversell detected: negative stock for product",
      extra: { request_id: randomUUID(), product_id: productId, quantity: -randInt(1, 5) },
    });
  }
  return logs;
}

function deployRegression(): RawLog[] {
  const logs: RawLog[] = [];
  const deployAt = ago(30);
  logs.push({
    service: "api",
    level: "info",
    tsMs: deployAt,
    msg: "deploy v2.4.1 started",
    extra: { release: "v2.4.1", commit: "a1b2c3d" },
  });
  for (let i = 0; i < 200; i++) {
    const tsMs = ago(Math.random() * 28);
    logs.push({
      service: "api",
      level: Math.random() < 0.6 ? "error" : "info",
      tsMs,
      msg: Math.random() < 0.6 ? "unhandled exception in request handler" : "request completed",
      extra: { request_id: randomUUID(), release: "v2.4.1", latency_ms: randInt(50, 200) },
    });
  }
  return logs;
}

async function pushToLoki(logs: RawLog[]): Promise<void> {
  const streamsMap = new Map<string, [string, string][]>();
  for (const log of logs) {
    const key = `${log.service}|${log.level}`;
    const values = streamsMap.get(key) ?? [];
    const line = JSON.stringify({
      level: log.level,
      msg: log.msg,
      service: log.service,
      ...log.extra,
    });
    values.push([String(Math.floor(log.tsMs) * 1_000_000), line]);
    streamsMap.set(key, values);
  }

  const streams = [...streamsMap.entries()].map(([key, values]) => {
    const [service, level] = key.split("|");
    values.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return { stream: { service: service!, level: level! }, values };
  });

  const res = await fetch(new URL("/loki/api/v1/push", config.lokiUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...lokiHeaders() },
    body: JSON.stringify({ streams }),
  });
  if (!res.ok) {
    throw new Error(`Loki push failed: ${res.status} ${await res.text()}`);
  }
}

export async function seedLogs(): Promise<void> {
  const logs = [
    ...baseline(),
    ...slowQuery(),
    ...paymentFailures(),
    ...inventoryOversell(),
    ...deployRegression(),
  ];
  console.error(`[seed] pushing ${logs.length} log lines to Loki...`);
  await pushToLoki(logs);
  console.error("[seed] logs pushed.");
}
