import express from "express";

export function createHealthServer(
  orchestrator: { getStatus: () => unknown },
  port: number,
  log: any,
  corsOrigin: string,
  extraStatus?: () => unknown
) {
  const app = express();

  const toJsonSafe = (value: unknown) =>
    JSON.parse(
      JSON.stringify(value, (_key, v) =>
        typeof v === "bigint" ? v.toString() : v
      )
    );

  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", corsOrigin);
    res.header("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get("/healthz", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.get("/status", (_req, res) => {
    res.status(200).json(
      toJsonSafe({
        orchestrator: orchestrator.getStatus(),
        ws: extraStatus ? extraStatus() : null,
      })
    );
  });

  const server = app.listen(port, () => {
    log.info({ port }, "health server listening");
  });

  return server;
}
