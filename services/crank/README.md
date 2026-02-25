# Crank Service

24/7 round orchestrator for Magic Bet.

## Setup

```bash
cp services/crank/.env.example services/crank/.env
yarn crank:install
yarn crank:build
```

`ANCHOR_WALLET` defaults to `~/.config/solana/id.json` in `.env.example`.

Startup guards (hard-fail on mismatch):

- `PROGRAM_ID` must match IDL program id
- program must be executable on both `L1_RPC_URL` and `ER_RPC_URL`
- `ER_VALIDATOR` must match ER RPC identity
- wallet must have minimum balance on both L1 and ER

## Run (local)

```bash
yarn crank:dev
```

Health endpoints:

- `GET /healthz`
- `GET /status`

WebSocket endpoint:

- `ws://<host>:<PORT><WS_PATH>` (default `ws://localhost:8787/ws`)
- Client message: `{"type":"subscribe","topic":"round:<round_id>"}`
- Server events:
  - `round_state_v1`
  - `round_transition_v1`
  - `snapshot_v1` (sent on subscribe/reconnect)

Quick smoke test:

```bash
yarn crank:ws-smoke
```

Optional args:

```bash
yarn --cwd services/crank ws:smoke -- --round-id 42
yarn --cwd services/crank ws:smoke -- --status-url http://127.0.0.1:8787/status --ws-url ws://127.0.0.1:8787/ws
```

## Lifecycle

Canonical round flow in the crank:

`create_round -> betting_open -> close_betting -> delegate_round -> game_loop -> settle_and_undelegate -> cleanup`

Cleanup policy:

- close losing bets immediately
- close winning bets only if already claimed
- sweep vault after close-bet pass

Round timing log emitted at cleanup:

- `bettingWindowMs`
- `gameDurationMs`
- `settleDurationMs`
- `totalRoundMs`

## Run (VPS with PM2)

```bash
yarn crank:build
pm2 start services/crank/ecosystem.config.cjs
pm2 save
```
