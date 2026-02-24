# 006 — Admin & House

## initialize

| Param | Type | Description |
|-------|------|-------------|
| `fund_amount` | u64 | Initial SOL to fund house vault |

**Accounts:**

- `config` — PDA ["config"], create
- `house` — PDA ["house"], create + fund
- `admin` — signer, stored in config

**Logic:**

1. Create Config PDA with admin = signer
2. Create House PDA, transfer fund_amount from admin
3. Initialize round_id = 0
4. Only callable once (check Config exists)

---

## close_bet

| Param | Type |
|-------|------|
| `round_id` | u64 |
| `user` | Pubkey |

**Accounts:**

- `bet` — PDA ["bet", round_id, user]
- `round` — must be Settled

**Logic:**

1. Validate round.status == Settled
2. Close Bet PDA, return rent to user

---

## Admin-Only Instructions

These require `config.admin == signer`:

| Instruction | Why Admin Only |
|-------------|----------------|
| `create_round` | Control game timing |
| `delegate_round` | Start ER session |
| `close_betting` | Trigger game start |
| `settle_and_undelegate` | End game |
| `initialize` | One-time setup |

---

## House PDA

```rust
struct House {
    bump: u8,
    // SOL balance for payouts
}
```

**Validation:**

- On `claim_winnings`: check house.balance >= 2x payout
- If insufficient: REJECT

---

## Edge Cases

| Scenario | Action |
|----------|--------|
| Non-admin calls admin ix | REJECT: "Admin only" |
| Initialize twice | REJECT: "Already initialized" |
| Claim with no house funds | REJECT: "Insufficient house funds" |
| Close bet before settled | REJECT: "Round not settled" |

---

## CTO Review

**Score: 8/10** ✅ Approved

- Clear admin boundary
- House solvency checks
- Rent cleanup via close_bet
