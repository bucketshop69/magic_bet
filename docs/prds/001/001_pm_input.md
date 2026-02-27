# PM Input: Anchor Program (001_ix_list.md)

## 1. User Stories

### Betting

- As a player, I want to place a bet on Alpha or Beta so that I can win SOL if my chosen AI wins
- As a player, I want to bet any amount between 0.01-1 SOL so that I can control my risk
- As a player, I want to see the current pool sizes before betting so I can make an informed choice
- As a player, I want to bet only while the round is Active so I can't bet after betting closes

### Rounds

- As a player, I want to watch a new round start with a fresh board so the game is fair each time
- As a player, I want to know the round status (Active/InProgress/Settled) so I understand what's happening
- As a player, I want to see the winner determined by survival + score so the outcome is transparent

### Claiming

- As a player, I want to claim my winnings (2x) after my AI wins so I get my payout
- As a player, I want to claim only once per winning bet so I can't double-claim
- As a player, I want to know if my bet lost so I understand why I didn't win

---

## 2. Key Edge Cases MUST Handle

1. **Bet after round closes** — Reject: betting window must be enforced
2. **Claim for lost bet** — Reject: only winners can claim
3. **Claim twice** — Reject: track `claimed` flag on Bet PDA
4. **Bet zero or negative amount** — Reject: validate amount > 0
5. **Bet exceeds house balance** — Reject: house must have enough to pay out
6. **Both AIs die same move** — Winner: higher score wins; if tied, fewer moves wins (survived longer)
7. **No bets on a round** — Allow: round still plays, house keeps nothing
8. **All-in on one side** — Handle: other side has 0 pool, but game still runs
9. **Execute move after game already over** — Reject: check status before processing
10. **User tries to create round twice with same ID** — Reject: use unique round_id
11. **Delegation fails or reverts** — Handle: clean state, allow retry
12. **Settlement with no winner (draw)** — Handle: no payouts, bets stay in vault

---

## 3. On-Chain vs Off-Chain Data

### MUST Be On-Chain (Anchor Program)

- Round state: `round_id`, `status`, `winner`, `alpha_score`, `beta_score`, `alpha_alive`, `beta_alive`, `move_count`
- Bet records: `ai_choice`, `amount`, `claimed` flag (per user per round)
- Pool totals: `alpha_pool`, `beta_pool`
- Config: admin pubkey
- House vault: SOL balance for payouts
- Timestamps: `start_time`, `duration`

### CAN Be Off-Chain (Tapestry / Frontend)

- User profiles (username, avatar, bio)
- Social graph (followers/following)
- Leaderboard rankings (computed from on-chain stats)
- Historical round data for UI (past rounds list)
- AI strategy descriptions/explainers
- Real-time board animation (streamed via WebSocket, not stored on-chain)
- Game metadata (current active round ID, next round countdown)

### Rationale

- On-chain = anything that affects money (bets, payouts, winner determination)
- Off-chain = social features, UI convenience, data that doesn't affect payouts
- Board state moves to ER during play, commits to L1 on settle — players see live via WebSocket, final state on-chain
