import { fetchRound, settleAndUndelegate } from "../../chain/methods";
import { serializeRoundState } from "../../ws/serializers";

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
}
