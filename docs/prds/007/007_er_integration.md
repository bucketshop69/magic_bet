# 007 — ER Integration Details

## Overview

This PRD specifies how MagicBlock Ephemeral Rollups integrate with the game execution.

---

## ER Validator Selection

**Devnet:**
| Region | Endpoint | Pubkey |
|--------|----------|--------|
| US | devnet-us.magicblock.app | `MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd` |
| Asia | devnet-as.magicblock.app | `MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57` |

**Mainnet:** TBD (use US for hackathon)

---

## How execute_move Runs on ER

After `delegate_round()`, the Round account is owned by ER. Any `execute_move` calls must:

1. **Target ER RPC** — Not L1 RPC
2. **Sign with ER provider** — Same wallet, different connection
3. **Use delegated Round account only** — No account creation or lamport movement on ER path

```typescript
// Crank calls execute_move on ER
const erProvider = new AnchorProvider(erConnection, wallet);
await program.methods.executeMove(roundId).accounts({
  round: roundPDA,
  config: configPDA,
  signer: crankPubkey,
}).rpc();
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
   - L1 provider (for create_round, place_bet, close_betting, claim/sweep)
   - ER provider (for delegate-aware `execute_move` and `settle_and_undelegate`)

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

Hybrid flow:
  create_round() on L1 → Active
  users place_bet() on L1
  close_betting() on L1 → InProgress
  delegate_round() on L1
  execute_move() × N on ER
  settle_and_undelegate() on ER → Settled, back to L1
  claim_winnings()/sweep_vault() on L1
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


> Codex note (2026-02-25): Implemented and validated on devnet (`anchor test`: 4 passing). Final ER split is data-only game execution on ER, with betting/payout SOL movement on L1.
