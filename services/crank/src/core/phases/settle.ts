import { settleAndUndelegate } from "../../chain/methods";

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
}
