export type LifecyclePhase =
  | "BOOTSTRAP"
  | "READY"
  | "CREATE_ROUND"
  | "BETTING_OPEN"
  | "CLOSE_BETTING"
  | "DELEGATE_ROUND"
  | "GAME_LOOP"
  | "SETTLE"
  | "CLEANUP";

export type RuntimeState = {
  phase: LifecyclePhase;
  currentRoundId: bigint | null;
  bettingDeadlineMs: number | null;
  phaseSinceMs: number;
  roundCreatedAtMs: number | null;
  bettingClosedAtMs: number | null;
  gameStartedAtMs: number | null;
  gameEndedAtMs: number | null;
  settledAtMs: number | null;
  cleanupCompletedRoundId: bigint | null;
  retries: number;
  lastTx?: string;
};

export class RuntimeStore {
  private state: RuntimeState = {
    phase: "BOOTSTRAP",
    currentRoundId: null,
    bettingDeadlineMs: null,
    phaseSinceMs: Date.now(),
    roundCreatedAtMs: null,
    bettingClosedAtMs: null,
    gameStartedAtMs: null,
    gameEndedAtMs: null,
    settledAtMs: null,
    cleanupCompletedRoundId: null,
    retries: 0,
  };

  get(): RuntimeState {
    return { ...this.state };
  }

  setPhase(phase: LifecyclePhase) {
    this.state.phase = phase;
    this.state.phaseSinceMs = Date.now();
    this.state.retries = 0;
  }

  setRound(roundId: bigint) {
    this.state.currentRoundId = roundId;
  }

  markRoundCreated(timestampMs = Date.now()) {
    this.state.roundCreatedAtMs = timestampMs;
    this.state.bettingClosedAtMs = null;
    this.state.gameStartedAtMs = null;
    this.state.gameEndedAtMs = null;
    this.state.settledAtMs = null;
  }

  markBettingClosed(timestampMs = Date.now()) {
    this.state.bettingClosedAtMs = timestampMs;
  }

  markGameStarted(timestampMs = Date.now()) {
    this.state.gameStartedAtMs = timestampMs;
  }

  markGameEnded(timestampMs = Date.now()) {
    this.state.gameEndedAtMs = timestampMs;
  }

  markSettled(timestampMs = Date.now()) {
    this.state.settledAtMs = timestampMs;
  }

  resetRoundMarkers() {
    this.state.roundCreatedAtMs = null;
    this.state.bettingClosedAtMs = null;
    this.state.gameStartedAtMs = null;
    this.state.gameEndedAtMs = null;
    this.state.settledAtMs = null;
  }

  markCleanupCompleted(roundId: bigint) {
    this.state.cleanupCompletedRoundId = roundId;
  }

  setBettingDeadline(deadlineMs: number | null) {
    this.state.bettingDeadlineMs = deadlineMs;
  }

  setLastTx(signature?: string) {
    this.state.lastTx = signature;
  }

  bumpRetry() {
    this.state.retries += 1;
  }
}
