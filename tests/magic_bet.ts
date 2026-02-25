import * as anchor from "@coral-xyz/anchor";
import { AnchorError, BN, Program, web3 } from "@coral-xyz/anchor";
import { expect } from "chai";
import {
  GetCommitmentSignature,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { MagicBet } from "../target/types/magic_bet";

const DEFAULT_ER_VALIDATOR = "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57";
const LOCAL_VALIDATOR = "mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev";

const CONFIG_SEED = "config_v2";
const HOUSE_SEED = "house_v2";
const ROUND_SEED = "round_v2";
const VAULT_SEED = "vault_v2";
const BET_SEED = "bet_v2";

const MIN_BET = new BN(10_000_000); // 0.01 SOL
const BET_ALPHA = new BN(20_000_000); // 0.02 SOL
const BET_BETA = new BN(30_000_000); // 0.03 SOL
const INITIAL_HOUSE_FUND = new BN(3_000_000_000); // 3 SOL
const HOUSE_MIN_BALANCE = 3_000_000_000;

const enumKey = (value: unknown): string | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const keys = Object.keys(value as Record<string, unknown>);
  return keys.length > 0 ? keys[0] : null;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("magic_bet full integration", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const workspace = anchor.workspace as Record<string, Program<MagicBet>>;
  const program = workspace.magicBet ?? workspace.MagicBet;

  const adminWallet = provider.wallet as anchor.Wallet;

  const erConnection = new web3.Connection(
    process.env.EPHEMERAL_PROVIDER_ENDPOINT || "https://devnet-as.magicblock.app/",
    {
      wsEndpoint:
        process.env.EPHEMERAL_WS_ENDPOINT || "wss://devnet-as.magicblock.app/",
    }
  );
  const erProvider = new anchor.AnchorProvider(erConnection, provider.wallet, {
    commitment: "confirmed",
  });
  const erProgram = new Program<MagicBet>(program.idl as MagicBet, erProvider);

  const isLocalnet =
    provider.connection.rpcEndpoint.includes("localhost") ||
    provider.connection.rpcEndpoint.includes("127.0.0.1");
  const erOnly = isLocalnet ? it.skip : it;
  let erValidator: web3.PublicKey | null = null;

  const [configPda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from(CONFIG_SEED)],
    program.programId
  );
  const [housePda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from(HOUSE_SEED)],
    program.programId
  );

  const roundPda = (roundId: BN) =>
    web3.PublicKey.findProgramAddressSync(
      [Buffer.from(ROUND_SEED), roundId.toArrayLike(Buffer, "le", 8)],
      program.programId
    )[0];

  const vaultPda = (roundId: BN) =>
    web3.PublicKey.findProgramAddressSync(
      [Buffer.from(VAULT_SEED), roundId.toArrayLike(Buffer, "le", 8)],
      program.programId
    )[0];

  const betPda = (roundId: BN, user: web3.PublicKey) =>
    web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from(BET_SEED),
        roundId.toArrayLike(Buffer, "le", 8),
        user.toBuffer(),
      ],
      program.programId
    )[0];

  const parseErrorCode = (error: unknown): number | undefined => {
    const anyErr = error as any;
    const direct =
      anyErr?.error?.errorCode?.number ??
      anyErr?.errorCode?.number ??
      anyErr?.error?.error?.errorCode?.number ??
      anyErr?.transactionError?.errorCode?.number;
    if (typeof direct === "number") {
      return direct;
    }

    const logs =
      anyErr?.logs ??
      anyErr?.transactionLogs ??
      anyErr?.error?.logs ??
      anyErr?.transactionError?.logs;
    if (Array.isArray(logs)) {
      const parsed = AnchorError.parse(logs);
      const fromAnchor = parsed?.error?.errorCode?.number;
      if (typeof fromAnchor === "number") {
        return fromAnchor;
      }
      const logLine = logs.find((line: string) =>
        line.includes("custom program error: 0x")
      );
      if (logLine) {
        const hex = logLine.match(/0x([0-9a-f]+)/i)?.[1];
        if (hex) {
          return parseInt(hex, 16);
        }
      }
      const numberLine = logs.find((line: string) =>
        /Error Number:\s*\d+/i.test(line)
      );
      if (numberLine) {
        const code = numberLine.match(/Error Number:\s*(\d+)/i)?.[1];
        if (code) {
          return Number(code);
        }
      }
    }

    const message =
      anyErr?.transactionMessage ??
      anyErr?.transactionError?.message ??
      anyErr?.message ??
      anyErr?.error?.message ??
      anyErr?.toString?.();
    if (typeof message === "string") {
      const decimal = message.match(/Error Number:\s*(\d+)/i)?.[1];
      if (decimal) {
        return Number(decimal);
      }
      const hex = message.match(/custom program error:\s*0x([0-9a-f]+)/i)?.[1];
      if (hex) {
        return parseInt(hex, 16);
      }
    }

    return undefined;
  };

  const expectCode = async (
    action: () => Promise<unknown>,
    expectedCode: number,
    label: string
  ) => {
    try {
      await action();
      expect.fail(`${label}: expected error code ${expectedCode}`);
    } catch (error) {
      let actual = parseErrorCode(error);
      const maybeGetLogs = (error as any)?.getLogs;
      if (actual === undefined && typeof maybeGetLogs === "function") {
        try {
          const l1Logs = await maybeGetLogs.call(error, provider.connection);
          actual = parseErrorCode({ logs: l1Logs });
        } catch {
          // try ER connection below
        }
        if (actual === undefined) {
          try {
            const erLogs = await maybeGetLogs.call(error, erProvider.connection);
            actual = parseErrorCode({ logs: erLogs });
          } catch {
            // leave undefined and fail assertion with clear label
          }
        }
      }
      expect(actual, `${label}: unexpected error code`).to.equal(expectedCode);
    }
  };

  const ensureWalletBalance = async (pubkey: web3.PublicKey, minLamports: number) => {
    const current = await provider.connection.getBalance(pubkey, "confirmed");
    if (current >= minLamports) {
      return;
    }

    const topUp = minLamports - current;
    const tx = new web3.Transaction().add(
      web3.SystemProgram.transfer({
        fromPubkey: adminWallet.publicKey,
        toPubkey: pubkey,
        lamports: topUp,
      })
    );
    await provider.sendAndConfirm(tx, []);
  };

  const ensureInitialized = async () => {
    const accountInfo = await provider.connection.getAccountInfo(configPda, "confirmed");
    if (!accountInfo) {
      await program.methods
        .initialize(INITIAL_HOUSE_FUND)
        .accountsPartial({
          admin: adminWallet.publicKey,
          config: configPda,
          house: housePda,
          systemProgram: web3.SystemProgram.programId,
        })
        .rpc();
    }

    const config = await program.account.config.fetch(configPda);
    expect(config.admin.equals(adminWallet.publicKey)).to.equal(true);
    return config;
  };

  const ensureAgentDelegation = async () => {
    const config = await program.account.config.fetch(configPda);
    const currentAgent = config.agent as web3.PublicKey | null;
    if (!currentAgent || !currentAgent.equals(adminWallet.publicKey)) {
      await program.methods
        .delegateAdmin(adminWallet.publicKey)
        .accountsPartial({
          config: configPda,
          admin: adminWallet.publicKey,
        })
        .rpc();
    }
  };

  const ensureHouseBalance = async (minLamports: number) => {
    const current = await provider.connection.getBalance(housePda, "confirmed");
    if (current >= minLamports) {
      return;
    }

    const delta = new BN(minLamports - current);
    await program.methods
      .fundHouse(delta)
      .accountsPartial({
        signer: adminWallet.publicKey,
        config: configPda,
        house: housePda,
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc();
  };

  const nextRoundId = async (): Promise<BN> => {
    const config = await program.account.config.fetch(configPda);
    return new BN(config.roundId.toString());
  };

  const resolveErValidator = async (): Promise<web3.PublicKey> => {
    if (erValidator) {
      return erValidator;
    }

    if (isLocalnet) {
      erValidator = new web3.PublicKey(LOCAL_VALIDATOR);
      return erValidator;
    }

    const envValidator = process.env.ER_VALIDATOR?.trim();
    if (envValidator) {
      try {
        erValidator = new web3.PublicKey(envValidator);
        return erValidator;
      } catch {
        // fall through to static default
      }
    }

    erValidator = new web3.PublicKey(DEFAULT_ER_VALIDATOR);
    return erValidator;
  };

  const createRound = async (roundId: BN, durationSeconds: number) => {
    await program.methods
      .createRound(roundId, new BN(durationSeconds))
      .accountsPartial({
        signer: adminWallet.publicKey,
        config: configPda,
        round: roundPda(roundId),
        vault: vaultPda(roundId),
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc();
  };

  const delegateRound = async (roundId: BN) => {
    const validator = await resolveErValidator();
    await program.methods
      .delegateRound(roundId)
      .accountsPartial({
        signer: adminWallet.publicKey,
        config: configPda,
        round: roundPda(roundId),
        roundPda: roundPda(roundId),
      })
      .remainingAccounts([
        {
          pubkey: validator,
          isSigner: false,
          isWritable: false,
        },
      ])
      .rpc();

    // give delegation metadata a moment to propagate before ER calls
    await sleep(1500);
  };

  const placeBetL1 = async (
    roundId: BN,
    user: web3.PublicKey,
    amount: BN,
    choice: { alpha: {} } | { beta: {} } | { draw: {} },
    signer?: web3.Keypair
  ) => {
    const method = program.methods
      .placeBet(roundId, choice, amount)
      .accountsPartial({
        user,
        config: configPda,
        round: roundPda(roundId),
        vault: vaultPda(roundId),
        bet: betPda(roundId, user),
        house: housePda,
        systemProgram: web3.SystemProgram.programId,
      });

    if (signer) {
      return method.signers([signer]).rpc();
    }
    return method.rpc();
  };

  const closeBettingL1 = async (roundId: BN) => {
    await program.methods
      .closeBetting(roundId)
      .accountsPartial({
        signer: adminWallet.publicKey,
        config: configPda,
        round: roundPda(roundId),
      })
      .rpc();
  };

  const executeMovesEr = async (roundId: BN, maxMoves = 100) => {
    for (let i = 0; i < maxMoves; i += 1) {
      await erProgram.methods
        .executeMove(roundId)
        .accountsPartial({
          signer: adminWallet.publicKey,
          config: configPda,
          round: roundPda(roundId),
        })
        .rpc();

      if (i % 5 === 4) {
        const roundState = await erProgram.account.round.fetch(roundPda(roundId));
        if (roundState.winner) {
          return;
        }
      }
    }
  };

  const settleEr = async (roundId: BN) => {
    const signature = await erProgram.methods
      .settleAndUndelegate(roundId)
      .accountsPartial({
        payer: adminWallet.publicKey,
        config: configPda,
        round: roundPda(roundId),
        magicProgram: MAGIC_PROGRAM_ID,
        magicContext: MAGIC_CONTEXT_ID,
      })
      .rpc();

    return signature;
  };

  const waitForSettledL1 = async (roundId: BN, settleSignature?: string) => {
    if (settleSignature) {
      try {
        await GetCommitmentSignature(
          settleSignature,
          new web3.Connection("https://devnet-as.magicblock.app/")
        );
      } catch {
        // fall back to polling below
      }
    }

    for (let i = 0; i < 30; i += 1) {
      const state = await program.account.round.fetch(roundPda(roundId));
      if (enumKey(state.status) === "settled") {
        return state;
      }
      await sleep(1000);
    }

    throw new Error(`Round ${roundId.toString()} did not reach Settled on L1`);
  };

  const claimAs = async (roundId: BN, user: web3.PublicKey, signer?: web3.Keypair) => {
    const method = program.methods
      .claimWinnings(roundId)
      .accountsPartial({
        user,
        config: configPda,
        round: roundPda(roundId),
        bet: betPda(roundId, user),
        house: housePda,
        vault: vaultPda(roundId),
        systemProgram: web3.SystemProgram.programId,
      });

    if (signer) {
      return method.signers([signer]).rpc();
    }
    return method.rpc();
  };

  const closeBetByAgent = async (roundId: BN, user: web3.PublicKey) => {
    await program.methods
      .closeBet(roundId, user)
      .accountsPartial({
        signer: adminWallet.publicKey,
        round: roundPda(roundId),
        bet: betPda(roundId, user),
        userAccount: user,
      })
      .rpc();
  };

  const sweepVaultByAgent = async (roundId: BN) => {
    await program.methods
      .sweepVault(roundId)
      .accountsPartial({
        signer: adminWallet.publicKey,
        config: configPda,
        round: roundPda(roundId),
        house: housePda,
        vault: vaultPda(roundId),
      })
      .rpc();
  };

  before(async function () {
    this.timeout(120000);
    await ensureWalletBalance(adminWallet.publicKey, 1_000_000_000);
    await ensureInitialized();
    await ensureAgentDelegation();
    await ensureHouseBalance(HOUSE_MIN_BALANCE);
  });

  it("loads workspace and exposes final instruction set", () => {
    expect(program).to.not.equal(undefined);

    const normalize = (value: string) => value.replace(/_/g, "").toLowerCase();
    const instructionNames = program.idl.instructions.map((ix) => normalize(ix.name));
    expect(instructionNames).to.include.members([
      normalize("initialize"),
      normalize("delegateAdmin"),
      normalize("createRound"),
      normalize("delegateRound"),
      normalize("placeBet"),
      normalize("closeBetting"),
      normalize("executeMove"),
      normalize("settleAndUndelegate"),
      normalize("claimWinnings"),
      normalize("closeBet"),
      normalize("fundHouse"),
      normalize("sweepVault"),
    ]);
  });

  it("rejects delegate_admin from a non-admin signer", async function () {
    this.timeout(60000);

    const attacker = web3.Keypair.generate();
    await expectCode(
      () =>
        program.methods
          .delegateAdmin(attacker.publicKey)
          .accountsPartial({
            config: configPda,
            admin: attacker.publicKey,
          })
          .signers([attacker])
          .rpc(),
      6000,
      "delegate_admin unauthorized"
    );
  });

  erOnly("enforces bet limits, supports top-up, and locks bet choice", async function () {
    this.timeout(240000);

    const roundId = await nextRoundId();

    await createRound(roundId, 30);

    await expectCode(
      () => placeBetL1(roundId, adminWallet.publicKey, new BN(1), { alpha: {} }),
      6008,
      "min bet"
    );

    await expectCode(
      () => placeBetL1(roundId, adminWallet.publicKey, new BN(1_500_000_000), { alpha: {} }),
      6009,
      "max bet"
    );

    await placeBetL1(roundId, adminWallet.publicKey, BET_ALPHA, { alpha: {} });
    await placeBetL1(roundId, adminWallet.publicKey, BET_BETA, { alpha: {} });

    const bet = await program.account.bet.fetch(betPda(roundId, adminWallet.publicKey));
    expect(bet.amount.toString()).to.equal(BET_ALPHA.add(BET_BETA).toString());

    await expectCode(
      () => placeBetL1(roundId, adminWallet.publicKey, MIN_BET, { beta: {} }),
      6010,
      "choice immutable"
    );

    await closeBettingL1(roundId);
    await delegateRound(roundId);
    const settleSig = await settleEr(roundId);
    const settledRound = await waitForSettledL1(roundId, settleSig);

    if (enumKey(settledRound.winner) === "alpha") {
      await claimAs(roundId, adminWallet.publicKey);
    }

    await closeBetByAgent(roundId, adminWallet.publicKey);
    await sweepVaultByAgent(roundId);
  });

  erOnly("runs full ER flow: create/delegate/bet/move/settle/claim/close/sweep", async function () {
    this.timeout(360000);

    const bettorBeta = web3.Keypair.generate();
    await ensureWalletBalance(bettorBeta.publicKey, 200_000_000);

    let nonDrawWinner: "alpha" | "beta" | null = null;

    for (let attempt = 0; attempt < 3 && !nonDrawWinner; attempt += 1) {
      const roundId = await nextRoundId();

      await createRound(roundId, 45);

      await placeBetL1(roundId, adminWallet.publicKey, BET_ALPHA, { alpha: {} });
      await placeBetL1(
        roundId,
        bettorBeta.publicKey,
        BET_BETA,
        { beta: {} },
        bettorBeta
      );

      await closeBettingL1(roundId);
      await delegateRound(roundId);
      await executeMovesEr(roundId, 120);

      const settleSig = await settleEr(roundId);
      const settledRound = await waitForSettledL1(roundId, settleSig);
      const winner = enumKey(settledRound.winner);

      if (winner === "draw") {
        await expectCode(
          () => claimAs(roundId, adminWallet.publicKey),
          6014,
          "draw claim blocked"
        );

        await closeBetByAgent(roundId, adminWallet.publicKey);
        await closeBetByAgent(roundId, bettorBeta.publicKey);
        await sweepVaultByAgent(roundId);
        continue;
      }

      expect(winner === "alpha" || winner === "beta").to.equal(true);
      nonDrawWinner = winner as "alpha" | "beta";

      const winnerPubkey = winner === "alpha" ? adminWallet.publicKey : bettorBeta.publicKey;
      const winnerSigner = winner === "alpha" ? undefined : bettorBeta;
      const loserPubkey = winner === "alpha" ? bettorBeta.publicKey : adminWallet.publicKey;
      const loserSigner = winner === "alpha" ? bettorBeta : undefined;

      await claimAs(roundId, winnerPubkey, winnerSigner);
      const winnerBet = await program.account.bet.fetch(betPda(roundId, winnerPubkey));
      expect(winnerBet.claimed).to.equal(true);

      await expectCode(
        () => claimAs(roundId, loserPubkey, loserSigner),
        6013,
        "loser claim blocked"
      );

      await expectCode(
        () => claimAs(roundId, winnerPubkey, winnerSigner),
        6012,
        "double claim blocked"
      );

      await closeBetByAgent(roundId, winnerPubkey);
      await closeBetByAgent(roundId, loserPubkey);
      await sweepVaultByAgent(roundId);
    }

    expect(nonDrawWinner, "No non-draw round found across attempts").to.not.equal(null);
  });
});
