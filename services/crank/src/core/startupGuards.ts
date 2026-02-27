import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

const MIN_WALLET_BALANCE_SOL = 0.01;

async function fetchRpcIdentity(connection: any): Promise<PublicKey> {
  if (typeof connection.getIdentity === "function") {
    const result = await connection.getIdentity("confirmed");
    const value = (result as any).identity ?? result;
    return new PublicKey(value);
  }

  if (typeof connection._rpcRequest === "function") {
    const result = await connection._rpcRequest("getIdentity", []);
    const value = result?.result?.identity;
    if (value) return new PublicKey(value);
  }

  const endpoint = connection.rpcEndpoint;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getIdentity",
      params: [],
    }),
  });
  if (!response.ok) {
    throw new Error(`failed getIdentity RPC call: ${response.status}`);
  }
  const payload = (await response.json()) as any;
  const identity = payload?.result?.identity;
  if (!identity) {
    throw new Error("getIdentity RPC response missing identity");
  }
  return new PublicKey(identity);
}

export async function validateStartup(ctx: any) {
  const { env, log, l1, er } = ctx;

  const configuredProgramId = new PublicKey(env.PROGRAM_ID);
  const configuredValidator = new PublicKey(env.ER_VALIDATOR);

  const idlProgramId = l1.program.programId;
  if (!idlProgramId.equals(configuredProgramId)) {
    throw new Error(
      `PROGRAM_ID mismatch: env=${configuredProgramId.toBase58()} idl=${idlProgramId.toBase58()}`
    );
  }

  if (!er.program.programId.equals(configuredProgramId)) {
    throw new Error(
      `ER client program mismatch: expected=${configuredProgramId.toBase58()} actual=${er.program.programId.toBase58()}`
    );
  }

  const [l1ProgramInfo, erProgramInfo, l1WalletLamports, erWalletLamports] =
    await Promise.all([
      l1.connection.getAccountInfo(configuredProgramId, "confirmed"),
      er.connection.getAccountInfo(configuredProgramId, "confirmed"),
      l1.connection.getBalance(l1.wallet.publicKey, "confirmed"),
      er.connection.getBalance(er.wallet.publicKey, "confirmed"),
    ]);

  if (!l1ProgramInfo?.executable) {
    throw new Error(
      `Program ${configuredProgramId.toBase58()} is not executable on L1 RPC ${env.L1_RPC_URL}`
    );
  }
  if (!erProgramInfo?.executable) {
    throw new Error(
      `Program ${configuredProgramId.toBase58()} is not executable on ER RPC ${env.ER_RPC_URL}`
    );
  }

  const minLamports = Math.floor(MIN_WALLET_BALANCE_SOL * LAMPORTS_PER_SOL);
  if (l1WalletLamports < minLamports) {
    throw new Error(
      `Wallet ${l1.wallet.publicKey.toBase58()} has insufficient L1 balance: ${l1WalletLamports} lamports`
    );
  }
  if (erWalletLamports < minLamports) {
    throw new Error(
      `Wallet ${er.wallet.publicKey.toBase58()} has insufficient ER balance: ${erWalletLamports} lamports`
    );
  }

  const erIdentity = await fetchRpcIdentity(er.connection);
  if (!erIdentity.equals(configuredValidator)) {
    throw new Error(
      `ER validator mismatch: env=${configuredValidator.toBase58()} rpc_identity=${erIdentity.toBase58()}`
    );
  }

  log.info(
    {
      programId: configuredProgramId.toBase58(),
      validator: configuredValidator.toBase58(),
      wallet: l1.wallet.publicKey.toBase58(),
      l1BalanceSol: l1WalletLamports / LAMPORTS_PER_SOL,
      erBalanceSol: erWalletLamports / LAMPORTS_PER_SOL,
    },
    "startup guards passed"
  );
}
