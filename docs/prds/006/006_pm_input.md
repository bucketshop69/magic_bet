# 006 PM Input — Admin & House

## Instructions (from 001)

- `initialize(admin)` → create Config, fund House
- `close_bet` → cleanup

## What We Need

- Who can create rounds? (admin only)
- Who can call settle? (admin/crank only)
- House initial funding
- Bet cleanup after settled

## Edge Cases

- Non-admin calls admin-only → REJECT
- Initialize twice → REJECT
- Close bet before settled → REJECT
