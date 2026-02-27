import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as anchor from "@coral-xyz/anchor";

function expandHome(filePath: string): string {
  if (!filePath.startsWith("~/")) {
    return filePath;
  }
  return path.join(os.homedir(), filePath.slice(2));
}

export function loadWallet(walletPath: string): anchor.Wallet {
  const resolved = expandHome(walletPath);
  const raw = fs.readFileSync(resolved, "utf8");
  const secret = Uint8Array.from(JSON.parse(raw) as number[]);
  const payer = anchor.web3.Keypair.fromSecretKey(secret);
  return new anchor.Wallet(payer);
}
