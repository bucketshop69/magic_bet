import { BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { betPda, configPda, roundPda, vaultPda, housePda } from "./pdas";

const enumKey = (value: unknown): string | null => {
  if (!value || typeof value !== "object") return null;
  const keys = Object.keys(value as Record<string, unknown>);
  return keys.length > 0 ? keys[0] : null;
};

export async function fetchConfig(program: any) {
  const pda = configPda(program.programId);
  return program.account.config.fetch(pda);
}

export async function fetchRound(program: any, roundId: bigint) {
  const pda = roundPda(program.programId, roundId);
  return program.account.round.fetch(pda);
}

export async function fetchBetsForRound(program: any, roundId: bigint) {
  const bets = await program.account.bet.all();
  return bets.filter(
    (entry: any) => BigInt(entry.account.roundId.toString()) === roundId
  );
}

export async function createRound(
  program: any,
  signer: PublicKey,
  roundId: bigint,
  duration: number
) {
  return program.methods
    .createRound(new BN(roundId.toString()), new BN(duration))
    .accountsPartial({
      signer,
      config: configPda(program.programId),
      round: roundPda(program.programId, roundId),
      vault: vaultPda(program.programId, roundId),
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

export async function closeBetting(
  program: any,
  signer: PublicKey,
  roundId: bigint
) {
  return program.methods
    .closeBetting(new BN(roundId.toString()))
    .accountsPartial({
      signer,
      config: configPda(program.programId),
      round: roundPda(program.programId, roundId),
    })
    .rpc();
}

export async function delegateRound(
  program: any,
  signer: PublicKey,
  roundId: bigint,
  validator: PublicKey
) {
  return program.methods
    .delegateRound(new BN(roundId.toString()))
    .accountsPartial({
      signer,
      config: configPda(program.programId),
      round: roundPda(program.programId, roundId),
      roundPda: roundPda(program.programId, roundId),
    })
    .remainingAccounts([
      { pubkey: validator, isSigner: false, isWritable: false },
    ])
    .rpc();
}

export async function executeMove(
  program: any,
  signer: PublicKey,
  roundId: bigint
) {
  return program.methods
    .executeMove(new BN(roundId.toString()))
    .accountsPartial({
      signer,
      config: configPda(program.programId),
      round: roundPda(program.programId, roundId),
    })
    .rpc();
}

export async function settleAndUndelegate(
  program: any,
  payer: PublicKey,
  roundId: bigint
) {
  return program.methods
    .settleAndUndelegate(new BN(roundId.toString()))
    .accountsPartial({
      payer,
      config: configPda(program.programId),
      round: roundPda(program.programId, roundId),
    })
    .rpc();
}

export async function sweepVault(
  program: any,
  signer: PublicKey,
  roundId: bigint
) {
  return program.methods
    .sweepVault(new BN(roundId.toString()))
    .accountsPartial({
      signer,
      config: configPda(program.programId),
      round: roundPda(program.programId, roundId),
      house: housePda(program.programId),
      vault: vaultPda(program.programId, roundId),
    })
    .rpc();
}

export async function closeBet(
  program: any,
  signer: PublicKey,
  roundId: bigint,
  user: PublicKey
) {
  return program.methods
    .closeBet(new BN(roundId.toString()), user)
    .accountsPartial({
      signer,
      round: roundPda(program.programId, roundId),
      bet: betPda(program.programId, roundId, user),
      userAccount: user,
    })
    .rpc();
}

export function getRoundPhase(roundAccount: any): string {
  return enumKey(roundAccount.status) ?? "unknown";
}

export function getAiChoice(value: unknown): string {
  return (enumKey(value) ?? "unknown").toLowerCase();
}

export function hasWinner(roundAccount: any): boolean {
  return roundAccount.winner != null;
}

export function getMoveCount(roundAccount: any): number {
  const raw = roundAccount.moveCount;
  if (typeof raw === "number") return raw;
  return Number(raw?.toString?.() ?? 0);
}
