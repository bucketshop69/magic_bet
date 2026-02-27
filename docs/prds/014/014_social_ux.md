# 014 — Tapestry Social UX (Feed, Profiles, Follows)

> Status (2026-02-27): In progress. Foundation wired — profile `findOrCreate` on wallet connect and `publishRoundResult` after settlement are live. Steps 1–4 below define the remaining UX surface.

## Overview

This PRD defines the full social UX layer built on top of the Tapestry integration (see PRD 008). The infrastructure (HTTP client, env vars, profile create on connect, round result publishing) is already in place. This PRD covers the four remaining user-facing steps that turn the invisible social backend into something users can actually see and interact with.

The guiding principle: **every social action surfaces naturally inside the game UX** — no separate social app, no context switch.

---

## Goal

Give Magic Bet players a lightweight but real social identity:

- Their bets are public social actions, visible to followers
- They can follow other players they want to watch
- They have a feed showing what people they follow are betting on
- New users aren't stuck with an anonymous wallet address

---

## Scope

### In Scope

- Publishing bet events to Tapestry after `place_bet` confirms (frontend)
- Activity feed tab showing bets + round results from followed players
- Player profile view with follow/unfollow + follower counts
- Onboarding improvement: pre-fill username from existing Tapestry identity

### Out of Scope

- Post/comment on rounds (no UX for this)
- Likes on bet events
- Profile edit screen (Phase 2 — just username, avatar, bio editing)
- Tapestry-based leaderboard (leaderboard is derived from on-chain data separately)
- Push notifications

---

## Current State (what's already done)

| Feature | Status | Where |
|---------|--------|-------|
| Tapestry HTTP client (crank) | ✅ Done | `services/crank/src/tapestry/client.ts` |
| `findOrCreate` profile on wallet connect | ✅ Done | `apps/web/src/lib/tapestry.ts` + `App.tsx` |
| `publishRoundResult` after settlement | ✅ Done | `services/crank/src/core/phases/settle.ts` |
| Follow / unfollow / isFollowing helpers | ✅ Done | `apps/web/src/lib/tapestry.ts` |
| `getActivityFeed` helper | ✅ Done | `apps/web/src/lib/tapestry.ts` |
| Env vars wired (crank + web) | ✅ Done | `.env`, `env.ts`, `config.ts` |
| Bet event publishing | ❌ Missing | Needs Step 1 below |
| Feed UI | ❌ Missing | Needs Step 2 below |
| Player profile UI | ❌ Missing | Needs Step 3 below |
| Onboarding pre-fill | ❌ Missing | Needs Step 4 below |

---

## Step 1 — Publish Bet Events (Frontend)

**UX:** When a user places a bet and it confirms on-chain, that bet is automatically published as a social content item on Tapestry. Their followers will see it in the feed.

**Why frontend (not crank):** The crank doesn't observe individual `place_bet` transactions from users. The frontend already has all the context at the moment of confirmation: wallet, round ID, choice, amount, tx signature.

### What happens from the user's POV

1. User places a bet — Phantom approves, tx confirms
2. "place_bet success: Ab3c..." appears in event log (already in place)
3. Silently: `publishBetEvent()` fires in the background
4. Followers of this player will see it in their feed

### Files to change

- `apps/web/src/lib/tapestry.ts` — add `publishBetEvent()` function
- `apps/web/src/App.tsx` — call `publishBetEvent()` inside `submitBet()` after `placeBet()` resolves

### Content payload

```json
{
  "profileId": "<player_tapestry_id>",
  "content": {
    "id": "bet-<roundId>-<walletPubkey>",
    "text": "Bet 0.25 SOL on ALPHA in Round #42",
    "properties": [
      { "key": "type",       "value": "bet" },
      { "key": "round_id",   "value": "42" },
      { "key": "ai_choice",  "value": "alpha" },
      { "key": "amount_sol", "value": "0.25" },
      { "key": "tx_sig",     "value": "<sig>" }
    ]
  },
  "execution": "FAST_UNCONFIRMED"
}
```

**Note:** `id` is deterministic — if the user hits submit twice or tx retries, it's idempotent.

**Failure handling:** Fire-and-forget `.catch(() => null)` — Tapestry failure never blocks the bet UI.

---

## Step 2 — Activity Feed Tab

**UX:** A new **Feed** tab in the existing tab bar shows a chronological list of social actions from players the current user follows. It includes bet events and round results.

### What the user sees

```
┌─────────────────────────────────────────┐
│  Live   Feed   Ranking                  │
├─────────────────────────────────────────┤
│                                         │
│  🔵 sol_degen   2 min ago               │
│  Bet 0.5 SOL on ALPHA in Round #47      │
│                                         │
│  🟠 wagmi_king   5 min ago              │
│  Bet 0.1 SOL on BETA in Round #47       │
│                                         │
│  🏁 Round #46 settled — BETA wins!      │
│  12 min ago                             │
│                                         │
│  + Follow more players                  │
│                                         │
└─────────────────────────────────────────┘
```

