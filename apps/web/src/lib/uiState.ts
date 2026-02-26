import type { RoundStateV1 } from "../types/ws";

export type UiRoundState =
  | "Idle"
  | "BettingOpen"
  | "InProgress"
  | "Settled"
  | "Claimable"
  | "Claimed";

export type UiRoundView = {
  state: UiRoundState;
  statusLabel: string;
  canPlaceBet: boolean;
  canClaim: boolean;
  bannerTone: "neutral" | "active" | "success";
};

type Params = {
  roundState: RoundStateV1 | null;
  walletConnected: boolean;
  currentRoundClaimable: boolean;
  currentRoundHasUserBet: boolean;
};

export function deriveUiRoundView(params: Params): UiRoundView {
  const { roundState, walletConnected, currentRoundClaimable, currentRoundHasUserBet } =
    params;

  if (!roundState) {
    return {
      state: "Idle",
      statusLabel: "Waiting for round",
      canPlaceBet: false,
      canClaim: false,
      bannerTone: "neutral",
    };
  }

  if (roundState.status === "Active") {
    return {
      state: "BettingOpen",
      statusLabel: "Betting Open",
      canPlaceBet: true,
      canClaim: false,
      bannerTone: "active",
    };
  }

  if (roundState.status === "InProgress") {
    return {
      state: "InProgress",
      statusLabel: "Game In Progress",
      canPlaceBet: false,
      canClaim: false,
      bannerTone: "active",
    };
  }

  if (roundState.status === "Settled") {
    if (walletConnected && currentRoundClaimable) {
      return {
        state: "Claimable",
        statusLabel: "Claim Available",
        canPlaceBet: false,
        canClaim: true,
        bannerTone: "success",
      };
    }

    if (walletConnected && currentRoundHasUserBet) {
      return {
        state: "Claimed",
        statusLabel: "Round Settled",
        canPlaceBet: false,
        canClaim: false,
        bannerTone: "neutral",
      };
    }

    return {
      state: "Settled",
      statusLabel: "Round Settled",
      canPlaceBet: false,
      canClaim: false,
      bannerTone: "neutral",
    };
  }

  return {
    state: "Idle",
    statusLabel: "Waiting for round",
    canPlaceBet: false,
    canClaim: false,
    bannerTone: "neutral",
  };
}
