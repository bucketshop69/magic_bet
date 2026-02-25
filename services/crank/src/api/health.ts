import express from "express";

export function createHealthServer(
  orchestrator: { getStatus: () => unknown },
  port: number,
  log: any
) {
  const app = express();

  app.get("/healthz", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.get("/status", (_req, res) => {
    res.status(200).json(orchestrator.getStatus());
  });

  const server = app.listen(port, () => {
    log.info({ port }, "health server listening");
  });

  return server;
}
