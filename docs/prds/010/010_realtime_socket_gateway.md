# 010 — Realtime Socket Gateway (Crank -> App Bridge)

> Status (2026-02-25): In progress. Implemented inside `services/crank/src/ws/*` as single-process gateway with subscribe/snapshot/round-state/transition broadcasts.

## Overview

This PRD defines the realtime bridge that streams round/game state to clients.

The crank publishes authoritative state snapshots after every move; the app subscribes and renders live grids without polling RPC every frame.

---

## Goal

Deliver low-latency, reliable game state updates to mobile clients:

- Broadcast every move update
- Maintain ordering by `move_count`
- Support reconnect + resync
- Keep payloads stable/versioned

---

## Scope

### In Scope

- WebSocket server (same VPS as crank)
- Room/topic model per round
- Event schema and versioning
- Reconnect and snapshot replay
- Rate-limited broadcast

### Out of Scope

- Wallet signing
- Betting transactions
- Social feed (Tapestry layer)

---

## Proposed Folder Structure

```text
services/
  gateway/
    package.json
    tsconfig.json
    src/
      index.ts                    # websocket server bootstrap
      config/
        env.ts
      ws/
        server.ts                 # ws server + lifecycle
        rooms.ts                  # round:<id> topic management
        protocol.ts               # event schema/types
        serializers.ts            # payload shaping/versioning
        guards.ts                 # message validation/rate limits
      bridge/
        crankSubscriber.ts        # receives updates from crank
        broadcaster.ts            # fan-out to subscribed clients
      api/
        health.ts                 # /healthz, /status
      infra/
        logger.ts
```

If crank and gateway run as one process initially, keep this layout under `services/crank/src/ws/*` and split later when needed.

---

## Transport

- Protocol: WebSocket
- Server host: crank service process (same deployment unit)
- Client: Expo app (single active round subscription)

---

## Channel Model

- Topic key: `round:<round_id>`
- Client subscribes to active round topic.
- Server can push global status topic (`system:status`) optionally.

---

## Event Contract

### `round_state_v1` (primary event)

```json
{
  "type": "round_state_v1",
  "ts": 1771982486000,
  "roundId": "42",
  "status": "InProgress",
  "moveCount": 117,
  "winner": null,
  "alphaScore": 8,
  "betaScore": 7,
  "alphaAlive": true,
  "betaAlive": true,
  "alphaBoard": [0,2,0, ... 400 cells],
  "betaBoard": [0,0,3, ... 400 cells]
}
```

### `round_transition_v1` (phase changes)

```json
{
  "type": "round_transition_v1",
  "ts": 1771982486000,
  "roundId": "42",
  "from": "BettingOpen",
  "to": "InProgress"
}
```

### `snapshot_v1` (on subscribe/reconnect)

- Full latest state for current round.
- Sent immediately after successful subscribe.

---

## Ordering + Consistency Rules

1. `moveCount` is monotonic.
2. Client discards any event where `moveCount <= localMoveCount`.
3. Server broadcasts only after chain-confirmed state read.
4. One authoritative publisher: crank.

---

## Reconnect Strategy

1. Client reconnects with backoff.
2. Client re-subscribes to `round:<id>`.
3. Server sends `snapshot_v1`.
4. Client continues from latest `moveCount`.

---

## Performance Targets

- Broadcast latency target: <300ms from move confirmation.
- Sustain 100ms game cadence without event backlog.
- Support at least 500 concurrent subscribers in hackathon demo profile.

---

## Security / Abuse Controls

- Validate subscribe payload shape.
- Rate limit connection attempts per IP.
- Enforce max subscriptions per socket.
- Optional read-only auth token gate for production.

---

## Success Criteria

1. Home screen can animate both 20x20 boards live from WS only.
2. Reconnect resumes state without app restart.
3. No visible move jitter from out-of-order events.
4. Socket service survives crank restart and continues streaming.

---

## CTO Acceptance

**Target Score: 9/10**

Must pass:
- stable event contract
- ordering correctness
- reconnect correctness
- operationally simple deployment with crank
