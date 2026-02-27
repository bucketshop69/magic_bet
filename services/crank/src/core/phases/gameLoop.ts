import {
  executeMove,
  fetchRound,
  getMoveCount,
  hasWinner,
} from "../../chain/methods";
import { serializeRoundState } from "../../ws/serializers";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runGameLoop(ctx: any) {
  const roundId = ctx.store.get().currentRoundId;
  if (roundId == null) throw new Error("game_loop called with no round");

  const startedAt = Date.now();
  while (true) {
    const round = await fetchRound(ctx.er.program, roundId);
    ctx.gateway?.publishRoundState(serializeRoundState(roundId, round));
    if (hasWinner(round)) {
      ctx.log.info(
        { roundId: roundId.toString(), moveCount: getMoveCount(round) },
        "winner set, exiting game loop"
      );
      return;
    }

    if (Date.now() - startedAt > ctx.env.STUCK_ROUND_TIMEOUT_MS) {
      ctx.log.warn(
        { roundId: roundId.toString() },
        "game loop timeout reached, forcing settle path"
      );
      return;
    }

    const sig = await executeMove(
      ctx.er.program,
      ctx.er.wallet.publicKey,
      roundId
    );
    ctx.store.setLastTx(sig);

    const updatedRound = await fetchRound(ctx.er.program, roundId);
    ctx.gateway?.publishRoundState(serializeRoundState(roundId, updatedRound));
    await sleep(ctx.env.MOVE_INTERVAL_MS);
  }
}
