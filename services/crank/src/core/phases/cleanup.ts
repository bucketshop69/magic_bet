import {
  closeBet,
  fetchBetsForRound,
  fetchRound,
  getAiChoice,
  sweepVault,
} from "../../chain/methods";

export async function runCleanup(ctx: any) {
  const stateBefore = ctx.store.get();
  const roundId = stateBefore.currentRoundId;
  if (roundId == null) throw new Error("cleanup called with no round");
  if (
    stateBefore.cleanupCompletedRoundId != null &&
    stateBefore.cleanupCompletedRoundId === roundId
  ) {
    ctx.log.info(
      { roundId: roundId.toString() },
      "cleanup already completed for round, skipping"
    );
    return;
  }

  const round = await fetchRound(ctx.l1.program, roundId);
  const winner = getAiChoice(round.winner);
  if (winner === "unknown") {
    throw new Error(
      `winner not finalized on L1 yet for round ${roundId.toString()}`
    );
  }
  const bets = await fetchBetsForRound(ctx.l1.program, roundId);

  let losingClosed = 0;
  let winningClosed = 0;
  let winningPendingClaim = 0;

  for (const betEntry of bets) {
    const bet = betEntry.account;
    const user = bet.user;
    const choice = getAiChoice(bet.choice);
    const claimed = Boolean(bet.claimed);

    const isDraw = winner === "draw";
    const isWinningBet = !isDraw && choice === winner;
    const shouldClose =
      isDraw || !isWinningBet || (isWinningBet && claimed === true);

    if (!shouldClose) {
      winningPendingClaim += 1;
      continue;
    }

    const sig = await closeBet(ctx.l1.program, ctx.l1.wallet.publicKey, roundId, user);
    ctx.store.setLastTx(sig);

    if (isWinningBet) {
      winningClosed += 1;
    } else {
      losingClosed += 1;
    }
  }

  ctx.log.info(
    {
      roundId: roundId.toString(),
      winner,
      totalBets: bets.length,
      losingClosed,
      winningClosed,
      winningPendingClaim,
    },
    "close_bet cleanup complete"
  );

  const sig = await sweepVault(
    ctx.l1.program,
    ctx.l1.wallet.publicKey,
    roundId
  );
  ctx.store.setLastTx(sig);
  ctx.log.info({ roundId: roundId.toString(), sig }, "sweep_vault complete");

  const state = ctx.store.get();
  const bettingWindowMs =
    state.roundCreatedAtMs && state.bettingClosedAtMs
      ? state.bettingClosedAtMs - state.roundCreatedAtMs
      : null;
  const gameDurationMs =
    state.gameStartedAtMs && state.gameEndedAtMs
      ? state.gameEndedAtMs - state.gameStartedAtMs
      : null;
  const settleDurationMs =
    state.gameEndedAtMs && state.settledAtMs
      ? state.settledAtMs - state.gameEndedAtMs
      : null;
  const totalRoundMs =
    state.roundCreatedAtMs && state.settledAtMs
      ? state.settledAtMs - state.roundCreatedAtMs
      : null;

  ctx.log.info(
    {
      roundId: roundId.toString(),
      bettingWindowMs,
      gameDurationMs,
      settleDurationMs,
      totalRoundMs,
    },
    "round timings"
  );

  ctx.store.markCleanupCompleted(roundId);
}
