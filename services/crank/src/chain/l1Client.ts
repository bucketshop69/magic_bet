import fs from "node:fs";
import path from "node:path";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { loadWallet } from "./wallet";

function loadIdl() {
  const idlPath = path.resolve(
    process.cwd(),
    "../../target/idl/magic_bet.json"
  );
  return JSON.parse(fs.readFileSync(idlPath, "utf8"));
}

export function createL1Client(rpcUrl: string, walletPath: string) {
  const connection = new anchor.web3.Connection(rpcUrl, "confirmed");
  const wallet = loadWallet(walletPath);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  const idl = loadIdl();
  const program = new Program(idl, provider) as Program<any>;

  return { connection, wallet, provider, program };
}
