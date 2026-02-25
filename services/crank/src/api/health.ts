import express from "express";

export function createHealthServer(
  orchestrator: { getStatus: () => unknown },
  port: number,
  log: any,
  extraStatus?: () => unknown
) {
  const app = express();

  const toJsonSafe = (value: unknown) =>
    JSON.parse(
      JSON.stringify(value, (_key, v) =>
        typeof v === "bigint" ? v.toString() : v
      )
    );

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
