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

## delegate_admin

**Purpose:** Admin delegates authority to agent (crank) so agent can run rounds without admin signatures.

| Param | Type | Description |
|-------|------|-------------|
| `agent` | Pubkey | Agent/crank public key |

**Accounts:**
- `config` — PDA ["config"]
- `admin` — signer (must be config.admin)

**Logic:**
1. Validate signer == config.admin
2. Set config.agent = agent pubkey
3. After this, agent can call all admin instructions

**Usage:** Run once after initialize. Agent then runs lifecycle/crank instructions; users still sign `place_bet` and `claim_winnings` on L1.

---

## fund_house

| Param | Type | Description |
|-------|------|-------------|
| `amount` | u64 | SOL to add to house vault |

**Accounts:**
- `house` — PDA ["house"]
- `admin` — signer (must be config.admin)
- `system_program` — transfer

**Logic:**
1. Validate admin == config.admin
2. Transfer amount from admin → House PDA

---

## sweep_vault

| Param | Type | Description |
|-------|------|-------------|
| `round_id` | u64 | Round to sweep |

**Accounts:**
- `vault` — PDA ["vault", round_id]
- `house` — PDA ["house"]
- `admin` — signer

**Logic:**
1. Validate round.status == Settled
2. Transfer all SOL from vault → house
3. Close vault, return rent

**Use case:** After draw, move bets back to house.

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

These require `config.admin == signer OR config.agent == signer`:

| Instruction | Why Admin/Agent |
|-------------|-----------------|
| `create_round` | Control game timing |
| `delegate_round` | Start ER session |
| `close_betting` | Trigger game start |
| `settle_and_undelegate` | End game |
| `initialize` | One-time setup |
| `fund_house` | Add house funds |
| `sweep_vault` | Collect vault funds |

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

**Added after CEO review:**
- `fund_house` instruction for admin to add SOL
- Balance check on place_bet


> Codex note (2026-02-25): Implemented and validated on devnet (`anchor test`: 4 passing). Admin/agent authority and house flows are active in `programs/magic_bet/src/lib.rs`.
