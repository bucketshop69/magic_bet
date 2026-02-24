# PM Input: PRD 003 - Game Logic

## What is the Game?

Two AI-controlled snakes (Alpha & Beta) battle on a deterministic grid. Each move advances both simultaneously. Game ends when one dies (hits wall/self/other) or both die same move. Winner determined by: survivor wins → if both die, higher score wins → if tied, fewer moves wins.

## Key User Stories

- **Place Bet:** User bets 0.01-1 SOL on Alpha or Beta before round starts
- **Watch Live:** User views real-time board as moves execute (off-chain rendering)
- **Claim Winnings:** Winner claims 2x payout after round settles
- **Check History:** User views past rounds, winners, pool sizes

## Edge Cases to Handle

- **Draw:** Both die same move → no payouts, pool rolls to house
- **One Side Zero Bets:** Game still plays; winner takes opposite pool
- **No Bets:** Round plays normally, house keeps nothing
- **Both Alive at Max Moves:** Higher score wins, tie → fewer moves wins
- **Mid-Game Crash:** Settlement callable any time to recover state

## Out of Scope for PRD 003

- Parlay betting, dynamic odds, replays (Phase 2)
