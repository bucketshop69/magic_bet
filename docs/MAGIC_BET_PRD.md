# 🎰 Magic Bet

### AI Snake Battle — Bet on Who Wins
>
> Tracks: MagicBlock Gaming · Tapestry Onchain Social · OrbitFlare Blinks

---

## 1. Vision

Magic Bet is a real-time, mobile-first betting game where players bet SOL on which AI wins a live Snake battle — powered by MagicBlock's Ephemeral Rollups for sub-second game moves, fully transparent on-chain AI logic that anyone can read, and a social reputation layer via Tapestry.

**The one-liner:** "Two AIs fight. You pick the winner. Bet from a tweet."

---

## 2. The Problem We're Solving

On-chain games died for three reasons:

- **Too slow** — Solana L1 at 400ms makes real-time games unplayable
- **Too expensive** — fees on every move kill arcade-style UX
- **No social layer** — winning means nothing if nobody sees it

MagicBlock's ER fixes speed and cost. Tapestry fixes social. Magic Bet is the first app where fully transparent, trustless AI agents play a live game on-chain while players bet on the outcome.

---

## 3. Technology Stack

| Layer | Technology |
|---|---|
| Solana Program | Anchor 0.32.1 |
| Ephemeral Rollups | MagicBlock ER — delegate round, execute moves, settle_and_undelegate |
| AI Engine | On-chain deterministic Snake engine (v1). External AI input planned as v2. |
| Social Layer | Tapestry REST API — profiles, follows, leaderboard |
| Blinks | Next.js API routes implementing Solana Actions spec |
| Mobile App | React Native + Expo (iOS & Android) |
| Wallet | Mobile Wallet Adapter (Phantom, Solflare) |
| RPC | Solana Devnet (L1) + MagicBlock ER endpoint |
| Round Crank | Node.js service — round lifecycle, game loop, websocket broadcast |

---

## 4. Core Features

### 4.1 The AIs

Two AI agents, both with fully public on-chain code. Players can read exactly how each one makes decisions before betting:

- **AI Alpha** — aggressive strategy. Always moves toward the nearest food. High risk, high score potential, dies faster.
- **AI Beta** — defensive strategy. Prioritizes avoiding walls and its own tail. Lower score ceiling, survives longer.

The tension between strategies is what makes betting interesting. Neither AI always wins.

### 4.2 Game Loop

1. Round **OPENS** — New Snake board initialized on-chain. Betting window begins for X minutes.
2. Players **BET** — Pick Alpha or Beta on L1. SOL goes into round vault PDA. Bet PDA created/updated on L1.
3. Round **CLOSES** — Betting window ends. No new bets accepted. Round status becomes `InProgress`.
4. Round **DELEGATES** — Round PDA is delegated to ER.
5. Game **PLAYS** — Round crank calls `execute_move` on ER every ~100ms. Board state updates in real-time. Game runs until winner or limit.
6. Round **SETTLES** — `settle_and_undelegate` on ER commits final round state back to L1.
7. Winners **CLAIM** — 2x payout from house vault on L1. Admin/agent runs sweep/cleanup.

### 4.3 House Model

Magic Bet uses a house model — players always bet against the house, not each other.

- No waiting for counterparty — bet instantly anytime
- Guaranteed liquidity — house PDA funded at initialization
- Win = 2x payout from house
- Lose = bet stays in vault (swept to house by admin)

### 4.4 Social & Reputation (Tapestry)

Every player gets an on-chain social profile:

- Username + avatar linked to wallet address
- Public win/loss record — verified on-chain
- Follow other players — see their bets in your feed
- Global leaderboard — ranked by total winnings, win rate, streak
- Real-time bet activity feed from players you follow

### 4.5 Blinks Integration (OrbitFlare)

Every active round generates a shareable Blink URL:

- Format: `https://magicbet.app/blink?round=<round_id>`
- Share on X/Twitter — renders as interactive card with Alpha/Beta buttons
- Anyone with a Solana wallet bets directly from the tweet — no app required
- GET handler returns round metadata, AI strategies, time remaining, pool sizes
- POST handler returns signed `place_bet` transaction ready to execute

---

## 5. Mobile App — Screen by Screen

### Screen 1: Splash / Onboarding

- App logo animation
- Connect Wallet (Mobile Wallet Adapter — Phantom/Solflare)
- Auto-creates Tapestry profile on first connect
- Skip option for browse-only mode

### Screen 2: Home / Active Round

The main game screen — where 80% of time is spent.

