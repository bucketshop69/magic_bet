import { loadEnv } from "./config/env";
import { createLogger } from "./infra/logger";
import { RuntimeStore } from "./state/runtimeStore";
import { createL1Client } from "./chain/l1Client";
import { createErClient } from "./chain/erClient";
import { RoundOrchestrator } from "./core/orchestrator";
import { createHealthServer } from "./api/health";
import { validateStartup } from "./core/startupGuards";
import { RoundWsGateway } from "./ws/server";
import { TapestryClient } from "./tapestry/client";

async function main() {
  const env = loadEnv();
  const log = createLogger(env.LOG_LEVEL);

  const l1 = createL1Client(env.L1_RPC_URL, env.ANCHOR_WALLET);
  const er = createErClient(env.ER_RPC_URL, env.ANCHOR_WALLET, env.ER_WS_URL);

  await validateStartup({ env, log, l1, er });

  const store = new RuntimeStore();
  const gateway = new RoundWsGateway({
    path: env.WS_PATH,
    maxSubscriptionsPerSocket: env.WS_MAX_SUBSCRIPTIONS_PER_SOCKET,
    maxConnectionsPerIpPerMin: env.WS_MAX_CONNECTIONS_PER_IP_PER_MIN,
    log,
  });
  const tapestry = new TapestryClient({
    apiKey: env.TAPESTRY_API_KEY,
    namespace: env.TAPESTRY_NAMESPACE,
    log,
  });
  if (tapestry.isConfigured) {
    log.info({ namespace: env.TAPESTRY_NAMESPACE }, "tapestry social layer enabled");
  } else {
    log.warn("TAPESTRY_API_KEY not set — social layer disabled");
  }

  const orchestrator = new RoundOrchestrator({
    env,
    log,
    store,
    l1,
    er,
    gateway,
    tapestry,
  });

  const healthServer = createHealthServer(
    orchestrator,
    env.PORT,
    log,
    env.CORS_ORIGIN,
    tapestry,
    () => gateway.getStatus()
  );
  gateway.attach(healthServer);

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
