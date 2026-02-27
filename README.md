# 🎰 Magic Bet

### Two AIs play snake. You bet for the winner.

Magic Bet is a real-time betting game where players wager SOL on which AI wins a live Snake battle — powered by **MagicBlock Ephemeral Rollups** for sub-second game moves, fully transparent on-chain AI logic, and a social reputation layer via **Tapestry**.

Built for the **Graveyard Hackathon 2026**.

---

## 🎬 How It Works

1. **Round opens** — A new Snake board is initialized on-chain. Betting window begins.
2. **Players bet** — Pick **AI Alpha** (aggressive) or **AI Beta** (defensive). SOL goes into a round vault.
3. **Betting closes** — No new bets accepted. Round is delegated to MagicBlock ER.
4. **Game plays** — The crank executes moves on ER every ~100ms. Both snakes battle in real-time.
5. **Round settles** — Winner determined. State committed back to Solana L1.
6. **Winners claim** — 2× payout from the house vault on L1.

---

## 🧬 The AIs

Both AI strategies are implemented **directly in the Anchor program** — fully transparent, fully deterministic, zero off-chain computation.

- **Alpha** 🔵 — One of two battling snake AIs
- **Beta** 🟠 — One of two battling snake AIs

Neither AI always wins — that's what makes betting interesting.

**Winner resolution:** Survival first → higher score → fewer moves → draw (no payouts).

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Solana L1                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│  │ Config   │  │  House   │  │  Vault   │  │   Bet      │  │
│  │   PDA    │  │   PDA    │  │   PDA    │  │   PDA      │  │
│  └──────────┘  └──────────┘  └──────────┘  └────────────┘  │
│                                                             │
│  Instructions: initialize, create_round, place_bet,         │
│  close_betting, claim_winnings, close_bet, sweep_vault      │
└──────────────────────┬──────────────────────────────────────┘
                       │ delegate / undelegate
┌──────────────────────▼──────────────────────────────────────┐
│                  MagicBlock Ephemeral Rollups                │
│  ┌──────────┐                                               │
│  │  Round   │  ← delegated for fast game execution          │
│  │   PDA    │                                               │
│  └──────────┘                                               │
│                                                             │
│  Instructions: execute_move, settle_and_undelegate          │
│  Cadence: ~100ms per move                                   │
└──────────────────────┬──────────────────────────────────────┘
                       │ websocket broadcast