- Two Snake grids side by side — Alpha (left) vs Beta (right) — animated live
- Both snakes moving in real-time as ER transactions execute
- Current scores displayed under each grid
- Round timer — countdown to round close (betting phase) then game phase
- Pool sizes — Alpha pool vs Beta pool in SOL
- **Bet Alpha button** (blue) — large, thumb-friendly, bottom left
- **Bet Beta button** (orange) — large, thumb-friendly, bottom right
- Bet amount slider — SOL amount (min 0.01, max 1 SOL)
- My active bet indicator — shows your current position if already bet
- AI strategy tooltips — tap Alpha or Beta name to read their strategy code summary
- Share Round button — generates Blink URL via native share sheet

### Screen 3: Bet Confirmation Modal

- AI: Alpha or Beta with icon
- Amount: X SOL
- Potential payout: 2x = Y SOL
- AI strategy summary — one line reminder of who you're backing
- Confirm button → triggers `place_bet` tx on L1
- Transaction status — pending/confirmed/failed with spinner

### Screen 4: Round Result

- Triggered when round settles
- Full final board state for both AIs
- Big WIN or LOSE indicator with animation
- Winning AI name + final score
- Payout amount if won
- Claim button → triggers `claim_winnings` on L1
- Share Result button — shareable image for social

### Screen 5: History

- List of all past rounds — winning AI, your bet, result
- Filter: All / Won / Lost
- Total stats: rounds played, win rate, total profit/loss
- Alpha vs Beta all-time win record
- Each row tappable — expands to show final board state

### Screen 6: Leaderboard

- Global ranking by total SOL won
- Your rank highlighted
- Columns: rank, username/avatar, wins, total won, win rate
- Tap any player → their profile
- Tabs: All Time / This Week / Today

### Screen 7: Profile

- Avatar + username (Tapestry)
- Wallet address (truncated)
- Stats: total bets, win rate, total won, best streak
- Favorite AI — which one they bet on most
- Recent bets feed — last 10 rounds
- Follow/Unfollow button
- Followers / Following count
- Edit profile (own profile only)

### Screen 8: Social Feed

- Activity feed from players you follow
- Each item: avatar + name + which AI they bet + round result
- Real-time updates via Tapestry polling
- Tap any item → that player's profile

### Screen 9: AI Lab

- Full source code of both AI strategies displayed
- Explains in plain english how each AI makes decisions
- Historical win rate: Alpha vs Beta across all rounds
- Graph of Alpha vs Beta performance over time
- "This is trustless — the code you see is the code that runs on-chain"

---

## 6. On-Chain Architecture

### 6.1 Program Accounts

| Account | Seeds | Description |
|---|---|---|
| Config PDA | `["config_v2"]` | Stores admin/agent and global config. Created once at init. |
| House PDA | `["house_v2"]` | SOL vault for payouts. Funded by admin at init. |
| Round PDA | `["round_v2", round_id]` | Round state: board, scores, move count, status, winner. Delegated to ER during game phase. |
| Bet PDA | `["bet_v2", round_id, user]` | Per-user per-round record. AI choice, amount, claimed. |
| Vault PDA | `["vault_v2", round_id]` | Holds user SOL per round on L1. Not delegated. |

### 6.2 Round Account Fields

| Field | Type | Description |
|---|---|---|
| `round_id` | u64 | Unique round identifier |
| `alpha_score` | u32 | Alpha snake current score |
| `beta_score` | u32 | Beta snake current score |
| `alpha_alive` | bool | Alpha snake alive status |
| `beta_alive` | bool | Beta snake alive status |
| `move_count` | u32 | Total moves executed so far |
| `alpha_board` | `[u8; 400]` | Alpha board cells (20x20 flattened) |
| `beta_board` | `[u8; 400]` | Beta board cells (20x20 flattened) |
| `alpha_pool` | u64 | Total SOL bet on Alpha |
| `beta_pool` | u64 | Total SOL bet on Beta |
| `winner` | Option<AIChoice> | Alpha / Beta / Draw |
| `status` | RoundStatus | Active / InProgress / Settled |
| `start_time` | i64 | Unix timestamp of round start |
| `duration` | i64 | Max game duration in seconds |
| `bump` | u8 | PDA bump |

### 6.3 Instructions

