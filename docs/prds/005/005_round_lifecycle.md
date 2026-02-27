# 005 — Round Lifecycle

## Overview

Round states: `Active` → `InProgress` → `Settled`

---

## create_round

| Param | Type | Description |
|-------|------|-------------|
| `round_id` | u64 | Unique ID (increment from config) |
| `duration` | i64 | Betting duration in seconds (e.g., 180 = 3 min) |

**Accounts:**

- `config` — get current round_id, increment
- `round` — PDA ["round", round_id]

**Logic:**

1. Get current round_id from Config
2. Create Round PDA with status = Active
3. Set start_time = Clock::now(), end_time = start_time + duration
4. Initialize: empty boards, both snakes alive, scores 0, pools 0
5. Increment config.round_id
6. Keep round on L1 while betting is open

---

## delegate_round

| Param | Type |
|-------|------|
| `round_id` | u64 |

**Accounts:**

- `round` — must exist

**Logic:**

1. Validate round.status == InProgress
2. Delegate round PDA to ER validator
3. This enables fast (100ms) execute_move calls

---

## close_betting

| Param | Type |
|-------|------|
| `round_id` | u64 |

**Accounts:**

- `round`

**Logic:**

1. Validate round.status == Active
2. Set round.status = InProgress
3. After this, place_bet REJECTs

---

## execute_move

| Param | Type |
|-------|------|
| `round_id` | u64 |

**Accounts:**

- `round` — must be InProgress

**Logic:**

1. Validate status == InProgress
2. Run Alpha AI move
3. Run Beta AI move
4. Check collisions, update scores
5. Check win condition
6. Increment move_count
7. If winner found → auto-settle (or wait for explicit settle)

---

## settle_and_undelegate

| Param | Type |
|-------|------|
| `round_id` | u64 |

**Accounts:**

- `round`

**Logic:**

1. Determine winner (survival → score → moves)
2. Set round.winner = Alpha/Beta/Draw
3. Set round.status = Settled
4. Undelegate from ER
5. If Draw → no payouts, bets stay in vault

---

## Full ER Automation Flow

**Setup (once):**
1. Admin: `initialize(fund_amount)` → creates Config + House
2. Admin: `delegate_admin(agent)` → delegates to crank/agent

**Each round (hybrid L1 + ER):**
1. Agent: `create_round(id, duration)` → new round, status = Active
2. Users: `place_bet(round_id, choice, amount)` → bet on L1
3. Agent: `close_betting(round_id)` → status = InProgress
4. Agent: `delegate_round(round_id)` → move Round execution to ER
5. Agent: `execute_move(round_id)` × N → game plays at 100ms
6. Agent: `settle_and_undelegate(round_id)` → status = Settled, back to L1
7. Users: `claim_winnings(round_id)` → collect 2x
8. Agent: `sweep_vault(round_id)` → close round vault
9. Repeat from step 1

**Key:** Agent signs lifecycle/crank instructions; users still sign their own `place_bet` and `claim_winnings`.

---

## Edge Cases

| Scenario | Action |
|----------|--------|
| create while active | REJECT |
| delegate non-existent | REJECT |
| close already closed | REJECT |
| settle already settled | REJECT |
| execute on wrong status | REJECT |
| max moves reached | Auto-settle by higher score |

---

## CTO Review

**Score: 8/10** ✅ Approved

- Clear state machine
- Proper validation at each step
- ER integration covered


> Codex note (2026-02-25): Implemented and validated on devnet (`anchor test`: 4 passing). Final lifecycle is L1 betting window, then ER game execution after `close_betting` + `delegate_round`.
