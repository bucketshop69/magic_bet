# 004 PM Input — Betting Logic

## Overview

House model betting: players bet against house, not each other.

## User Stories

- Bet on Alpha or Beta (choice)
- Amount: 0.01 - 1 SOL
- 2x payout if win
- Claim winnings after round settles

## Instructions (from 001)

- `place_bet(round_id, choice, amount)` → creates Bet PDA
- `claim_winnings(round_id)` → transfers 2x from House

## Edge Cases

- Bet after round closes → REJECT
- Bet amount < 0.01 → REJECT  
- Bet amount > 1 SOL → REJECT
- Double claim → REJECT (claimed=true check)
- Claim on losing bet → REJECT
- House insufficient funds → REJECT
- Draw → no payouts

## Data On-Chain

- Bet PDA: round_id, user, choice, amount, claimed
- Round: alpha_pool, beta_pool
- House: vault balance
