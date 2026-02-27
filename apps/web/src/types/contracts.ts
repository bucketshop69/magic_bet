export type CrankStatus = {
  orchestrator: {
    currentRoundId: string | null;
    phase: string;
    bettingDeadlineMs: number | null;
    roundCreatedAtMs: number | null;
  };
  ws: {
    clients: number;
    topics: number;
    subscriptions: number;
  };
};
