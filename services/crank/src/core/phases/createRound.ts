import { createRound, fetchConfig, fetchRound } from "../../chain/methods";
import { serializeRoundState } from "../../ws/serializers";

export async function runCreateRound(ctx: any) {
  const config = await fetchConfig(ctx.l1.program);
  const roundId = BigInt(config.roundId.toString());
  const sig = await createRound(
    ctx.l1.program,
    ctx.l1.wallet.publicKey,
    roundId,
    ctx.env.ROUND_DURATION_SECONDS
  );
  ctx.store.setRound(roundId);
  ctx.store.setLastTx(sig);
  ctx.log.info({ roundId: roundId.toString(), sig }, "create_round complete");

  const round = await fetchRound(ctx.l1.program, roundId);
  ctx.gateway?.publishRoundState(serializeRoundState(roundId, round));
}
