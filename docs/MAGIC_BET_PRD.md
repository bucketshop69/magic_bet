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
| Ephemeral Rollups | MagicBlock ER — delegate, place_bet, game moves, settle_and_undelegate |
| AI Engine | On-chain Snake logic in Anchor program — fully transparent, public code |
| Social Layer | Tapestry REST API — profiles, follows, leaderboard |
| Blinks | Next.js API routes implementing Solana Actions spec |
| Mobile App | React Native + Expo (iOS & Android) |
| Wallet | Mobile Wallet Adapter (Phantom, Solflare) |
| RPC | Magic Router devnet — auto-routes L1 vs ER |
| Round Crank | Node.js admin script — auto manages round lifecycle + AI moves |

---

## 4. Core Features

### 4.1 The AIs

Two AI agents, both with fully public on-chain code. Players can read exactly how each one makes decisions before betting:

- **AI Alpha** — aggressive strategy. Always moves toward the nearest food. High risk, high score potential, dies faster.
- **AI Beta** — defensive strategy. Prioritizes avoiding walls and its own tail. Lower score ceiling, survives longer.

The tension between strategies is what makes betting interesting. Neither AI always wins.

### 4.2 Game Loop

1. Round **OPENS** — New Snake board initialized on-chain. Betting window begins for X minutes.
2. Players **BET** — Pick Alpha or Beta. SOL goes into vault PDA. Bet recorded in Ephemeral Rollup.
3. Round **CLOSES** — Betting window ends. No new bets accepted. Game begins.
4. Game **PLAYS** — Round crank sends AI move transactions to ER every 100ms. Board state updates in real-time. Game runs for X minutes or until one snake dies.
5. Round **SETTLES** — Winner determined by survival + score. State committed back to L1.
6. Winners **CLAIM** — 2x payout from house vault on L1.

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
- Confirm button → triggers `place_bet` tx on ER
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
| Config PDA | `["config"]` | Stores admin pubkey. Created once at init. |
| House PDA | `["house"]` | SOL vault for payouts. Funded by admin at init. |
| Round PDA | `["round", round_id]` | Round state: board, scores, move count, status, winner. Delegated to ER during game. |
| Bet PDA | `["bet", round_id, user]` | Per-user per-round record. AI choice (Alpha/Beta), amount, claimed. |
| Vault PDA | `["vault", round_id]` | Holds user SOL per round. Never delegated — stays on L1. |

### 6.2 Round Account Fields

| Field | Type | Description |
|---|---|---|
| `round_id` | u64 | Unique round identifier |
| `alpha_score` | u64 | Alpha snake current score |
| `beta_score` | u64 | Beta snake current score |
| `alpha_alive` | bool | Alpha snake alive status |
| `beta_alive` | bool | Beta snake alive status |
| `move_count` | u64 | Total moves executed so far |
| `alpha_pool` | u64 | Total SOL bet on Alpha |
| `beta_pool` | u64 | Total SOL bet on Beta |
| `winner` | AIChoice | Alpha / Beta / Draw |
| `status` | RoundStatus | Active / InProgress / Settled |
| `start_time` | i64 | Unix timestamp of round start |
| `duration` | i64 | Max game duration in seconds |
| `bump` | u8 | PDA bump |

### 6.3 Instructions

| Instruction | Layer | Description |
|---|---|---|
| `initialize(fund_amount)` | L1 | Creates Config + funds House. Admin only. |
| `create_round(round_id, duration)` | L1 | Creates Round PDA. Initializes board state. Status: Active. |
| `delegate_round()` | L1 → ER | Delegates Round PDA to MagicBlock ER. |
| `place_bet(round_id, amount, ai_choice)` | ER | Creates Bet PDA. Transfers SOL to Vault. Updates Round pools. |
| `close_betting(round_id)` | L1 | Sets Round status: InProgress. Blocks new bets. Game begins. |
| `execute_move(round_id)` | ER | Runs one move for both AIs. Updates board state. Checks win condition. |
| `settle_and_undelegate(round_id)` | ER → L1 | Determines winner from final scores. Commits + undelegates Round to L1. |
| `claim_winnings(round_id)` | L1 | Checks Bet won, not claimed. Sends 2x from House to user. |

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

---

## 9. Round Crank (Admin Automation)

Node.js script that manages the full round lifecycle:

- **Startup** — calls `initialize()` + `create_round(0)` + `delegate_round()`
- **Every X minutes (close)** — calls `close_betting()` — game begins
- **Every 100ms (game phase)** — calls `execute_move()` on ER endpoint until game ends
- **On game end** — calls `settle_and_undelegate()` on ER
- **Immediately after settle** — calls `create_round(id+1)` + `delegate_round()` for next round
- Handles errors gracefully with exponential backoff retry
- Streams board state via WebSocket to frontend for live animation
- Logs all round results for monitoring

---

## 10. 4-Day Build Plan

| Day | Goals |
|---|---|
| Day 1 | Anchor program with Snake game logic. `execute_move` instruction working. Full round flow on devnet. Round crank script running. |
| Day 2 | Expo app scaffolding. Home screen with live animated snake grids. `place_bet` working in app. Mobile Wallet Adapter integrated. |
| Day 3 | Round result + claim flow. Leaderboard + Profile + AI Lab screens. Blinks API route live on Vercel. Register on dial.to. |
| Day 4 | History screen. Social feed. UI polish. Bug fixes. Demo video. README. Submit. |

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
