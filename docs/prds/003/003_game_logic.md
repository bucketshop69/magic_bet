# 003 — Game Logic (Snake AI)

## Overview

Alpha vs Beta snake battle on a deterministic 2D grid. Fully transparent, on-chain AI logic.

---

## Board

- **Grid size:** 20x20 (400 cells)
- **Coordinates:** (0,0) top-left to (19,19) bottom-right
- **Cell states:** Empty (0), Snake (1), Food (2)

---

## Snake State

Each snake has:

| Field | Type | Description |
|-------|------|-------------|
| `head` | (x, y) | Current head position |
| `body` | Vec<(x, y)> | Body segments from head to tail |
| `direction` | Direction | UP, DOWN, LEFT, RIGHT |
| `alive` | bool | Is snake alive |
| `score` | u32 | Food eaten count |

---

## Food

- One food item on board at a time
- Random placement on empty cell
- When eaten: score +1, new food spawns

---

## AI Strategies

Both AIs are fully on-chain, deterministic, and transparent. After game balancing, both agents share the same core move attributes.

- **Alpha** 🔵 — On-chain snake AI
- **Beta** 🟠 — On-chain snake AI

---

## Move Execution

Each `execute_move` tick:

1. Both AIs calculate next move simultaneously
2. Both move one step
3. Check if either hit wall → dead
4. Check if either hit own body → dead
5. Check head-to-head collision → both die (draw)
6. Check if either ate food → score++, spawn new food
7. Check win condition

---

## Win Condition

| Priority | Condition |
|----------|-----------|
| 1st | Survival: alive wins over dead |
| 2nd | Score: higher food count wins |
| 3rd | Moves: FEWER moves wins (died earlier = lost, survived longer = win) |
| **Tie** | If ALL equal (both die same move, same score, same moves) → **DRAW**, no payouts |

---

## Round State Fields (from 001)

```rust
struct Round {
    round_id: u64,
    status: RoundStatus,
    winner: Option<AIChoice>,
    
    // Board
    alpha_board: Vec<Vec<u8>>,
    beta_board: Vec<Vec<u8>>,
    
    // Snakes
    alpha_score: u32,
    beta_score: u32,
    alpha_alive: bool,
    beta_alive: bool,
    move_count: u32,
    
    // Pools
    alpha_pool: u64,
    beta_pool: u64,
    
    // Time
    start_time: i64,
    end_time: Option<i64>,
}
```

---

## Edge Cases

- **Draw:** Both snakes die same move → no winner
- **No bets:** Game plays anyway, house keeps nothing
- **One-sided:** All bets on one side → game still plays
- **Max moves:** If no winner after N moves → higher score wins, else draw
- **Food spawn:** Never spawns on Alpha OR Beta body

---

## CTO Review Issues (Fixed)

**1. Draw → Added explicit Draw outcome**
**2. Max moves → Set MAX_MOVES = 500**
**3. Food spawn → Now specifies "either snake"**
**4. Determinism → AI must be pure functions, no Clock**

**Score after fixes: 8/10** ✅ Approved

---

## CTO Review

**Score: 8/10**

✅ Covers all from PM input
✅ Win condition matches 001 spec
✅ AI strategies clearly defined
✅ Edge cases handled

**Comments:**

- Board size 20x20 is reasonable
- Need to define max moves limit in execute_move
- Consider adding board initialization in create_round

Approved for implementation.


> Codex note (2026-02-25): Game logic is implemented and validated on devnet (`anchor test`: 4 passing), including deterministic move loop and winner resolution.