┌──────────────────────▼──────────────────────────────────────┐
│                    Crank Service (Node.js)                   │
│  Round lifecycle orchestrator + embedded WebSocket gateway   │
│  Events: round_state_v1, round_transition_v1, snapshot_v1   │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│                     Web Client (Vite)                        │
│  Phantom wallet connect • live dual snake boards            │
│  place_bet on L1 • claim_winnings on L1                     │
│  LCD/retro design system                                    │
└─────────────────────────────────────────────────────────────┘
```

### Layer Split

| Layer  | Instructions                                                               | Purpose                            |
| ------ | -------------------------------------------------------------------------- | ---------------------------------- |
| **L1** | `place_bet`, `close_betting`, `claim_winnings`, `close_bet`, `sweep_vault` | Value movement & account lifecycle |
| **ER** | `execute_move`, `settle_and_undelegate`                                    | Data-only gameplay execution       |

> ER path does **not** create accounts or move user lamports.

---

## 🛠️ Technology Stack

| Layer             | Technology                                                             |
| ----------------- | ---------------------------------------------------------------------- |
| Solana Program    | Anchor 0.32.1                                                          |
| Ephemeral Rollups | MagicBlock ER SDK (`@magicblock-labs/ephemeral-rollups-sdk`)           |
| AI Engine         | On-chain deterministic Snake engine (20×20 grid, 400 cells per board)  |
| Crank Service     | Node.js / TypeScript — round lifecycle, game loop, WebSocket broadcast |
| Web Client        | Vite + TypeScript — Phantom wallet, live boards, L1 transactions       |
| Social Layer      | Tapestry REST API — profiles, follows, leaderboard (planned)           |
| Blinks            | Solana Actions spec for shareable betting links (planned)              |
| Mobile App        | React Native + Expo (planned)                                          |
| Wallet            | Phantom (web), Mobile Wallet Adapter (mobile)                          |
| Network           | Solana Devnet (L1) + MagicBlock ER endpoint                            |

---

## 📁 Project Structure

```
magic_bet/
├── programs/
│   └── magic_bet/              # Anchor program (Rust)
│       └── src/lib.rs          # All instructions, state, AI logic
├── services/
│   └── crank/                  # Round lifecycle crank + WS gateway
│       ├── src/
│       │   ├── core/           # Orchestrator + phase handlers
│       │   ├── chain/          # L1 & ER clients
│       │   ├── ws/             # WebSocket server + events
│       │   ├── config/         # Env parsing
│       │   ├── state/          # Runtime store + recovery
│       │   ├── infra/          # Logger, retry, backoff
│       │   └── api/            # Health endpoints
│       └── scripts/            # ws-smoke test
├── apps/
│   └── web/                    # Vite web client
│       └── src/
│           ├── components/     # UI kit (Panel, LcdButton, boards)
│           ├── features/       # Wallet, round, betting logic
│           ├── theme/          # Design tokens
│           ├── types/          # Contracts & event types
│           └── lib/            # Adapters, state mapping, config
├── tests/
│   └── magic_bet.ts            # Anchor integration tests (4 passing)
├── docs/
│   ├── MAGIC_BET_PRD.md        # Master PRD
│   ├── ux_flow.md              # Finalized UX/runtime flow
│   └── prds/                   # Detailed component PRDs (001–013)
├── Anchor.toml
├── Cargo.toml
├── package.json
└── CHANGELOG.md
```

---

## ⚙️ On-Chain Program

**Program ID:** `DXaehEyGPBunzm3X5p3tCwcZVhx9dX8mnU7cfekvm5D2`

### PDA Accounts

| Account | Seeds                        | Description                                        |
| ------- | ---------------------------- | -------------------------------------------------- |
| Config  | `["config_v2"]`              | Global config: admin, agent, round_id, house fee   |
| House   | `["house_v2"]`               | SOL vault for payouts, funded by admin             |
| Round   | `["round_v2", round_id]`     | Round state: boards, scores, status, winner, pools |
| Bet     | `["bet_v2", round_id, user]` | Per-user per-round bet record                      |
| Vault   | `["vault_v2", round_id]`     | Holds user SOL per round (never delegated)         |

### Instructions

| Instruction                           | Layer | Description                              |
| ------------------------------------- | ----- | ---------------------------------------- |
| `initialize(fund_amount)`             | L1    | Create Config + fund House (admin only)  |
| `delegate_admin(agent)`               | L1    | Delegate authority to crank agent        |
| `create_round(round_id, duration)`    | L1    | Initialize new round, status: Active     |
| `place_bet(round_id, choice, amount)` | L1    | Create/top-up bet, transfer SOL to vault |
| `close_betting(round_id)`             | L1    | Transition to InProgress, block new bets |
| `delegate_round(round_id)`            | L1→ER | Delegate Round PDA to MagicBlock ER      |
| `execute_move(round_id)`              | ER    | Run one AI move for both snakes          |
| `settle_and_undelegate(round_id)`     | ER→L1 | Determine winner, commit + undelegate    |
| `claim_winnings(round_id)`            | L1    | 2× payout from House to winner           |
| `close_bet(round_id, user)`           | L1    | Close bet PDA, return rent               |
| `sweep_vault(round_id)`               | L1    | Move remaining vault SOL to House        |

### House Model

Players bet against the house, not each other:

- **Instant bets** — no waiting for a counterparty
- **Guaranteed liquidity** — House PDA funded at initialization
- **Win = 2× payout** from House
- **Lose = bet stays** in vault (swept to House after settlement)
- **Bet range:** 0.01 – 1 SOL

---

## 🚀 Getting Started

### Prerequisites

- [Rust](https://rustup.rs/) + [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools)
- [Anchor CLI 0.32.1](https://www.anchor-lang.com/docs/installation)
- [Node.js 18+](https://nodejs.org/) + Yarn
- Solana devnet keypair at `~/.config/solana/id.json`
- [Phantom Wallet](https://phantom.app/) browser extension (for web client)

### 1. Build & Test the Program

```bash
# Install dependencies
yarn install

# Build the Anchor program
anchor build

# Run integration tests (4 passing on devnet)
anchor test
```

### 2. Run the Crank Service

```bash
# Install crank dependencies
yarn crank:install

# Configure environment
cp services/crank/.env.example services/crank/.env
# Edit .env with your RPC URLs, program ID, and wallet path

# Run in development mode
yarn crank:dev

# Or build and run production
yarn crank:build
yarn crank:start
```

The crank exposes:

- **Health:** `GET /healthz` → `ok | degraded`
- **Status:** `GET /status` → current phase, round ID, timing metrics
- **WebSocket:** game state streaming on connect

### 3. Run the Web Client

```bash
# Install web dependencies
yarn web:install

# Configure environment
cp apps/web/.env.example apps/web/.env
# Edit .env with crank WS URL and program ID

# Start dev server
yarn web:dev
```

Open `http://localhost:5173` — connect Phantom, watch live snake battles, place bets.

