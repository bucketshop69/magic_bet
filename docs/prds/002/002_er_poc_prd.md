# 002_er_poc_prd.md — Ephemeral Rollups POC

## Overview

This PRD defines the POC to understand how MagicBlock's Ephemeral Rollups (ER) work, so we can integrate them into Magic Bet for sub-second game moves.

## What is an Ephemeral Rollup?

An ER is a temporary sidechain that runs on Solana validators. You **delegate** a PDA to it, it executes fast (sub-second), then you **undelegate** and state syncs back to L1.

**Why we need it:** 100ms game ticks are impossible on L1 (400ms). ER lets us run game logic fast.

## Key Concepts

### 1. Delegation

- Transfer ownership of a PDA to the delegation program
- After delegation, ER validator can modify the PDA
- Uses MagicBlock's delegation program: `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh`

### 2. Commit

- Sync state from ER back to L1 (without undelegating)
- PDA stays locked on L1 but ER can continue working

### 3. Undelegate + Commit

- Final sync of state from ER to L1
- PDA unlocked on L1, can be used normally again

## ER Validators (Devnet)

| Region | Endpoint | Pubkey |
|--------|----------|--------|
| US | devnet-us.magicblock.app | `MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd` |
| EU | devnet-eu.magicblock.app | `MEUGGrYPxKk17hCr7wpT6s8dtNokZj5U2L57vjYMS8e` |
| Asia | devnet-as.magicblock.app | `MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57` |
| TEE | tee.magicblock.app | `FnE6VJT5QNZdedZZnCoLsARgBwoE6DeJNjBs2H1gySXA` |

## Required Dependencies

```bash
cargo add ephemeral-rollups-sdk --features anchor
```

## Required Imports

```rust
use ephemeral_rollups_sdk::anchor::{
    commit,
    delegate,
    ephemeral
};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::{
    commit_accounts,
    commit_and_undelegate_accounts
};
```

## Instructions to Implement

### 1. `initialize`

- Create counter PDA with count = 0
- Standard Anchor (no ER)

### 2. `increment`

- Increment counter by 1
- Standard Anchor (no ER)

### 3. `delegate`

- Delegate counter PDA to ER
- Must include ER validator pubkey as remaining_account
- After this, counter can be modified on ER

### 4. `increment_and_commit`

- Increment counter on ER
- Commit state to L1 immediately

### 5. `undelegate`

- Commit state from ER to L1
- Unlock PDA on L1

## Context Structs Needed

### Initialize

```rust
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init_if_needed, payer = user, space = 8 + 8, seeds = [TEST_PDA_SEED], bump)]
    pub counter: Account<'info, Counter>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}
```

### Increment

```rust
#[derive(Accounts)]
pub struct Increment<'info> {
    #[account(mut, seeds = [TEST_PDA_SEED], bump)]
    pub counter: Account<'info, Counter>,
}
```

### Delegate

```rust
#[delegate]
#[derive(Accounts)]
pub struct DelegateInput<'info> {
    pub payer: Signer<'info>,
    pub validator: Option<AccountInfo<'info>>,
    #[account(mut, del)]
    pub pda: AccountInfo<'info>,
}
```

### IncrementAndCommit (for ER operations)

```rust
#[derive(Accounts)]
pub struct IncrementAndCommit<'info> {
    #[account(mut, seeds = [TEST_PDA_SEED], bump)]
    pub counter: Account<'info, Counter>,
    pub payer: Signer<'info>,
    /// CHECK: MagicBlock context
    pub magic_context: AccountInfo<'info>,
    /// CHECK: MagicBlock program
    pub magic_program: AccountInfo<'info>,
}
```

## POC Success Criteria

1. Program builds and deploys to devnet
2. Can initialize counter on L1
3. Can delegate counter to ER
4. Can increment counter on ER (multiple times)
5. Can commit state to L1
6. Can undelegate and verify final state on L1
7. Tests pass for full delegation cycle

## What EM Must Deliver

1. Working Anchor program with ER integration
2. Tests that cover: init → delegate → increment (x10) → commit → undelegate → verify
3. Document findings in `002_how_use_er.md`
4. Feedback for team on what's tricky /需要注意的地方

## Timeline

- POC should take 1-2 hours
- Focus: understand the pattern, not build the game yet
