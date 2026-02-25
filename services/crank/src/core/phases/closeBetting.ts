import { closeBetting } from "../../chain/methods";

export async function runCloseBetting(ctx: any) {
  const roundId = ctx.store.get().currentRoundId;
  if (roundId == null) throw new Error("close_betting called with no round");
  const sig = await closeBetting(
    ctx.l1.program,
    ctx.l1.wallet.publicKey,
    roundId
  );
  ctx.store.setLastTx(sig);
  ctx.log.info({ roundId: roundId.toString(), sig }, "close_betting complete");
}
