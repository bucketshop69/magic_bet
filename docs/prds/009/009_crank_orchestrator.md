# 009 — Crank Orchestrator (24/7 Round Automation)

## Overview

This PRD defines the Node.js crank service that runs continuously and manages the full round lifecycle with no manual intervention.

The crank is the operational control plane for Magic Bet.

---

## Goal

Automate round progression safely:

1. Create round on L1
2. Wait betting window
3. Close betting on L1
4. Delegate round to ER
5. Execute moves loop on ER
6. Settle + undelegate on ER
7. Sweep vault and cleanup on L1
8. Start next round

---

## Scope

### In Scope

- Round lifecycle state machine
- Tick loop for `execute_move`
- Retry + backoff + idempotency
- Crash recovery on restart
- Basic observability (logs + health endpoint)
- Config-driven timings

### Out of Scope

- Mobile UI
- Social/Tapestry indexing
- Blinks API
- External AI move input (future PRD 014)

---

## Proposed Folder Structure

```text
services/
  crank/
    package.json
    tsconfig.json
    src/
      index.ts                    # process bootstrap
      config/
        env.ts                    # env parsing + validation
      core/
        orchestrator.ts           # round state machine
        phases/
          createRound.ts
          closeBetting.ts
          delegateRound.ts
          gameLoop.ts
          settle.ts
          cleanup.ts
      chain/
        l1Client.ts               # L1 provider/program client
        erClient.ts               # ER provider/program client
        methods.ts                # typed wrappers for program ixs
      state/
        runtimeStore.ts           # in-memory current phase/round
        recovery.ts               # startup recovery logic
      infra/
        logger.ts
        retry.ts
        backoff.ts
      api/
        health.ts                 # /healthz, /status
```

---

## Canonical On-Chain Order (Current Program)

1. `create_round(round_id, duration)` on L1
2. Users place bets via `place_bet` on L1
3. `close_betting(round_id)` on L1
4. `delegate_round(round_id)` on L1
5. `execute_move(round_id)` on ER (repeat)
6. `settle_and_undelegate(round_id)` on ER
7. `sweep_vault(round_id)` on L1
8. `close_bet(round_id, user)` policy-driven cleanup on L1

Notes:

- Crank does not place bets.
- Winning bets must be claimed before `close_bet`.

---

## State Machine

```text
BOOTSTRAP
  -> READY

READY
  -> CREATE_ROUND

CREATE_ROUND
  -> BETTING_OPEN

BETTING_OPEN
  -> CLOSE_BETTING (at deadline)

CLOSE_BETTING
  -> DELEGATE_ROUND

DELEGATE_ROUND
  -> GAME_LOOP

GAME_LOOP
  -> SETTLE (winner set OR max safety ticks reached)

SETTLE
  -> CLEANUP

CLEANUP
  -> READY (next round)
```

---

## Reliability Requirements

1. Idempotent actions

- Re-running a step after timeout must not corrupt lifecycle.

1. Retries

- Retry transient RPC failures with exponential backoff.
- Stop and alert after max retry threshold.

1. Restart recovery

- On startup, detect current round/status from chain and resume correct step.

1. Duplicate move protection

- Read `move_count` before/after each `execute_move`.
- Never submit parallel move tx for same tick.

1. Safety watchdog

- If round stuck in `InProgress` beyond threshold, force settle path.

---

## Config (Env)

- `L1_RPC_URL`
- `ER_RPC_URL`
- `ER_WS_URL`
- `PROGRAM_ID`
- `ER_VALIDATOR`
- `ROUND_DURATION_SECONDS`
- `MOVE_INTERVAL_MS` (target ~100ms)
- `MAX_MOVE_RETRIES`
- `MAX_STEP_RETRIES`
- `STUCK_ROUND_TIMEOUT_MS`
- `LOG_LEVEL`
- `PORT` (health endpoint)

---

## APIs / Process Interfaces

### Internal service interfaces

- `RoundOrchestrator.start()`
- `RoundOrchestrator.stop()`
- `RoundOrchestrator.tick()`
- `RoundOrchestrator.recover()`
- `RoundOrchestrator.getStatus()`

### Health endpoints

- `GET /healthz` -> `ok | degraded`
- `GET /status` -> current phase, round id, retries, last txs

---

## Success Criteria

1. Crank runs 24/7 for at least 24h on devnet.
2. No manual intervention required for round progression.
3. Round transitions follow canonical order.
4. Failed RPC calls recover automatically under retry policy.
5. Logs clearly show lifecycle and tx signatures for every phase.

---

## CTO Acceptance

**Target Score: 9/10**

Must pass:

- deterministic state transitions
- safe recovery on restart
- no duplicate move submission
- production-grade observability baseline
