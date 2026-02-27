import type { CrankStatus } from "../types/contracts";
import type { RoundStateV1, WsEvent } from "../types/ws";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const coerced = Number(value);
  return Number.isFinite(coerced) ? coerced : fallback;
}

function asNullableNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const coerced = Number(value);
  return Number.isFinite(coerced) ? coerced : null;
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  return fallback;
}

function parseRoundState(value: unknown): RoundStateV1 | null {
  const obj = asRecord(value);
  if (!obj) return null;
  if (asString(obj.type) !== "round_state_v1") return null;

  const status = asString(obj.status, "Unknown");
  const normalizedStatus =
    status === "Active" ||
    status === "InProgress" ||
    status === "Settled" ||
    status === "Unknown"
      ? status
      : "Unknown";

  const winner = obj.winner;
  const normalizedWinner =
    winner === "Alpha" || winner === "Beta" || winner === "Draw" || winner === null
      ? winner
      : null;

  const alphaBoard = Array.isArray(obj.alphaBoard)
    ? obj.alphaBoard.map((v) => asNumber(v))
    : [];
  const betaBoard = Array.isArray(obj.betaBoard)
    ? obj.betaBoard.map((v) => asNumber(v))
    : [];

  return {
    type: "round_state_v1",
    ts: asNumber(obj.ts),
    roundId: asString(obj.roundId),
    status: normalizedStatus,
    moveCount: asNumber(obj.moveCount),
    winner: normalizedWinner,
    alphaScore: asNumber(obj.alphaScore),
    betaScore: asNumber(obj.betaScore),
    alphaAlive: asBoolean(obj.alphaAlive),
    betaAlive: asBoolean(obj.betaAlive),
    alphaBoard,
    betaBoard,
  };
}

export function parseCrankStatus(value: unknown): CrankStatus {
  const obj = asRecord(value);
  const orchestrator = asRecord(obj?.orchestrator);
  const ws = asRecord(obj?.ws);

  return {
    orchestrator: {
      currentRoundId:
        orchestrator?.currentRoundId == null
          ? null
          : asString(orchestrator.currentRoundId),
      phase: asString(orchestrator?.phase, "UNKNOWN"),
      bettingDeadlineMs: asNullableNumber(orchestrator?.bettingDeadlineMs),
      roundCreatedAtMs: asNullableNumber(orchestrator?.roundCreatedAtMs),
    },
    ws: {
      clients: asNumber(ws?.clients),
      topics: asNumber(ws?.topics),
      subscriptions: asNumber(ws?.subscriptions),
    },
  };
}

export function parseWsEvent(json: string): WsEvent {
  const raw = JSON.parse(json) as unknown;
  const obj = asRecord(raw);
  const type = asString(obj?.type);

  if (type === "round_state_v1") {
    const round = parseRoundState(obj);
    if (!round) throw new Error("Invalid round_state_v1 payload");
    return round;
  }

  if (type === "snapshot_v1") {
    const round = parseRoundState(obj?.roundState);
    if (!round) throw new Error("Invalid snapshot_v1 payload");
    return {
      type: "snapshot_v1",
      ts: asNumber(obj?.ts),
      topic: asString(obj?.topic),
      roundState: round,
    };
  }

  if (type === "round_transition_v1") {
    return {
      type: "round_transition_v1",
      ts: asNumber(obj?.ts),
      roundId: asString(obj?.roundId),
      from: asString(obj?.from),
      to: asString(obj?.to),
    };
  }

  if (type === "subscribed_v1") {
    return {
      type: "subscribed_v1",
      ts: asNumber(obj?.ts),
      topic: asString(obj?.topic),
    };
  }

  if (type === "error_v1") {
    return {
      type: "error_v1",
      ts: asNumber(obj?.ts),
      code: asString(obj?.code),
      message: asString(obj?.message),
    };
  }

  throw new Error(`Unsupported WS event type: ${type || "unknown"}`);
}
