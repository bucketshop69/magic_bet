import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, type Connection } from "@solana/web3.js";
import idl from "../idl/magic_bet.json";
import { APP_CONFIG } from "./config";

const CONFIG_SEED = "config_v2";
const HOUSE_SEED = "house_v2";
const ROUND_SEED = "round_v2";
const BET_SEED = "bet_v2";
const VAULT_SEED = "vault_v2";
const textEncoder = new TextEncoder();

export type Choice = "alpha" | "beta";
const MIN_BET_SOL = 0.01;
const MAX_BET_SOL = 1;

export function createConnection() {
  return new anchor.web3.Connection(APP_CONFIG.l1RpcUrl, "confirmed");
}

export function createProgram(connection: Connection, wallet: anchor.Wallet) {
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  return new Program(idl as anchor.Idl, provider) as Program<any>;
}

export function createWalletAdapter() {
  if (!window.solana?.isPhantom) {
    throw new Error("Phantom wallet not found");
  }
  return {
    publicKey: window.solana.publicKey!,
    signTransaction: window.solana.signTransaction.bind(window.solana),
    signAllTransactions: window.solana.signAllTransactions.bind(window.solana),
  } as anchor.Wallet;
}

export function configPda(programId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [textEncoder.encode(CONFIG_SEED)],
    programId
  )[0];
}

export function housePda(programId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [textEncoder.encode(HOUSE_SEED)],
    programId
  )[0];
}

function u64Le(value: bigint) {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setBigUint64(0, value, true);
  return bytes;
}

export function roundPda(programId: PublicKey, roundId: bigint) {
  return PublicKey.findProgramAddressSync(
    [textEncoder.encode(ROUND_SEED), u64Le(roundId)],
    programId
  )[0];
}

export function betPda(programId: PublicKey, roundId: bigint, user: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [textEncoder.encode(BET_SEED), u64Le(roundId), user.toBuffer()],
    programId
  )[0];
}

export function vaultPda(programId: PublicKey, roundId: bigint) {
  return PublicKey.findProgramAddressSync(
    [textEncoder.encode(VAULT_SEED), u64Le(roundId)],
    programId
  )[0];
}

export function toChoiceArg(choice: Choice) {
  return choice === "alpha" ? { alpha: {} } : { beta: {} };
}

export function lamportsFromSol(solAmount: string): BN {
  const normalized = solAmount.trim().replace(",", ".");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Invalid amount format");
  }
  if (parsed < MIN_BET_SOL || parsed > MAX_BET_SOL) {
    throw new Error("Amount must be between 0.01 and 1 SOL");
  }
  return new BN(Math.floor(parsed * anchor.web3.LAMPORTS_PER_SOL));
}

export async function placeBet(
  program: Program,
  user: PublicKey,
  roundId: bigint,
  choice: Choice,
  amountLamports: BN
) {
  return (program.methods as any)
    .placeBet(new BN(roundId.toString()), toChoiceArg(choice), amountLamports)
    .accountsPartial({
      user,
      config: configPda(program.programId),
      round: roundPda(program.programId, roundId),
      vault: vaultPda(program.programId, roundId),
      bet: betPda(program.programId, roundId, user),
      house: housePda(program.programId),
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

export async function claimWinnings(
  program: Program,
  user: PublicKey,
  roundId: bigint
) {
  return (program.methods as any)
    .claimWinnings(new BN(roundId.toString()))
    .accountsPartial({
      user,
      config: configPda(program.programId),
      round: roundPda(program.programId, roundId),
      bet: betPda(program.programId, roundId, user),
      house: housePda(program.programId),
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

export async function fetchRound(program: Program, roundId: bigint) {
  return (program.account as any).round.fetchNullable(
    roundPda(program.programId, roundId)
  );
}

export async function fetchBet(program: Program, roundId: bigint, user: PublicKey) {
  return (program.account as any).bet.fetchNullable(
    betPda(program.programId, roundId, user)
  );
}
