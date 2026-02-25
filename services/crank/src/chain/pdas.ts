import { PublicKey } from "@solana/web3.js";

const CONFIG_SEED = "config_v2";
const HOUSE_SEED = "house_v2";
const ROUND_SEED = "round_v2";
const BET_SEED = "bet_v2";
const VAULT_SEED = "vault_v2";

export function configPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(CONFIG_SEED)],
    programId
  )[0];
}

export function housePda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(HOUSE_SEED)],
    programId
  )[0];
}

export function roundPda(programId: PublicKey, roundId: bigint): PublicKey {
  const le = Buffer.alloc(8);
  le.writeBigUInt64LE(roundId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from(ROUND_SEED), le],
    programId
  )[0];
}

export function vaultPda(programId: PublicKey, roundId: bigint): PublicKey {
  const le = Buffer.alloc(8);
  le.writeBigUInt64LE(roundId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from(VAULT_SEED), le],
    programId
  )[0];
}

export function betPda(
  programId: PublicKey,
  roundId: bigint,
  user: PublicKey
): PublicKey {
  const le = Buffer.alloc(8);
  le.writeBigUInt64LE(roundId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from(BET_SEED), le, user.toBuffer()],
    programId
  )[0];
}
