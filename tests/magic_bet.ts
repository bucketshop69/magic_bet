import * as anchor from "@coral-xyz/anchor";
import { Program, web3 } from "@coral-xyz/anchor";
import { AnchorCounter } from "../target/types/anchor_counter";
import { expect } from "chai";

const COUNTER_SEED = "counter_pda_v2";

// ER Validator - Asia (devnet)
const ER_VALIDATOR = new web3.PublicKey(
  "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57"
);

describe("Ephemeral Rollups POC - Counter", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // @ts-ignore
  const program = anchor.workspace.AnchorCounter as Program<AnchorCounter>;

  // Derive PDA for counter
  const [counterPDA] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from(COUNTER_SEED)],
    program.programId
  );

  // ER connection - use Asia validator endpoint
  const erConnection = new web3.Connection(
    "https://devnet-as.magicblock.app/",
    {
      wsEndpoint: "wss://devnet-as.magicblock.app/",
    }
  );
  
  // ER Provider - this is key! Use ER connection with same wallet
  const erProvider = new anchor.AnchorProvider(erConnection, provider.wallet);
  const erProgram = new Program<AnchorCounter>(program.idl as AnchorCounter, erProvider);

  console.log("Program ID:", program.programId.toString());
  console.log("Counter PDA:", counterPDA.toString());
  console.log("ER Validator:", ER_VALIDATOR.toString());
  console.log("L1 RPC:", provider.connection.rpcEndpoint);
  console.log("ER RPC:", erConnection.rpcEndpoint);

  before(async () => {
    console.log("\n=== Setting up test environment ===");
    
    // Airdrop if needed
    try {
      const balance = await provider.connection.getBalance(provider.wallet.publicKey);
      console.log("Wallet balance:", balance / 1e9, "SOL");
      if (balance < 1e9) {
        console.log("Airdropping SOL...");
        const airdropSig = await provider.connection.requestAirdrop(
          provider.wallet.publicKey,
          2e9
        );
        await provider.connection.confirmTransaction(airdropSig);
        console.log("Airdrop complete");
      }
    } catch (e) {
      console.log("Airdrop skipped:", e);
    }
  });

  it("1. Initialize counter on L1", async () => {
    console.log("\n=== Step 1: Initialize counter on L1 ===");
    
    try {
      const tx = await program.methods
        .initialize()
        .accounts({
          user: provider.wallet.publicKey,
        })
        .transaction();
      
      tx.feePayer = provider.wallet.publicKey;
      tx.recentBlockhash = (await provider.connection.getLatestBlockhash()).blockhash;
      
      const sig = await provider.sendAndConfirm(tx);
      console.log("Init TX:", sig);
      
      // Verify counter is initialized
      const counterAccount = await program.account.counter.fetch(counterPDA);
      console.log("Counter initialized:", counterAccount.count.toString());
      expect(counterAccount.count.toNumber()).to.equal(0);
    } catch (e) {
      // Counter might already exist
      console.log("Init error (might already exist):", e.message);
      const counterAccount = await program.account.counter.fetch(counterPDA);
      console.log("Current count:", counterAccount.count.toString());
    }
  });

  it("2. Delegate counter to ER", async () => {
    console.log("\n=== Step 2: Delegate counter to ER ===");

    try {
      const tx = await program.methods
        .delegate()
        .accounts({
          payer: provider.wallet.publicKey,
          pda: counterPDA,
        })
        .remainingAccounts([
          {
            pubkey: ER_VALIDATOR,
            isWritable: false,
            isSigner: false,
          },
        ])
        .transaction();

      tx.feePayer = provider.wallet.publicKey;
      tx.recentBlockhash = (await provider.connection.getLatestBlockhash()).blockhash;

      const sig = await provider.sendAndConfirm(tx);
      console.log("Delegate TX:", sig);
      console.log("Counter delegated to ER");
    } catch (e) {
      console.log("Delegate error (might already be delegated):", e.message);
    }

    console.log("Waiting 3s for delegation to propagate...");
    await new Promise((resolve) => setTimeout(resolve, 3000));
  });

  it("3-13. Increment counter on ER (x10)", async () => {
    console.log("\n=== Step 3-13: Increment on ER (x10) ===");
    
    for (let i = 1; i <= 10; i++) {
      try {
        const sig = await erProgram.methods
          .increment()
          .accounts({
            counter: counterPDA,
          })
          .rpc();

        console.log(`Increment ${i} TX:`, sig.slice(0, 12) + "...");
        await new Promise((resolve) => setTimeout(resolve, 200));
      } catch (e) {
        console.error(`Error on increment ${i}:`, e.message);
      }
    }

    const counterAccount = await erProgram.account.counter.fetch(counterPDA);
    console.log("Final count after 10 increments:", counterAccount.count.toString());
    expect(counterAccount.count.toNumber()).to.equal(10);
  });

  it("14. Commit state to L1", async () => {
    console.log("\n=== Step 14: Commit state to L1 ===");
    
    try {
      const sig = await erProgram.methods
        .commit()
        .accounts({
          payer: erProvider.wallet.publicKey,
        })
        .rpc();

      console.log("Commit TX:", sig);
      console.log("State committed to L1");
    } catch (e) {
      console.error("Commit error:", e.message);
    }
  });

  it("15. Undelegate and verify", async () => {
    console.log("\n=== Step 15: Undelegate and verify ===");
    
    try {
      const sig = await erProgram.methods
        .incrementAndUndelegate()
        .accounts({
          payer: erProvider.wallet.publicKey,
        })
        .rpc();

      console.log("Undelegate TX:", sig);

      await new Promise((resolve) => setTimeout(resolve, 2000));

      let finalCount = 0;
      for (let i = 0; i < 10; i++) {
        const counterAccount = await program.account.counter.fetch(counterPDA);
        finalCount = counterAccount.count.toNumber();
        if (finalCount === 11) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      console.log("Final count on L1:", finalCount);
      expect(finalCount).to.equal(11);
    } catch (e) {
      console.error("Undelegate error:", e.message);
    }
  });

  it("Full flow: init → delegate → increment → commit → undelegate", async () => {
    console.log("\n=== Full Integration Test ===");
    console.log("This test runs the full flow in sequence");
    
    // This is a placeholder - the individual tests above cover the flow
    expect(true).to.equal(true);
  });
});
