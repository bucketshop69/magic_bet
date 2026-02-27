# 004 — Betting Logic

## Overview

House model: players bet against the house, not each other. 2x payout on win.

---

## place_bet Instruction

**Mutability Rules:**
- If Bet PDA doesn't exist → create new
- If Bet PDA exists → ADD amount to existing (top-up)
- Choice CANNOT be changed once placed
- If user tries to change choice → REJECT

| Field | Value |
|-------|-------|
| `round_id` | u64 |
| `choice` | AIChoice (Alpha/Beta) |
| `amount` | u64 (lamports, 0.01-1 SOL) |

**Accounts:**

- `round` — must be Active status (L1)
- `bet` — PDA ["bet", round_id, user], create if not exist
- `user` — signer
- `vault` — PDA ["vault", round_id] (L1, never delegated)

**Layering:** `place_bet` runs on L1 only. Vault stays on L1. Only Round PDA delegates to ER.

**Logic:**

1. Validate round.status == Active
2. Validate 0.01 SOL <= amount <= 1 SOL
3. Transfer SOL from user to vault
4. Create/update Bet PDA with choice, amount, claimed=false
5. Add to alpha_pool or beta_pool

---

## claim_winnings Instruction

| Field | Value |
|-------|-------|
| `round_id` | u64 |

**Accounts:**

- `round` — must be Settled
- `bet` — PDA ["bet", round_id, user]
- `user` — signer
- `house` — PDA ["house"]

**Logic:**

1. Validate round.status == Settled
2. Validate bet.choice == round.winner
3. Validate bet.claimed == false
4. Transfer 2x amount from house to user
5. Set bet.claimed = true

---

## Edge Cases

| Case | Handling |
|------|----------|
| House balance < 2x total_payout | REJECT: "House insufficient funds" |
| Round not Active | REJECT: "Betting closed" |

**House Solvency Check:**
- On place_bet: Calculate potential payout = (user's existing bet + new bet) × 2
- Validate: house.balance >= (alpha_pool + beta_pool) × 2 + potential_payout
- This ensures house can pay ALL winners even if everyone bets same side

| Case | Handling |
|------|----------|
| Amount < 0.01 SOL | REJECT: "Min bet 0.01 SOL" |
| Amount > 1 SOL | REJECT: "Max bet 1 SOL" |
| Double claim | REJECT: "Already claimed" |
| Claim on loss | REJECT: "You didn't win" |
| Draw | No payouts (bet stays in vault) |
| House empty | REJECT: "Insufficient funds" |

---

## Bet PDA

```rust
struct Bet {
    round_id: u64,
    user: Pubkey,
    choice: AIChoice,
    amount: u64,  // lamports
    claimed: bool,
}
```

---

## Round Pool Fields

```rust
alpha_pool: u64,  // total lamports bet on Alpha
beta_pool: u64,   // total lamports bet on Beta
```

---

## CTO Review

**Score: 8/10** ✅ Approved

- Covers all PM edge cases
- Clear instruction specs
- Proper validation order
- Draw handled (no payouts)


> Codex note (2026-02-25): Implemented and validated on devnet (`anchor test`: 4 passing). `place_bet` is finalized as L1-only with top-up + immutable choice.
