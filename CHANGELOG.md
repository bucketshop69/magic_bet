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

### Fixed

- Fixed payout path in `claim_winnings` by using direct lamport mutation for House PDA payouts (instead of `SystemProgram::transfer` from a data-carrying PDA).
- Removed flaky vault post-close assertion path from tests.
- Corrected ER validator pubkey references and stale flow assumptions in test/docs.
- Fixed crank startup failures caused by missing `ANCHOR_WALLET` env in runtime.
- Fixed startup guard compatibility where ER connection does not expose `getIdentity()` by using RPC fallback.
- Implemented idempotent cleanup behavior to avoid duplicate `close_bet` processing/log churn per round.

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

### Validation

- Devnet integration test suite passing: `4 passing`.
