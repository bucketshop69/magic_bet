#!/usr/bin/env node

const WebSocket = require("ws");

function parseArgs(argv) {
  const args = { statusUrl: "http://127.0.0.1:8787/status", wsUrl: "ws://127.0.0.1:8787/ws", roundId: null };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!value) continue;
    if (key === "--status-url") args.statusUrl = value;
    if (key === "--ws-url") args.wsUrl = value;
    if (key === "--round-id") args.roundId = value;
  }
  return args;
}

async function resolveRoundId(statusUrl) {
  const response = await fetch(statusUrl);
  if (!response.ok) {
    throw new Error(`status fetch failed: ${response.status}`);
  }
  const data = await response.json();
  const roundId = data?.orchestrator?.currentRoundId;
  if (!roundId) {
    throw new Error("currentRoundId missing from /status response");
  }
  return String(roundId);
}

function printEvent(event) {
  if (!event || typeof event !== "object") {
    console.log(String(event));
    return;
  }
  if (event.type === "round_state_v1") {
    console.log(
      `[round_state_v1] round=${event.roundId} status=${event.status} move=${event.moveCount} winner=${event.winner ?? "null"} alpha=${event.alphaScore} beta=${event.betaScore}`
    );
    return;
  }
  if (event.type === "round_transition_v1") {
    console.log(
      `[round_transition_v1] round=${event.roundId} ${event.from} -> ${event.to}`
    );
    return;
  }
  if (event.type === "snapshot_v1") {
    const s = event.roundState;
    console.log(
      `[snapshot_v1] topic=${event.topic} round=${s.roundId} status=${s.status} move=${s.moveCount}`
    );
    return;
  }
  console.log(JSON.stringify(event));
}

async function main() {
  const args = parseArgs(process.argv);
  const roundId = args.roundId || (await resolveRoundId(args.statusUrl));
  const topic = `round:${roundId}`;

  console.log(
    `connecting ws=${args.wsUrl} topic=${topic} (status=${args.statusUrl})`
  );

  const ws = new WebSocket(args.wsUrl);

  ws.on("open", () => {
    ws.send(JSON.stringify({ type: "subscribe", topic }));
  });

  ws.on("message", (raw) => {
    try {
      const text = typeof raw === "string" ? raw : raw.toString("utf8");
      const event = JSON.parse(text);
      printEvent(event);
    } catch (err) {
      console.error("parse error:", err.message);
    }
  });

  ws.on("close", () => {
    console.log("socket closed");
    process.exit(0);
  });

  ws.on("error", (err) => {
    console.error("socket error:", err.message);
    process.exit(1);
  });
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
