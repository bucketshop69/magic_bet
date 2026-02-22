import * as anchor from "@coral-xyz/anchor";
import { AnchorError, BN, Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import { LAMPORTS_PER_SOL, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  ConnectionMagicRouter,
  GetCommitmentSignature,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { MagicBet } from "../target/types/magic_bet";

describe("magic_bet", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const isLocalnet =
    provider.connection.rpcEndpoint.includes("localhost") ||
    provider.connection.rpcEndpoint.includes("127.0.0.1");
  const ER_VALIDATOR = new anchor.web3.PublicKey(
    "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57"
  );
  const connectionMagic = new ConnectionMagicRouter(
    process.env.ROUTER_ENDPOINT || "https://devnet-router.magicblock.app/",
    {
      wsEndpoint:
        process.env.WS_ROUTER_ENDPOINT || "wss://devnet-router.magicblock.app/",
    }
  );
  const providerMagic = new anchor.AnchorProvider(
    connectionMagic,
    anchor.Wallet.local()
  );
  const localOnly = isLocalnet ? it : it.skip;
  const erOnly = isLocalnet ? it.skip : it;

  const program = anchor.workspace.magicBet as Program<MagicBet>;
  const systemProgram = anchor.web3.SystemProgram.programId;
  const [configPda, configBump] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );
  const [housePda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("house")],
    program.programId
  );
  const PRICE_UPDATE_ACCOUNT = new anchor.web3.PublicKey(
    process.env.PRICE_UPDATE_ACCOUNT || "ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu"
  );
  const initialHouseFund = new BN(1_000_000_000);

  const roundSeed = (roundId: BN) => roundId.toArrayLike(Buffer, "le", 8);
  const roundPda = (roundId: BN) =>
    anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("round"), roundSeed(roundId)],
      program.programId
    )[0];
  const vaultPda = (roundId: BN) =>
    anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), roundSeed(roundId)],
      program.programId
    )[0];
  const betPda = (roundId: BN, user: anchor.web3.PublicKey) =>
    anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("bet"), roundSeed(roundId), user.toBuffer()],
      program.programId
    )[0];

  const isVariant = (value: object, variant: string) =>
    Object.prototype.hasOwnProperty.call(value, variant);

  const expectCustomError = async (
    operation: Promise<unknown>,
    expectedCode: number
  ) => {
    try {
      await operation;
      expect.fail(`Expected custom error code ${expectedCode}, but call succeeded`);
    } catch (error) {
      const parsed = AnchorError.parse((error as any)?.logs ?? []);
      const code =
        parsed?.error?.errorCode?.number ??
        (error as any)?.error?.errorCode?.number ??
        (error as any)?.errorCode?.number;
      expect(code).to.equal(expectedCode);
    }
  };

  const airdrop = async (pubkey: anchor.web3.PublicKey, lamports: number) => {
    const sig = await provider.connection.requestAirdrop(pubkey, lamports);
    const latest = await provider.connection.getLatestBlockhash();
    await provider.connection.confirmTransaction(
      {
        signature: sig,
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
      },
      "confirmed"
    );
  };

  const ensureInitialized = async (fundAmount: BN = initialHouseFund) => {
    const info = await provider.connection.getAccountInfo(configPda);
    if (!info) {
      await program.methods
        .initialize(fundAmount)
        .accountsPartial({
          signer: provider.wallet.publicKey,
          config: configPda,
          house: housePda,
          systemProgram,
        })
        .rpc();
      return true;
    }
    return false;
  };

  const createRound = async (roundId: BN, duration: BN) => {
    await program.methods
      .createRound(roundId, duration)
      .accountsPartial({
        signer: provider.wallet.publicKey,
        round: roundPda(roundId),
        priceUpdate: PRICE_UPDATE_ACCOUNT,
        systemProgram,
      })
      .rpc();
  };

  const placeBet = async (
    roundId: BN,
    bettor: anchor.web3.Keypair,
    amount: BN,
    direction: { up: {} } | { down: {} }
  ) => {
    const bet = betPda(roundId, bettor.publicKey);
    const round = roundPda(roundId);
    const vault = vaultPda(roundId);
    await program.methods
      .placeBet(roundId, amount, direction)
      .accountsPartial({
        signer: bettor.publicKey,
        bet,
        round,
        vault,
        systemProgram,
      })
      .signers([bettor])
      .rpc();
    return { bet, round, vault };
  };

  const closeBetting = async (
    roundId: BN,
    signer: anchor.web3.PublicKey = provider.wallet.publicKey
  ) => {
    await program.methods
      .closeBetting(roundId)
      .accountsPartial({
        signer,
        config: configPda,
        round: roundPda(roundId),
      })
      .rpc();
  };

  const getValidatorOrFallback = async () => {
    const timeoutMs = 15000;
    try {
      const closest = (await Promise.race([
        connectionMagic.getClosestValidator(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("getClosestValidator timeout")), timeoutMs)
        ),
      ])) as { identity: string; fqdn?: string };
      return {
        validator: new anchor.web3.PublicKey(closest.identity),
        closest,
      };
    } catch (error) {
      console.warn(
        "Falling back to static ER validator because getClosestValidator failed:",
        (error as Error).message
      );
      return { validator: ER_VALIDATOR, closest: undefined as { fqdn?: string } | undefined };
    }
  };

  localOnly("initializes config and funds the house vault", async () => {
    const houseBefore = await provider.connection.getBalance(housePda);
    const initializedNow = await ensureInitialized();

    const config = await program.account.config.fetch(configPda);
    expect(config.admin.equals(provider.wallet.publicKey)).to.equal(true);
    expect(config.bump).to.equal(configBump);

    if (initializedNow) {
      const houseAfter = await provider.connection.getBalance(housePda);
      expect(houseAfter - houseBefore).to.equal(initialHouseFund.toNumber());
    }
  });

  localOnly("creates a round with active status", async () => {
    await ensureInitialized();
    const roundId = new BN(1001);
    const duration = new BN(120);
    const round = roundPda(roundId);

    await createRound(roundId, duration);
    const roundAccount = await program.account.round.fetch(round);

    expect(roundAccount.roundId.eq(roundId)).to.equal(true);
    expect(roundAccount.duration.eq(duration)).to.equal(true);
    expect(roundAccount.upPool.toNumber()).to.equal(0);
    expect(roundAccount.downPool.toNumber()).to.equal(0);
    expect(isVariant(roundAccount.status, "active")).to.equal(true);
  });

  localOnly("places an up bet and updates bet + pool state", async () => {
    await ensureInitialized();
    const roundId = new BN(1002);
    const duration = new BN(300);
    await createRound(roundId, duration);

    const bettor = anchor.web3.Keypair.generate();
    await airdrop(bettor.publicKey, anchor.web3.LAMPORTS_PER_SOL);

    const amount = new BN(200_000_000);
    const vaultBefore = await provider.connection.getBalance(vaultPda(roundId));
    const result = await placeBet(roundId, bettor, amount, { up: {} });

    const vaultAfter = await provider.connection.getBalance(result.vault);
    const betAccount = await program.account.bet.fetch(result.bet);
    const roundAccount = await program.account.round.fetch(result.round);

    expect(vaultAfter - vaultBefore).to.equal(amount.toNumber());
    expect(betAccount.user.equals(bettor.publicKey)).to.equal(true);
    expect(betAccount.roundId.eq(roundId)).to.equal(true);
    expect(betAccount.amount.eq(amount)).to.equal(true);
    expect(isVariant(betAccount.direction, "up")).to.equal(true);
    expect(betAccount.isClaimed).to.equal(false);
    expect(roundAccount.upPool.eq(amount)).to.equal(true);
    expect(roundAccount.downPool.toNumber()).to.equal(0);
  });

  localOnly("rejects settle_round from non-admin signer", async () => {
    await ensureInitialized();
    const roundId = new BN(1003);
    const duration = new BN(120);
    await createRound(roundId, duration);

    const attacker = anchor.web3.Keypair.generate();
    await airdrop(attacker.publicKey, anchor.web3.LAMPORTS_PER_SOL);

    await expectCustomError(
      program.methods
        .settleRound(roundId, new BN(123))
        .accountsPartial({
          signer: attacker.publicKey,
          config: configPda,
          round: roundPda(roundId),
          systemProgram,
        })
        .signers([attacker])
        .rpc(),
      6001
    );
  });

  localOnly("rejects settle_round when round is still active", async () => {
    await ensureInitialized();
    const roundId = new BN(1004);
    const duration = new BN(120);
    await createRound(roundId, duration);

    await expectCustomError(
      program.methods
        .settleRound(roundId, new BN(456))
        .accountsPartial({
          signer: provider.wallet.publicKey,
          config: configPda,
          round: roundPda(roundId),
          systemProgram,
        })
        .rpc(),
      6002
    );
  });

  localOnly("closes betting and moves round status to inProgress", async () => {
    await ensureInitialized();
    const roundId = new BN(1006);
    const duration = new BN(90);
    const round = roundPda(roundId);
    await createRound(roundId, duration);

    await closeBetting(roundId);
    const roundAccount = await program.account.round.fetch(round);
    expect(isVariant(roundAccount.status, "inProgress")).to.equal(true);
  });

  localOnly("rejects claim_winnings before the round is settled", async () => {
    await ensureInitialized();
    const roundId = new BN(1005);
    const duration = new BN(180);
    await createRound(roundId, duration);

    const bettor = anchor.web3.Keypair.generate();
    await airdrop(bettor.publicKey, anchor.web3.LAMPORTS_PER_SOL);

    const result = await placeBet(roundId, bettor, new BN(100_000_000), {
      down: {},
    });

    await expectCustomError(
      program.methods
        .claimWinnings(roundId)
        .accountsPartial({
          signer: bettor.publicKey,
          bet: result.bet,
          round: result.round,
          house: housePda,
          systemProgram,
        })
        .signers([bettor])
        .rpc(),
      6003
    );
  });

  erOnly("runs devnet ER flow (init/create/delegate/place/settle+undelegate/claim)", async function () {
    this.timeout(300000);

    const payer = providerMagic.wallet;
    const roundId = new BN(Date.now());
    const duration = new BN(120);
    const amount = new BN(1_000_000);

    const round = roundPda(roundId);
    const bet = betPda(roundId, payer.publicKey);
    const vault = vaultPda(roundId);

    console.log("ER step: checking payer balance");
    const payerBalance = await provider.connection.getBalance(payer.publicKey);
    expect(
      payerBalance,
      "Local wallet has no SOL on devnet. Fund ~/.config/solana/id.json before running ER tests."
    ).to.be.greaterThan(0.01 * LAMPORTS_PER_SOL);

    console.log("ER step: initialize + create round on base layer");
    await ensureInitialized();
    await createRound(roundId, duration);

    console.log("ER step: select validator and delegate round");
    const { validator, closest } = await getValidatorOrFallback();

    const delegateTx = await program.methods
      .delegateRound()
      .accountsPartial({
        payer: payer.publicKey,
        validator,
        pda: round,
      })
      .transaction();
    await sendAndConfirmTransaction(provider.connection, delegateTx, [payer.payer], {
      skipPreflight: true,
      commitment: "confirmed",
    });

    console.log("ER step: place bet on ER");
    const placeBetTx = await program.methods
      .placeBet(roundId, amount, { up: {} })
      .accountsPartial({
        signer: payer.publicKey,
        bet,
        round,
        vault,
        systemProgram,
      })
      .transaction();
    const erPlaceSig = await sendAndConfirmTransaction(
      connectionMagic,
      placeBetTx,
      [payer.payer],
      { skipPreflight: true, commitment: "confirmed" }
    );
    console.log("ER place_bet signature:", erPlaceSig);

    console.log("ER step: close betting on ER");
    const closeBettingTx = await program.methods
      .closeBetting(roundId)
      .accountsPartial({
        signer: payer.publicKey,
        config: configPda,
        round,
      })
      .transaction();
    const closeSig = await sendAndConfirmTransaction(connectionMagic, closeBettingTx, [payer.payer], {
      skipPreflight: true,
      commitment: "confirmed",
    });
    console.log("ER close_betting signature:", closeSig);

    console.log("ER step: settle + undelegate on ER");
    const settleTx = await program.methods
      .settleAndUndelegate(roundId)
      .accountsPartial({
        payer: payer.publicKey,
        config: configPda,
        round,
        priceUpdate: PRICE_UPDATE_ACCOUNT,
        magicContext: MAGIC_CONTEXT_ID,
        magicProgram: MAGIC_PROGRAM_ID,
      })
      .transaction();

    const settleSig = await sendAndConfirmTransaction(connectionMagic, settleTx, [payer.payer], {
      skipPreflight: true,
    });

    console.log("ER step: wait for base-layer commitment signature");
    const commitmentConnection = new anchor.web3.Connection(
      closest?.fqdn ?? connectionMagic.rpcEndpoint
    );
    const baseLayerCommitSig = await GetCommitmentSignature(settleSig, commitmentConnection);
    console.log("Base-layer commit/undelegate signature:", baseLayerCommitSig);

    console.log("ER step: claim winnings on base layer");
    await program.methods
      .claimWinnings(roundId)
      .accountsPartial({
        signer: payer.publicKey,
        bet,
        round,
        house: housePda,
        systemProgram,
      })
      .signers([payer.payer])
      .rpc();
  });
});
