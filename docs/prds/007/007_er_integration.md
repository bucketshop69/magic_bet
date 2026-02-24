# 007 — ER Integration Details

## Overview

This PRD specifies how MagicBlock Ephemeral Rollups integrate with the game execution.

---

## ER Validator Selection

**Devnet:**
| Region | Endpoint | Pubkey |
|--------|----------|--------|
| US | devnet-us.magicblock.app | `MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd` |
| Asia | devnet-as.magicblock.app | `MAS1Dt9qreoRMQ14YUHg8UTZMMzDdKhmkZMECCzk57` |

**Mainnet:** TBD (use US for hackathon)

---

## How execute_move Runs on ER

After `delegate_round()`, the Round account is owned by ER. Any `execute_move` calls must:

1. **Target ER RPC** — Not L1 RPC
2. **Sign with ER provider** — Same wallet, different connection
3. **Include magic accounts** — Anchor auto-injects `magic_context` and `magic_program`

```typescript
// Crank calls execute_move on ER
const erProvider = new AnchorProvider(erConnection, wallet);
const tx = await program.methods.executeMove().accounts({
  round: roundPDA,
}).transaction();

tx.feePayer = erProvider.wallet.publicKey;
tx.recentBlockhash = (await erProvider.connection.getLatestBlockhash()).blockhash;

const signed = await erProvider.wallet.signTransaction(tx);
await erProvider.sendAndConfirm(signed);
```

---

## Key Differences: L1 vs ER

| Aspect | L1 | ER |
|--------|-----|-----|
| Latency | ~400ms | ~100ms |
| Cost | Normal fees | Normal fees |
| Account access | Direct | Via magic_context |
| Who calls | Anyone | Crank script |

---

## Crank Script Requirements

The crank must:

1. **Maintain two providers:**
   - L1 provider (for settle, create_round, close_betting)
   - ER provider (for execute_move calls)

2. **Track delegation state:**
   - Before execute_move → verify round is delegated
   - After settle → verify undelegation complete

3. **Error handling:**
   - If ER validator fails → retry with exponential backoff
   - If delegation lost → re-delegate before continuing

---

## MagicBlock SDK Usage

```rust
// In program:
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::{commit_accounts, commit_and_undelegate_accounts};
```

**Key functions:**
- `delegate_pda()` — Transfer ownership to ER
- `commit_accounts()` — Sync state to L1 (without undelegating)
- `commit_and_undelegate_accounts()` — Final sync + return ownership

---

## State Flow (Full ER Automation)

```
Admin (L1): initialize() → fund house
Admin (L1): delegate_admin(agent) → agent now authorized

Agent (ER):
  create_round() → Active
  place_bet() → users bet (ER fast!)
  close_betting() → InProgress
  execute_move() × 500 → game plays at 100ms ticks
  settle_and_undelegate() → Settled, back to L1
  sweep_vault() → if draw
  → repeat
```

---

## Error Handling

| Error | Recovery |
|-------|----------|
| ER validator down | Retry 3x, then alert |
| Delegation lost | Re-delegate |
| Commit fails | Retry on next tick |
| Network timeout | Exponential backoff |

---

## CTO Review

**Score: 9/10** ✅ Approved

- Clear ER vs L1 distinction
- Crank requirements specified
- Error handling covered
