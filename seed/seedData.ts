import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ADMIN_URL =
  process.env.SEED_DATABASE_URL ??
  "postgres://postgres:postgres@localhost:5432/incident";

const NUM_USERS = 500;
const NUM_PRODUCTS = 50;
const NUM_ORDERS = 20_000;

export async function seedData(): Promise<void> {
  const client = new pg.Client({ connectionString: ADMIN_URL });
  await client.connect();
  try {
    console.error("[seed] applying schema + read-only role...");
    const schema = readFileSync(join(__dirname, "schema.sql"), "utf8");
    await client.query(schema);

    console.error(`[seed] inserting ${NUM_USERS} users, ${NUM_PRODUCTS} products...`);
    await client.query(
      `INSERT INTO users (name, email, created_at)
       SELECT 'User ' || g, 'user' || g || '@example.com', now() - (random() * interval '30 days')
       FROM generate_series(1, $1) g`,
      [NUM_USERS],
    );
    await client.query(
      `INSERT INTO products (name, price_cents, created_at)
       SELECT 'Product ' || g, (500 + floor(random() * 10000))::int, now() - (random() * interval '60 days')
       FROM generate_series(1, $1) g`,
      [NUM_PRODUCTS],
    );

    console.error("[seed] seeding inventory...");
    await client.query(
      `INSERT INTO inventory (product_id, quantity, updated_at)
       SELECT id, (floor(random() * 100))::int, now() FROM products`,
    );

    console.error(`[seed] inserting ${NUM_ORDERS} orders (no user_id index)...`);
    await client.query(
      `INSERT INTO orders (user_id, status, total_cents, created_at)
       SELECT 1 + floor(random() * $1)::int,
              (ARRAY['placed','paid','shipped','cancelled'])[1 + floor(random() * 4)::int],
              (500 + floor(random() * 20000))::int,
              now() - (random() * interval '60 min')
       FROM generate_series(1, $2)`,
      [NUM_USERS, NUM_ORDERS],
    );

    console.error("[seed] inserting order_items...");
    await client.query(
      `INSERT INTO order_items (order_id, product_id, qty, unit_price_cents)
       SELECT o.id, 1 + floor(random() * $1)::int, 1 + floor(random() * 3)::int,
              (500 + floor(random() * 5000))::int
       FROM orders o`,
      [NUM_PRODUCTS],
    );

    console.error("[seed] inserting payments (with stuck-pending anomaly)...");
    await client.query(
      `INSERT INTO payments (order_id, provider, status, amount_cents, created_at)
       SELECT o.id,
              (ARRAY['stripe','paypal','adyen'])[1 + floor(random() * 3)::int],
              CASE WHEN o.created_at > now() - interval '30 min' AND random() < 0.5
                   THEN 'pending' ELSE 'captured' END,
              o.total_cents,
              o.created_at
       FROM orders o`,
    );

    console.error("[seed] planting inventory oversell (negative stock)...");
    await client.query(
      `UPDATE inventory SET quantity = -1 * (1 + floor(random() * 5)::int), updated_at = now()
       WHERE product_id IN (SELECT id FROM products ORDER BY id LIMIT 3)`,
    );

    console.error("[seed] ANALYZE...");
    await client.query("ANALYZE");

    const counts = await client.query(
      `SELECT
         (SELECT count(*) FROM orders)   AS orders,
         (SELECT count(*) FROM payments WHERE status = 'pending') AS pending_payments,
         (SELECT count(*) FROM inventory WHERE quantity < 0)      AS negative_inventory`,
    );
    console.error("[seed] DB anomalies planted:", counts.rows[0]);
  } finally {
    await client.end();
  }
}