### 4. WebSocket Smoke Test

```bash
yarn crank:ws-smoke
```

---

## 🔄 Round Lifecycle

```
initialize(fund_amount)           ─── one-time setup
delegate_admin(agent)             ─── one-time setup
    │
    ▼
create_round(id, duration)  ──→  Active (betting open)
    │
    ▼
place_bet(round_id, choice, amt)  ──→  users bet on L1
    │
    ▼
close_betting(round_id)     ──→  InProgress (no more bets)
    │
    ▼
delegate_round(round_id)   ──→  Round PDA → ER
    │
    ▼
execute_move(round_id) × N  ──→  game plays at ~100ms on ER
    │
    ▼
settle_and_undelegate(round_id) ──→  Settled, back to L1
    │
    ▼
claim_winnings(round_id)    ──→  winners claim 2× on L1
    │
    ▼
close_bet + sweep_vault     ──→  cleanup, then next round
```

---

## 📡 WebSocket Events

The crank broadcasts real-time game state via WebSocket:

| Event                 | Description                                                          |
| --------------------- | -------------------------------------------------------------------- |
| `round_state_v1`      | Full board state after each move (scores, alive flags, 20×20 boards) |
| `round_transition_v1` | Phase changes (Active → InProgress → Settled)                        |
| `snapshot_v1`         | Full state on subscribe/reconnect                                    |

Subscribe to topic `round:<round_id>` for live updates.

---

## 🎮 Game Engine

- **Grid:** 20×20 (400 cells per board), cell values: 0=Empty, 1=Snake, 2=Food
- **Determinism:** All AI decisions based only on board state + seed — no `Clock`, no external calls
- **Food:** One item at a time, respawns on empty cell when eaten
- **Max moves:** 500 (auto-settle if reached)
- **Fairness:** Symmetric opening state with mirrored starts, shrinking wall phase for late-game resolution
- **Latest simulation:** Alpha 237 / Beta 241 / Draw 22 over 500 rounds

---

## 📋 Documentation

Detailed PRDs live in `docs/prds/`:

| PRD                                                  | Topic                             | Status         |
| ---------------------------------------------------- | --------------------------------- | -------------- |
| [001](docs/prds/001/001_ix_list.md)                  | Instruction List & Program Design | ✅ Implemented |
| [002](docs/prds/002/002_er_poc_prd.md)               | Ephemeral Rollups POC             | ✅ Validated   |
| [003](docs/prds/003/003_game_logic.md)               | Game Logic (Snake AI)             | ✅ Implemented |
| [004](docs/prds/004/004_betting.md)                  | Betting Logic                     | ✅ Implemented |
| [005](docs/prds/005/005_round_lifecycle.md)          | Round Lifecycle                   | ✅ Implemented |
| [006](docs/prds/006/006_admin_house.md)              | Admin & House                     | ✅ Implemented |
| [007](docs/prds/007/007_er_integration.md)           | ER Integration Details            | ✅ Implemented |
| [008](docs/prds/008/008_tapestry.md)                 | Tapestry Social Layer             | 🔲 Pending     |
| [009](docs/prds/009/009_crank_orchestrator.md)       | Crank Orchestrator                | ✅ Implemented |
| [010](docs/prds/010/010_realtime_socket_gateway.md)  | Realtime Socket Gateway           | ✅ In Progress |
| [011](docs/prds/011/011_expo_core_app.md)            | Expo Core App                     | 🔲 Planned     |
| [012](docs/prds/012/012_final_ui_ux.md)              | Final UI/UX Polish                | 🟡 Partial     |
| [013](docs/prds/013/013_game_fairness_simulation.md) | Game Fairness Simulation          | 🔲 Planned     |

Additional docs:

- [Master PRD](docs/MAGIC_BET_PRD.md) — full product specification
- [UX Flow](docs/ux_flow.md) — finalized end-to-end runtime flow

---

## 🗺️ Roadmap

| Milestone | Status |
|-----------|--------|
| 1. On-chain program (Anchor + ER) | ✅ Done — 4 tests passing on devnet |
| 2. Crank service (24/7 round automation) | ✅ Done |
| 3. WebSocket gateway (live game streaming) | ✅ Done (embedded in crank) |
| 4. Web client (wallet + live boards + betting) | ✅ Done (Pass A) |
| 5. UI/UX polish (LCD design system) | ✅ Done |
| 6. Social + Tapestry integration | 🔲 Planned |
| 7. Blinks API (bet directly from a tweet) | 🔲 Planned |
| 8. Expo mobile app | ✅ Done |
| 9. Game fairness simulation | ✅ Done |

---

## 📄 License

ISC
