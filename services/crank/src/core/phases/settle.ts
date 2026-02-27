import { fetchRound, settleAndUndelegate, getAiChoice } from "../../chain/methods";
import { serializeRoundState } from "../../ws/serializers";
import { publishRoundResult } from "../../tapestry/content";

export async function runSettle(ctx: any) {
  const roundId = ctx.store.get().currentRoundId;
  if (roundId == null) throw new Error("settle called with no round");
  const sig = await settleAndUndelegate(
    ctx.er.program,
    ctx.er.wallet.publicKey,
    roundId
  );
  ctx.store.setLastTx(sig);
  ctx.log.info(
    { roundId: roundId.toString(), sig },
    "settle_and_undelegate complete"
  );

  const round = await fetchRound(ctx.l1.program, roundId);
  ctx.gateway?.publishRoundState(serializeRoundState(roundId, round));

  // Publish round result to Tapestry social layer (non-blocking)
  const winner = getAiChoice(round.winner);
  publishRoundResult(ctx.tapestry, ctx.l1.wallet.publicKey.toBase58(), {
    roundId: roundId.toString(),
    winner,
  }).catch((err) =>
    ctx.log.error({ err }, "tapestry publishRoundResult failed (non-blocking)")
  );
}

