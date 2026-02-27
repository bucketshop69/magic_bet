import { getAiChoice, getMoveCount, getRoundPhase } from "../chain/methods";
import { RoundStateV1Event, RoundStatusWire, WinnerWire } from "./protocol";

function toRoundStatus(value: string): RoundStatusWire {
  const normalized = value.toLowerCase();
  if (normalized === "active") return "Active";
  if (normalized === "inprogress" || normalized === "in_progress")
    return "InProgress";
  if (normalized === "settled") return "Settled";
  return "Unknown";
}

function toWinner(value: unknown): WinnerWire {
  if (value == null) return null;
  const normalized = getAiChoice(value);
  if (normalized === "alpha") return "Alpha";
  if (normalized === "beta") return "Beta";
  if (normalized === "draw") return "Draw";
  return null;
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  return Number((value as any)?.toString?.() ?? 0);
}

export function serializeRoundState(
  roundId: bigint,
  roundAccount: any
): RoundStateV1Event {
  const alphaBoard = Array.isArray(roundAccount.alphaBoard)
    ? roundAccount.alphaBoard.map(toNumber)
    : [];
  const betaBoard = Array.isArray(roundAccount.betaBoard)
    ? roundAccount.betaBoard.map(toNumber)
    : [];

  return {
    type: "round_state_v1",
    ts: Date.now(),
    roundId: roundId.toString(),
    status: toRoundStatus(getRoundPhase(roundAccount)),
    moveCount: getMoveCount(roundAccount),
    winner: toWinner(roundAccount.winner),
    alphaScore: toNumber(roundAccount.alphaScore),
    betaScore: toNumber(roundAccount.betaScore),
    alphaAlive: Boolean(roundAccount.alphaAlive),
    betaAlive: Boolean(roundAccount.betaAlive),
    alphaBoard,
    betaBoard,
  };
}
