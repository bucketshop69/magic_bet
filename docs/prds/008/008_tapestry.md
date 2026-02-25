# 008 — Tapestry Integration (Social Layer)

## Overview

Tapestry provides social features: profiles, follows, leaderboard. Most is off-chain via their REST API.

---

## What Tapestry Provides

| Feature | On-Chain | Tapestry API | Notes |
|---------|----------|--------------|-------|
| Profile | Wallet address | ✅ | Username, avatar, bio |
| Follows | ❌ | ✅ | Social graph |
| Win/Loss | Partially | ✅ | Derived from on-chain bets |
| Leaderboard | ❌ | ✅ | Aggregated stats |
| Activity Feed | ❌ | ✅ | Real-time |

---

## Integration Points

### 1. Profile Creation

- On first `place_bet` or wallet connect
- Call Tapestry API to create profile from wallet address
- Store username, avatar on Tapestry

```
POST /profiles
{ "wallet": "..." }
```

### 2. Recording Bets (On-Chain → Tapestry)

When user places bet:
- Store on-chain (Bet PDA with choice, amount, result)
- Indexer watches chain → updates Tapestry

When round settles:
- Indexer detects settlement
- Updates user's win/loss on Tapestry

### 3. Leaderboard

```
GET /leaderboard?sortBy=total_won&limit=100
```

### 4. Activity Feed

```
GET /feed?wallet=...&following=true
```

---

## What We Need from On-Chain

The Anchor program only needs to store:
- Bet records (already in Bet PDA)
- Round results (already in Round PDA)

Tapestry reads from chain via indexer.

---

## MVP Scope (Phase 1)

| Feature | Status |
|---------|--------|
| Profile auto-create | ✅ |
| Win/Loss tracking | ✅ (via indexer) |
| Leaderboard | ✅ |
| Follows | ❌ (Phase 2) |
| Activity feed | ❌ (Phase 2) |

---

## Implementation

1. **Frontend:** On wallet connect → check/create Tapestry profile
2. **Indexer:** Watch `place_bet` and `settle` → sync to Tapestry
3. **Leaderboard:** Read from Tapestry API

---

## CTO Review

**Score: 8/10** ✅ Approved

- Clear separation: on-chain vs off-chain
- Indexer approach is correct
- Phase 1 scope reasonable


> Codex note (2026-02-25): On-chain game/betting flows are now validated on devnet (`anchor test`: 4 passing). Off-chain Tapestry/indexer implementation from this PRD remains pending.
