import { PublicKey } from "@solana/web3.js";
import { delegateRound, fetchRound } from "../../chain/methods";
import { serializeRoundState } from "../../ws/serializers";

export async function runDelegateRound(ctx: any) {
  const roundId = ctx.store.get().currentRoundId;
  if (roundId == null) throw new Error("delegate_round called with no round");
  const validator = new PublicKey(ctx.env.ER_VALIDATOR);
  const sig = await delegateRound(
    ctx.l1.program,
    ctx.l1.wallet.publicKey,
    roundId,
    validator
  );
  ctx.store.setLastTx(sig);
  ctx.log.info({ roundId: roundId.toString(), sig }, "delegate_round complete");

  const round = await fetchRound(ctx.l1.program, roundId);
  ctx.gateway?.publishRoundState(serializeRoundState(roundId, round));
}
