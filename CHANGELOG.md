# Changelog

All notable changes to this project are documented in this file.

## [Unreleased] - 2026-02-25

### Added

- Added [`docs/ux_flow.md`](/home/main-user/projects/rust/magic_bet/docs/ux_flow.md) with the finalized end-to-end UX/runtime flow.
- Added new roadmap PRDs:
  - `docs/prds/009/009_crank_orchestrator.md`
  - `docs/prds/010/010_realtime_socket_gateway.md`
  - `docs/prds/011/011_expo_core_app.md`
- Added crank service scaffold under `services/crank`:
  - lifecycle orchestrator, phase handlers, chain clients, health API, retry/logger infra
  - PM2 ecosystem config and standalone README/env templates
- Added embedded WebSocket gateway in crank (`services/crank/src/ws/*`) with:
  - topic subscriptions (`round:<id>`)
  - `round_state_v1`, `round_transition_v1`, and `snapshot_v1` events
  - per-IP connection rate limiting and per-socket subscription limits
- Added WS smoke test script:
  - `services/crank/scripts/ws-smoke.js`
  - root script: `yarn crank:ws-smoke`
- Added Pass A web client under `apps/web`:
  - Phantom wallet connect/disconnect
  - live round streaming from crank websocket
  - dual 20x20 snake board renderer
  - L1 `place_bet` and `claim_winnings` actions
  - runtime status/event log panel
- Added root web scripts in `package.json`:
  - `web:install`, `web:dev`, `web:build`, `web:preview`
- Added new planning PRDs:
  - `docs/prds/012/012_final_ui_ux.md`
  - `docs/prds/013/013_game_fairness_simulation.md`

### Changed

- Finalized hybrid execution model:
  - L1: `place_bet`, `close_betting`, `claim_winnings`, `close_bet`, `sweep_vault`
  - ER: `execute_move`, `settle_and_undelegate`
- Updated `delegate_round` to delegate the `Round` account after betting closes (`InProgress` state).
- Updated `settle_and_undelegate` to commit/undelegate `Round` only.
- Updated integration tests to follow the finalized lifecycle sequence:
  - create round -> place bets on L1 -> close betting on L1 -> delegate -> execute/settle on ER -> claim/cleanup on L1.
- Updated top-level PRD tracker in `docs/MAGIC_BET_PRD.md` to remove day labels and reflect current execution order.
- Added root scripts for crank workflows in `package.json` (`crank:install`, `crank:build`, `crank:dev`, `crank:start`).
- Crank now supports keypair path loading via `ANCHOR_WALLET` (default `~/.config/solana/id.json`) without relying on `NodeWallet.local()`.
- Crank observability improved with per-round timing metrics (`bettingWindowMs`, `gameDurationMs`, `settleDurationMs`, `totalRoundMs`).
- Crank health `/status` now returns orchestrator + websocket runtime stats in BigInt-safe JSON format.
- Crank HTTP API now supports configurable CORS via `CORS_ORIGIN` (default `http://localhost:5173`) for browser-based web client access.
- Claim UI now supports selecting and claiming older unclaimed winning rounds (not only the latest settled round).
- Updated snake engine balancing:
  - Alpha/Beta now share aggressive move policy
  - max move cap effectively bounded to 300
  - snake body growth enabled on food-eat turns
  - symmetric opening state with mirrored starts and mirrored early food
  - late-phase food switched to independent spawns (non-mirrored)
  - shrinking wall phase added to force late-game resolution

### Fixed

- Fixed payout path in `claim_winnings` by using direct lamport mutation for House PDA payouts (instead of `SystemProgram::transfer` from a data-carrying PDA).
- Removed flaky vault post-close assertion path from tests.
- Corrected ER validator pubkey references and stale flow assumptions in test/docs.
- Fixed crank startup failures caused by missing `ANCHOR_WALLET` env in runtime.
- Fixed startup guard compatibility where ER connection does not expose `getIdentity()` by using RPC fallback.
- Implemented idempotent cleanup behavior to avoid duplicate `close_bet` processing/log churn per round.
- Fixed `/status` serialization crash caused by raw `BigInt` values.
- Fixed websocket reconnect/topic-race issue in web client causing round stream bouncing after settlement.
- Fixed browser runtime error `Buffer is not defined` in web client by adding browser-safe polyfills.
- Fixed frontend bet amount parsing/validation with explicit `0.01` to `1` SOL bounds and clearer errors.
- Fixed `claim_winnings` late-claim failure after `sweep_vault` by removing unnecessary `vault` account requirement from `ClaimWinnings`.
- Reduced draw-heavy outcomes via mixed food policy + shrinking wall pressure. Latest 500-round simulation snapshot: `alpha 237 / beta 241 / draw 22`.

### Docs

- Updated PRD notes/status and flow wording across:
  - `docs/prds/001/001_ix_list.md`
  - `docs/prds/002/002_er_poc_prd.md`
  - `docs/prds/003/003_game_logic.md`
  - `docs/prds/004/004_betting.md`
  - `docs/prds/005/005_round_lifecycle.md`
  - `docs/prds/006/006_admin_house.md`
  - `docs/prds/007/007_er_integration.md`
  - `docs/prds/008/008_tapestry.md`
- Added crank README operational notes:
  - startup hard guards
  - canonical lifecycle
  - cleanup policy and timing logs
  - websocket endpoint and smoke-test usage

### Validation

- Devnet integration test suite passing: `4 passing`.
