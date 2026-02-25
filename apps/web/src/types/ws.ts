export type RoundStateV1 = {
  type: "round_state_v1";
  ts: number;
  roundId: string;
  status: "Active" | "InProgress" | "Settled" | "Unknown";
  moveCount: number;
  winner: "Alpha" | "Beta" | "Draw" | null;
  alphaScore: number;
  betaScore: number;
  alphaAlive: boolean;
  betaAlive: boolean;
  alphaBoard: number[];
  betaBoard: number[];
};

export type RoundTransitionV1 = {
  type: "round_transition_v1";
  ts: number;
  roundId: string;
  from: string;
  to: string;
};

export type SnapshotV1 = {
  type: "snapshot_v1";
  ts: number;
  topic: string;
  roundState: RoundStateV1;
};

export type WsEvent =
  | RoundStateV1
  | RoundTransitionV1
  | SnapshotV1
  | { type: "subscribed_v1"; ts: number; topic: string }
  | { type: "error_v1"; ts: number; code: string; message: string };
