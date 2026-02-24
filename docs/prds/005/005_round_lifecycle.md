# 005 — Round Lifecycle

## Overview

Round states: `Active` → `InProgress` → `Settled`

---

## create_round

| Param | Type | Description |
|-------|------|-------------|
| `round_id` | u64 | Unique ID (increment from config) |
| `start_time` | i64 | Unix timestamp |

**Accounts:**

- `config` — get current round_id, increment
- `round` — PDA ["round", round_id]

**Logic:**

1. Get current round_id from Config
2. Create Round PDA with status = Active
3. Initialize: empty boards, both snakes alive, scores 0, pools 0
4. Increment config.round_id

---

## delegate_round

| Param | Type |
|-------|------|
| `round_id` | u64 |

**Accounts:**

- `round` — must exist

**Logic:**

1. Validate round.status == Active (or InProgress)
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

## Round Status Flow

```
Active (betting open)
    ↓ close_betting()
InProgress (game playing on ER)
    ↓ settle_and_undelegate()
Settled (winner determined)
```

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
