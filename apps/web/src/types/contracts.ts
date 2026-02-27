export type CrankStatus = {
  orchestrator: {
    currentRoundId: string | null;
    phase: string;
  };
  ws: {
    clients: number;
    topics: number;
    subscriptions: number;
  };
};
