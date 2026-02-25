import { loadEnv } from "./config/env";
import { createLogger } from "./infra/logger";
import { RuntimeStore } from "./state/runtimeStore";
import { createL1Client } from "./chain/l1Client";
import { createErClient } from "./chain/erClient";
import { RoundOrchestrator } from "./core/orchestrator";
import { createHealthServer } from "./api/health";
import { validateStartup } from "./core/startupGuards";

async function main() {
  const env = loadEnv();
  const log = createLogger(env.LOG_LEVEL);

  const l1 = createL1Client(env.L1_RPC_URL, env.ANCHOR_WALLET);
  const er = createErClient(env.ER_RPC_URL, env.ANCHOR_WALLET, env.ER_WS_URL);

  await validateStartup({ env, log, l1, er });

  const store = new RuntimeStore();
  const orchestrator = new RoundOrchestrator({ env, log, store, l1, er });

  createHealthServer(orchestrator, env.PORT, log);

  process.on("SIGINT", () => {
    log.info("received SIGINT, stopping orchestrator");
    orchestrator.stop();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    log.info("received SIGTERM, stopping orchestrator");
    orchestrator.stop();
    process.exit(0);
  });

  log.info("starting crank orchestrator");
  await orchestrator.start();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
