# 005 PM Input — Round Lifecycle

## Overview

Round goes: Active → InProgress → Settled

## Instructions (from 001)

- `create_round(round_id, start_time)` → new round, Active
- `delegate_round(round_id)` → delegate to ER
- `close_betting(round_id)` → set InProgress
- `settle_and_undelegate(round_id)` → set Settled, winner

## User Stories

- Admin creates new round
- System delegates to ER for fast moves
- Betting closes at game start
- System settles when game ends

## Edge Cases

- Create round while one active → REJECT
- Delegate non-existent round → REJECT
- Close already-closed round → REJECT
- Settle already-settled → REJECT
- Execute move on non-InProgress → REJECT

## Data

- Round status: Active → InProgress → Settled
- Timestamps: start_time, end_time
- winner: Option<AIChoice>
