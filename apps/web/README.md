# Magic Bet Web (Pass A)

Functional-first web UI for hackathon validation.

## Features

- Phantom connect/disconnect
- Live round stream via crank WebSocket (`round_state_v1`, `round_transition_v1`, `snapshot_v1`)
- Dual 20x20 snake boards
- L1 `place_bet` flow
- L1 `claim_winnings` flow
- Runtime status/event panel

## Setup

```bash
cp apps/web/.env.example apps/web/.env
yarn web:install
```

## Run

```bash
yarn web:dev
```

## Build

```bash
yarn web:build
```
