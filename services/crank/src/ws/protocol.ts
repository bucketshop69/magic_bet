export type RoundStatusWire = "Active" | "InProgress" | "Settled" | "Unknown";
export type WinnerWire = "Alpha" | "Beta" | "Draw" | null;

export type RoundStateV1Event = {
  type: "round_state_v1";
  ts: number;
  roundId: string;
  status: RoundStatusWire;
  moveCount: number;
  winner: WinnerWire;
  alphaScore: number;
  betaScore: number;
  alphaAlive: boolean;
  betaAlive: boolean;
  alphaBoard: number[];
  betaBoard: number[];
};

export type RoundTransitionV1Event = {
  type: "round_transition_v1";
  ts: number;
  roundId: string;
  from: string;
  to: string;
};

export type SnapshotV1Event = {
  type: "snapshot_v1";
  ts: number;
  topic: string;
  roundState: RoundStateV1Event;
};

export type WsServerEvent =
  | RoundStateV1Event
  | RoundTransitionV1Event
  | SnapshotV1Event
  | { type: "subscribed_v1"; ts: number; topic: string }
  | { type: "error_v1"; ts: number; code: string; message: string };

export type WsClientMessage = {
  type: "subscribe";
  topic: string;
};

export function topicForRound(roundId: string): string {
  return `round:${roundId}`;
}
