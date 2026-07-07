import { seedData } from "./seedData.js";
import { seedLogs } from "./seedLogs.js";

async function main() {
  await seedData();
  await seedLogs();
  console.error("[seed] done. Try the demo prompt: \"Checkout latency spiked, investigate\".");
}

main().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
