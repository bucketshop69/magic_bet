# 001_ix_list.md — Magic Bet Anchor Program

Single source of truth for Solana/Anchor program design.

---

## Instructions

| Name | Params | Accounts | Logic |
|------|--------|----------|-------|
| `initialize` | `fund_amount: u64` | Config (new), House (new) | Initialize program + fund house vault (admin) |
| `delegate_admin` | - | Config | Admin delegates authority to agent (run once on L1) |
| `create_round` | `round_id: u64`, `duration: i64` | Config, Round (new) | Create new round (admin OR agent) |
| `close_betting` | `round_id: u64` | Config, Round | Close betting window, transition to InProgress |
| `delegate_round` | `round_id: u64` | Config, Round | Delegate round to Execution Runtime (after close_betting) |
| `place_bet` | `round_id: u64`, `choice: AIChoice`, `amount: u64` | Config, Round, Bet (new), User, Vault | Place bet on L1; create/top-up bet, transfer user SOL to vault |
| `execute_move` | `round_id: u64` | Config, Round | Execute one AI move (called by ER crank); validate round InProgress |
| `settle_and_undelegate` | `round_id: u64` | Config, Round | Settle round (determine winner), undelegate from ER |
| `claim_winnings` | `round_id: u64` | Config, Round, Bet, User, Vault | Claim 2x payout if bet won; mark claimed |
| `close_bet` | `round_id: u64`, `user: Pubkey` | Bet | Close bet account after round settled |

---

## PDA Accounts

| Account | Seeds | Description |
|---------|-------|-------------|
| `Config` | `["config_v2"]` | Global program config: admin pubkey, current round_id, vault bump |
| `House` | `["house_v2"]` | SOL vault for payouts, funded by admin |
| `Round` | `["round_v2", round_id]` | Round state: status, winner, scores, alive flags, move_count, pools, timestamps |
| `Bet` | `["bet_v2", round_id, user]` | Per-user per-round bet: choice, amount, claimed flag |
| `Vault` | `["vault_v2", round_id]` | Holds user SOL per round, never delegated |

---

## Enums

### RoundStatus
```
Active    // Betting open
InProgress // Game playing (delegated to ER)
Settled   // Round complete, winner determined
```

### AIChoice
```
Alpha
Beta
Draw // When both AIs die same move
```

---

## Structs

### Config
```rust
pub struct Config {
    pub admin: Pubkey,           // Original admin (can reclaim if needed)
    pub agent: Option<Pubkey>,   // Delegated agent (crank/automation)
    pub round_id: u64,           // Current/next round ID
    pub house_bump: u8,          // PDA bump for house
    pub vault_bump: u8,          // PDA bump for vault
    pub house_fee_bps: u16,      // House fee in basis points (default: 0)
}
```

### Round
```rust
pub struct Round {
    pub round_id: u64,
    pub status: RoundStatus,
    pub winner: Option<AIChoice>,
    
    // AI State - flat arrays for size efficiency (20x20 = 400 bytes)
    pub alpha_board: [u8; 400],  // Flat 1D array, index = y * 20 + x
    pub beta_board: [u8; 400],
    pub alpha_seed: u64,         // Seed for deterministic "random" (food spawn, etc)
    pub beta_seed: u64,
    pub alpha_score: u32,
    pub beta_score: u32,
    pub alpha_alive: bool,
    pub beta_alive: bool,
    pub move_count: u32,
    
    // Pool Totals (in lamports)
    pub alpha_pool: u64,
    pub beta_pool: u64,
    
    // Timestamps
    pub start_time: i64,
    pub end_time: Option<i64>,
    
}
```

### Bet
```rust
pub struct Bet {
    pub round_id: u64,
    pub user: Pubkey,
    pub choice: AIChoice,
    pub amount: u64,           // In lamports
    pub claimed: bool,
}
```

### House
```rust
pub struct House {
    pub bump: u8,             // PDA bump
    // Balance stored in lamports (PDA holds SOL)
}
```

### Vault
```rust
pub struct Vault {
    pub round_id: u64,
    pub bump: u8,
    // Balance stored in lamports
}
```

---

## Technical Constraints

- **Anchor Version:** 0.32.1
- **Max Account Size:** 10KB per account
- **Determinism:** On-chain AI must be fully deterministic; no `Clock` in move logic
- **Determinism Rule:** All AI decisions based ONLY on board state + seed. No external calls.
- **Math:** All values in u64 (lamports, scores); no floats
- **Ticks:** 100ms ER cadence; `execute_move` must be lean
- **Account Size:** Round ≈ 850 bytes (400 + 400 boards + fields), well under 10KB

---

## Edge Cases Handled

1. **Bet after round closes** → Reject: betting window enforced via status check
2. **Claim for lost bet** → Reject: validate winner matches choice
3. **Claim twice** → Reject: `claimed` flag checked
4. **Bet zero/negative** → Reject: validate amount > 0
5. **Bet exceeds house balance** → Reject: check house solvency before accepting bet
6. **Both AIs die same move** → Winner: higher score wins; if tied, fewer moves wins
7. **No bets on round** → Allow: round plays, house keeps nothing
8. **All-in on one side** → Handle: other side has 0 pool, game still runs
9. **Execute after game over** → Reject: status check before processing
10. **Duplicate round ID** → Reject: unique sequential round_id from Config
11. **Delegation fails** → Handle: clean state, allow retry
12. **Settlement draw** → Handle: no payouts, bets stay in vault

---

## On-Chain vs Off-Chain

### MUST Be On-Chain
- Round state (`round_id`, `status`, `winner`, scores, alive flags, move_count)
- Bet records (`ai_choice`, `amount`, `claimed` per user per round)
- Pool totals (`alpha_pool`, `beta_pool`)
- Config (admin pubkey)
- House vault (SOL balance)
- Timestamps (`start_time`, `duration`)

### CAN Be Off-Chain (Tapestry / Frontend)
- User profiles (username, avatar)
- Social graph (followers/following)
- Leaderboard rankings
- Historical round data
- Real-time board animation (WebSocket, not on-chain)
- Game metadata

---

## MVP Scope

| MVP | Nice-to-Have |
|-----|--------------|
| Alpha/Beta AI strategies | Additional AI strategies |
| `place_bet`, `execute_move`, `claim_winnings` | Parlay, odds betting |
| House model (2x payout fixed) | Dynamic odds |
| Basic round state | Replays, board snapshots |
| Manual crank (admin script) | Auto-crank |
| Basic profile | Tapestry integration |
| Simple leaderboard | Weekly/daily filters |
| Blink GET | Blink POST |


> Codex note (2026-02-25): Implemented and validated on devnet (`anchor test`: 4 passing). Final flow: `place_bet` + `close_betting` on L1, then `delegate_round` and ER game loop/settle.
