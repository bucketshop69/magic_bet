# Changelog

All notable changes to this project are documented in this file.

## [Unreleased] - 2026-02-25

### Added

- Added [`docs/ux_flow.md`](/home/main-user/projects/rust/magic_bet/docs/ux_flow.md) with the finalized end-to-end UX/runtime flow.

### Changed

- Finalized hybrid execution model:
  - L1: `place_bet`, `close_betting`, `claim_winnings`, `close_bet`, `sweep_vault`
  - ER: `execute_move`, `settle_and_undelegate`
- Updated `delegate_round` to delegate the `Round` account after betting closes (`InProgress` state).
- Updated `settle_and_undelegate` to commit/undelegate `Round` only.
- Updated integration tests to follow the finalized lifecycle sequence:
  - create round -> place bets on L1 -> close betting on L1 -> delegate -> execute/settle on ER -> claim/cleanup on L1.

### Fixed

- Fixed payout path in `claim_winnings` by using direct lamport mutation for House PDA payouts (instead of `SystemProgram::transfer` from a data-carrying PDA).
- Removed flaky vault post-close assertion path from tests.
- Corrected ER validator pubkey references and stale flow assumptions in test/docs.

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

### Validation

- Devnet integration test suite passing: `4 passing`.
