import express from "express";
import type { Request, Response } from "express";
import type { TapestryClient } from "../tapestry/client";

export function createHealthServer(
  orchestrator: { getStatus: () => unknown },
  port: number,
  log: any,
  corsOrigin: string,
  tapestry: TapestryClient,
  extraStatus?: () => unknown
) {
  const app = express();
  app.use(express.json({ limit: "256kb" }));

  const toJsonSafe = (value: unknown) =>
    JSON.parse(
      JSON.stringify(value, (_key, v) =>
        typeof v === "bigint" ? v.toString() : v
      )
    );

  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", corsOrigin);
    res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
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

  function rewriteLegacyRequest(
    endpointWithQuery: string,
    method: string,
    body: unknown
  ): {
    endpoint: string;
    method: string;
    body: unknown;
  } {
    const parsed = new URL(endpointWithQuery, "http://local-proxy");
    const searchParams = parsed.searchParams;
    let pathname = parsed.pathname;
    let nextMethod = method.toUpperCase();
    let nextBody = body;

    const pathNoSlash = pathname.replace(/\/+$/, "") || "/";

    if (nextMethod === "POST" && pathNoSlash === "/profiles") {
      pathname = "/profiles/findOrCreate";
    } else if (nextMethod === "POST" && pathNoSlash === "/contents") {
      pathname = "/contents/findOrCreate";
      const maybeLegacy = (nextBody as Record<string, unknown>) ?? {};
      const legacyContent =
        (maybeLegacy.content as Record<string, unknown> | undefined) ?? null;
      if (legacyContent) {
        const legacyProperties = Array.isArray(legacyContent.properties)
          ? legacyContent.properties
          : [];
        const legacyText = legacyContent.text;
        const hasTextProp = legacyProperties.some(
          (p) =>
            typeof p === "object" &&
            p !== null &&
            (p as Record<string, unknown>).key === "text"
        );
        nextBody = {
          id: legacyContent.id,
          profileId: maybeLegacy.profileId ?? legacyContent.profileId,
          relatedContentId: legacyContent.relatedContentId,
          properties:
            typeof legacyText === "string" && !hasTextProp
              ? [...legacyProperties, { key: "text", value: legacyText }]
              : legacyProperties,
          execution: maybeLegacy.execution,
        };
      }
    } else if (pathNoSlash === "/follows") {
      pathname = nextMethod === "DELETE" ? "/followers/remove" : "/followers/add";
      nextMethod = "POST";
    } else if (
      nextMethod === "GET" &&
      /^\/profiles\/[^/]+\/isFollowing$/.test(pathNoSlash)
    ) {
      const parts = pathNoSlash.split("/");
      const startId = parts[2] ?? "";
      const endId = searchParams.get("targetId") ?? "";
      pathname = "/followers/state";
      searchParams.forEach((_value, key) => searchParams.delete(key));
      searchParams.set("startId", startId);
      searchParams.set("endId", endId);
    } else if (nextMethod === "GET" && pathNoSlash === "/feed") {
      const username = searchParams.get("profileId");
      const page = searchParams.get("page");
      const pageSize = searchParams.get("pageSize");
      pathname = "/activity/feed";
      searchParams.forEach((_value, key) => searchParams.delete(key));
      if (username) searchParams.set("username", username);
      if (page) searchParams.set("page", page);
      if (pageSize) searchParams.set("pageSize", pageSize);
    }

    const query = searchParams.toString();
    return {
      endpoint: `${pathname}${query ? `?${query}` : ""}`,
      method: nextMethod,
      body: nextBody,
    };
  }

  const proxyToTapestry = async (
    req: Request,
    res: Response,
    prefix: "/social" | "/api/v1"
  ) => {
    if (!tapestry.isConfigured || !tapestry.config.apiKey) {
      res.status(503).json({ error: "tapestry_disabled" });
      return;
    }

    const endpoint = req.originalUrl.slice(prefix.length);
    const rewritten = rewriteLegacyRequest(endpoint, req.method, req.body ?? {});
    const hasJsonBody =
      rewritten.method !== "GET" && rewritten.method !== "HEAD";

    try {
      const upstreamUrl = new URL(
        `https://api.usetapestry.dev/api/v1${rewritten.endpoint}`
      );
      upstreamUrl.searchParams.set("apiKey", tapestry.config.apiKey);

      // @ts-ignore fetch is available in Node > 18
      const upstream = await fetch(upstreamUrl.toString(), {
        method: rewritten.method,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": tapestry.config.apiKey,
        },
        body: hasJsonBody ? JSON.stringify(rewritten.body ?? {}) : undefined,
      });
      if (!upstream.ok) {
        log.warn(
          {
            method: rewritten.method,
            endpoint: rewritten.endpoint,
            status: upstream.status,
          },
          "social proxy upstream non-2xx"
        );
      }

      const raw = await upstream.text();
      const contentType = upstream.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        res.status(upstream.status).type("application/json").send(raw || "{}");
      } else if (raw.length > 0) {
        res.status(upstream.status).send(raw);
      } else {
        res.status(upstream.status).end();
      }
    } catch (err: any) {
      log.error({ err: err?.message, endpoint }, "social proxy request failed");
      res.status(502).json({ error: "social_proxy_failed" });
    }
  };

  app.all("/social/*", (req, res) => proxyToTapestry(req, res, "/social"));
  app.all("/api/v1/*", (req, res) => proxyToTapestry(req, res, "/api/v1"));

  const server = app.listen(port, () => {
    log.info({ port }, "health server listening");
  });

  return server;
}