| Instruction | Layer | Description |
|---|---|---|
| `initialize(fund_amount)` | L1 | Creates Config + funds House. Admin only. |
| `create_round(round_id, duration)` | L1 | Creates Round PDA. Initializes board state. Status: Active. |
| `place_bet(round_id, amount, ai_choice)` | L1 | Creates/updates Bet PDA. Transfers SOL to Vault. Updates Round pools. |
| `close_betting(round_id)` | L1 | Sets Round status: InProgress. Blocks new bets. |
| `delegate_round(round_id)` | L1 → ER | Delegates Round PDA to MagicBlock ER after betting closes. |
| `execute_move(round_id)` | ER | Runs one move for both AIs. Updates board state. Checks win condition. |
| `settle_and_undelegate(round_id)` | ER → L1 | Determines winner from final scores. Commits + undelegates Round to L1. |
| `claim_winnings(round_id)` | L1 | Checks Bet won, not claimed. Sends 2x from House to user. |
| `close_bet(round_id, user)` | L1 | Closes bet PDA after round settled (winning bet requires claimed = true). |
| `sweep_vault(round_id)` | L1 | Closes vault to house after round settlement cleanup. |

---

## 7. AI Logic (On-Chain)

Both AI strategies are implemented directly in the Anchor program. Fully transparent, fully deterministic, no off-chain computation.

### Alpha — Aggressive

```
1. Find nearest food on board
2. Calculate shortest path to food
3. Move in that direction
4. If blocked, turn right
5. If still blocked, turn left
6. If all blocked, die
```

### Beta — Defensive

```
1. Check all 4 directions
2. Eliminate any direction that leads to wall or own tail
3. From safe directions, pick the one with most open space
4. If no safe direction exists, move toward food as last resort
5. If all blocked, die
```

Winner is determined by: survival first (alive wins over dead), then score (food collected), then move count (survived longer).

---

## 8. Blinks API Spec

Next.js API route at `/api/actions/bet/[round_id]`:

### GET Response

```json
{
  "title": "Magic Bet — Round #[id]",
  "description": "Alpha vs Beta Snake Battle | Alpha pool: [x] SOL | Beta pool: [x] SOL | [time] to bet",
  "icon": "https://magicbet.app/icon.png",
  "links": {
    "actions": [
      { "label": "Bet Alpha 0.1 SOL", "href": "/api/actions/bet/[id]?ai=alpha&amount=0.1" },
      { "label": "Bet Beta 0.1 SOL", "href": "/api/actions/bet/[id]?ai=beta&amount=0.1" }
    ]
  }
}
```

### POST Handler

- Receives: `account` (user wallet pubkey)
- Builds: `place_bet` transaction with all required accounts
- Returns: base64-encoded transaction for wallet to sign
- Registered on dial.to for X/Twitter unfurling
- Executes on L1 path (betting is not performed on ER)

---

## 9. Round Crank (Admin Automation)

Node.js service that manages the full round lifecycle and runs 24/7:

- **Round management**
  - create round on L1
  - wait betting window
  - close betting on L1
  - delegate round on L1
- **Game execution**
  - execute move loop on ER (~100ms cadence)
  - stop when winner exists or limit reached
  - settle_and_undelegate on ER
- **Cleanup**
  - sweep vault on L1
  - close bet accounts (losing immediately, winning after claim policy)
- Handles retries/idempotency with exponential backoff
- Streams board state via WebSocket to frontend for live animation
- Logs and metrics for monitoring/restart recovery

---

## 10. Build Milestones (Top-Level Tracking)

| Milestone | Goals |
|---|---|
| 1. Crank Service | 24/7 lifecycle automation on VPS: create -> close -> delegate -> execute loop -> settle -> cleanup. |
| 2. WebSocket Bridge | Crank broadcasts round/board updates each move to subscribed clients. |
| 3. Expo Core App | Wallet connect, live home grids, place bet (L1), result + claim flows. |
| 4. Social + Blinks | Tapestry events/profile/leaderboard wiring, Blinks GET/POST API on Vercel. |
| 5. Optional AI v2 | Add external AI decision input path (`execute_move_with_input`) after core stability. |

---

## 11. Submission Checklist

- [ ] GitHub repo — public, clean README, deploy instructions
- [ ] Working demo — devnet, real AI moves, real on-chain game
- [ ] 3-minute video — connect wallet → watch AIs play → bet → settle → claim → leaderboard
- [ ] Blink URL — shareable link working on X/Twitter
- [ ] Expo app — testable on iOS/Android
- [ ] Vercel deploy — Blinks API endpoint live
- [ ] AI Lab screen — shows on-chain strategy code to judges

---

*Magic Bet — Graveyard Hackathon 2026*
