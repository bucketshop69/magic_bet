# EM Input: 001_ix_list.md

## 1. Technical Constraints (Solana/Anchor)

- **Anchor 0.32.1** — current version, stable
- **Max instruction size** — keep each ix simple; complex game logic in internal functions
- **CPIs** — can call into ER, but keep cross-program calls minimal for speed
- **Account data** — 10KB max per account; Round account fits (board state ~500 bytes)
- **Ticks** — 100ms ER cadence is aggressive; execute_move must be lean (no logging, no complex checks)
- **Determinism** — on-chain AI must be fully deterministic; no `Clock` in move logic, only board state
- **No floats** — all math in u64 (lamports, scores)

## 2. Instruction Dependencies

```
initialize (admin)
    │
    ▼
create_round ──► delegate_round ──► (ER phase)
    │                                    │
    │  (L1 side)                    execute_move (xN)
    │                                    │
    ▼                                    ▼
place_bet ◄────────────────────── settle_and_undelegate
    │                                    │
    │                                    ▼
    └──── close_betting ──────► claim_winnings (L1)
```

**Critical path:**

1. `initialize` → `create_round(0)` → `delegate_round()` — must run before any betting
2. `place_bet` → `close_betting` → `execute_move` (N times) → `settle_and_undelegate` → `claim_winnings`

## 3. MVP vs Nice-to-Have

| MVP | Nice-to-Have |
|-----|--------------|
| Alpha/Beta AI (both strategies) | Additional AI strategies |
| place_bet, execute_move, claim_winnings | Advanced betting (parlay, odds) |
| House model (2x payout fixed) | Dynamic odds, house risk management |
| Basic round state | Replays, board snapshots |
| Manual crank (admin script) | Auto-crank with decentralization |
| Basic profile (username) | Full Tapestry integration, follows, feed |
| Leaderboard (simple ranking) | Weekly/daily filters, streaks |
| Blink GET (view round) | Blink POST (full bet from link) |

## 4. Suggested Build Order

1. **Anchor program core** — Round, Bet, Config accounts + initialize, create_round
2. **execute_move** — full Snake logic + winner determination (the hardest ix)
3. **place_bet + claim_winnings** — vault flows
4. **delegate/settle wrappers** — ER integration points
5. **Crank script** — minimal version that calls ix in sequence
6. **Blinks GET** — round metadata display
7. **Blinks POST** — full bet tx building (stretch)

Start with #1-3. Everything else builds on working game logic.