### Feed item types

| `type` | Display |
|--------|---------|
| `new_content` (bet) | `<username> bet <amount> SOL on <choice> in Round #<id>` |
| `new_content` (result) | `Round #<id> settled — <winner> wins!` |
| `new_follower` | `<username> started following you` |
| `following` | `<username> is now following <other>` |

### Files to create / change

- `apps/web/src/components/FeedPanel.tsx` — new component
- `apps/web/src/App.tsx` — wire the Feed tab, pass `walletProfileId` state

### Data flow

```
App.tsx
  → on wallet connect: store tapestryProfileId in state
  → on Feed tab open: call getActivityFeed(profileId)
  → pass activities[] to <FeedPanel />

FeedPanel.tsx
  → renders list of ActivityItem
  → polls every 15s (no WS needed for feed)
  → "No activity yet. Follow some players!" empty state
```

### State needed in App.tsx

```ts
const [tapestryProfileId, setTapestryProfileId] = useState<string | null>(null);
// Set this when findOrCreateProfile resolves after wallet connect
```

---

## Step 3 — Player Profile View

**UX:** Clicking on a wallet address anywhere in the app (event log, feed, leaderboard) opens a compact player profile overlay showing their identity and a Follow button.

### What the user sees

```
┌─────────────────────────────────────┐
│  sol_degen                          │
│  Ab3c...7fGh                        │
│  "I always bet Alpha"               │
│                                     │
│  142 Followers · 38 Following       │
│                                     │
│  [  Follow  ]   [ Close ]           │
│                                     │
│  Recent bets:                       │
│  · Round #47 — ALPHA — 0.5 SOL      │
│  · Round #46 — ALPHA — 0.25 SOL     │
└─────────────────────────────────────┘
```

### Files to create / change

- `apps/web/src/components/PlayerProfile.tsx` — new overlay/modal component
- `apps/web/src/App.tsx` — add `selectedPlayerWallet` state, render `<PlayerProfile />`

### API calls used

| Call | When |
|------|------|
| `GET /profiles?walletAddress=<pubkey>` | On profile open — fetch their Tapestry profile |
| `GET /profiles/{id}/followers` | Get follower count |
| `GET /profiles/{id}/following` | Get following count |
| `GET /profiles/{id}/isFollowing` | Determine Follow vs Unfollow button state |
| `POST /follows` | On Follow tap |
| `DELETE /follows` | On Unfollow tap |
| `GET /contents?profileId={id}` | Fetch their recent bet events |

**Failure handling:** If Tapestry is unreachable, show wallet address only — no crash.

---

## Step 4 — Onboarding Pre-fill

**UX:** When a user connects their wallet for the first time, check if they already have a profile on any other Tapestry-powered app. If they do, silently pre-fill their username and avatar — no blank anonymous profile.

### Flow

```
User connects wallet
  → findProfilesByWallet(pubkey) runs
  → If profiles[] is non-empty:
      → Pick the profile with the most followers
      → Use its username + image as the default for this app
  → If no existing profile:
      → Default: Ab3c...7fGh (truncated pubkey — current behaviour)
```

### What the user sees

**With existing identity elsewhere:**
> "Welcome back, sol_degen 👋" (username pre-filled automatically)

**New to Tapestry:**
> Connects silently as `Ab3c...7fGh` — no interruption

### Files to change

- `apps/web/src/App.tsx` — call `findProfilesByWallet()` before `findOrCreateProfile()`, pass best match as username seed

**Failure handling:** If `findProfilesByWallet` fails or returns empty, fall back to current behaviour. Never block wallet connect.

---

## Proposed File Changes

```text
apps/web/src/
  lib/
    tapestry.ts             ← add publishBetEvent()     (Step 1)
  components/
    FeedPanel.tsx           ← new                       (Step 2)
    PlayerProfile.tsx       ← new                       (Step 3)
  App.tsx                   ← wire all steps            (1, 2, 3, 4)
```

No crank changes required for Steps 1–4.

---

## Success Criteria

1. After a user places a bet, that bet appears in their followers' feeds within 2 seconds.
2. Switching to the Feed tab shows real activity (or a clear empty state with a call to action).
3. Tapping any player identifier opens their profile with a working Follow button.
4. A user with an existing Tapestry identity elsewhere sees their username on first connect, not a truncated pubkey.
5. None of the above steps can stall, crash, or block the core game loop.

---

## CTO Acceptance

**Target Score: 8/10**

Must pass:
- Bet events published on tx confirm (not before)
- Feed renders correctly from `getActivityFeed()` response
- Follow/unfollow round-trips Tapestry API without blocking UI
- All Tapestry calls are fire-and-forget or gracefully degraded — zero UX regressions if API is down

> Codex note (2026-02-27): PRD 008 Tapestry infrastructure is complete and validated. This PRD defines the four remaining UX steps to make the social layer visible to users.
