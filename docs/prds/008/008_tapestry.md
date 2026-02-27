# 008 — Tapestry Integration (Social Layer)

## Overview

Tapestry is a social graph protocol on Solana. It stores profiles, follows, and content off-chain in a graph database, with a Merkle root anchored to Solana L1 for verifiability.

Magic Bet uses Tapestry for player identities, the follow graph, and the social activity feed. Our on-chain program remains the source of truth for all bet and round data — Tapestry is purely the social layer on top.

**Base URL:** `https://api.usetapestry.dev/api/v1`
**Auth:** `x-api-key` header on all requests.

---

## Architecture

```
On-Chain (source of truth)          Tapestry (social layer)
─────────────────────────           ───────────────────────
Bet PDA  ──────────────────────────► POST /contents  (bet event)
Round PDA (settled) ───────────────► POST /contents  (result event)
Wallet connect (frontend) ─────────► POST /profiles  (findOrCreate)
User taps Follow (frontend) ───────► POST /follows
User opens Feed (frontend) ─────────► GET /feed
```

The **crank service** is the indexer bridge: it watches confirmed on-chain transactions and pushes events to Tapestry. The frontend calls Tapestry directly for reads (feed, profile, follows).

---

## What We Are Building

### Layer split

| Responsibility | Where |
|---------------|-------|
| Player identity (username, avatar) | Tapestry (created on wallet connect) |
| Follow graph | Tapestry |
| Bet activity feed | Tapestry content (written by crank on `place_bet`) |
| Round result feed | Tapestry content (written by crank on `settle`) |
| Bet amounts / winners / round state | On-chain only (Bet PDA, Round PDA) |

### What we are NOT doing (out of scope)

- Comments on rounds
- Likes on bet events
- Leaderboard via Tapestry (we derive this from on-chain data directly)

---

## API Calls We Need

### 1. `POST /profiles` — findOrCreate

**When:** User connects wallet in the web app or mobile app.

**Called by:** Frontend (web client / Expo app).

**Request:**
```json
{
  "username": "<wallet_address_truncated_or_user_chosen>",
  "walletAddress": "<full_solana_wallet_pubkey>",
  "blockchain": "solana",
  "execution": "FAST_UNCONFIRMED"
}
```

**Response:** Returns profile object with `id`, `username`, `image`, `bio`, `namespace`.

**Behaviour:** If a profile for this wallet already exists in our namespace, it returns the existing one. `findOrCreate` — safe to call every time on connect.

---

### 2. `GET /profiles?walletAddress=<pubkey>` — findAll (onboarding)

**When:** First wallet connect, before creating a profile.

**Called by:** Frontend.

**Purpose:** Check if this wallet already has a profile on any other Tapestry app. If so, pre-fill username/avatar — no blank profile on day 0.

**Request:**
```
GET /profiles?walletAddress=<pubkey>
```

**Response:** Array of profiles from all namespaces associated with this wallet. Pick the one with the most social weight (followers count) and use it as the suggested username/avatar.

---

### 3. `PUT /profiles/{id}` — Update profile

**When:** User edits their profile (username, avatar, bio).

**Called by:** Frontend (own profile screen only).

**Request:**
```json
{
  "username": "newname",
  "image": "https://...",
  "bio": "I always bet Alpha"
}
```

---

### 4. `GET /profiles/{id}` — Get profile

**When:** Loading any player's profile screen.

**Called by:** Frontend.

**Response:** `id`, `username`, `image`, `bio`, `created_at`, follower/following counts.

---

### 5. `POST /follows` — Follow a profile

**When:** User taps "Follow" on another player's profile.

**Called by:** Frontend.

**Request:**
```json
{
  "startId": "<follower_profile_id>",
  "endId": "<followee_profile_id>",
  "execution": "FAST_UNCONFIRMED"
}
```

---

### 6. `DELETE /follows` — Unfollow

**When:** User taps "Unfollow".

**Called by:** Frontend.

**Request:**
```json
{
  "startId": "<follower_profile_id>",
  "endId": "<followee_profile_id>"
}
```

---

### 7. `GET /profiles/{id}/followers` + `GET /profiles/{id}/following`

**When:** Loading a player's profile screen.

**Called by:** Frontend.

**Response:** Paginated list of profiles + total count. Used to render "142 Followers / 38 Following".

---

### 8. `GET /profiles/{id}/isFollowing?targetId=<id>` — Check follow status

**When:** Loading any profile screen (to show Follow vs Unfollow button state).

**Called by:** Frontend.

---

### 9. `POST /contents` — Publish a bet event

**When:** Crank confirms a `place_bet` transaction on L1.

**Called by:** Crank service (indexer bridge).

**Request:**
```json
{
  "profileId": "<player_tapestry_profile_id>",
  "content": {
    "id": "bet-<round_id>-<wallet_pubkey>",
    "text": "Bet <amount> SOL on Alpha in Round #<round_id>",
    "properties": [
      { "key": "type",      "value": "bet" },
      { "key": "round_id",  "value": "<round_id>" },
      { "key": "ai_choice", "value": "alpha" },
      { "key": "amount_sol","value": "0.25" },
      { "key": "tx_sig",    "value": "<place_bet_tx_signature>" }
    ]
  },
  "execution": "FAST_UNCONFIRMED"
}
```

**Note:** `id` is deterministic (`bet-<round_id>-<wallet>`) so re-publishing the same bet is idempotent (findOrCreate behaviour).

---

### 10. `POST /contents` — Publish a round result event

**When:** Crank confirms `settle_and_undelegate` on ER → round is now `Settled` on L1.

**Called by:** Crank service (indexer bridge).

**Request:**
```json
{
  "profileId": "<agent_or_house_tapestry_profile_id>",
  "content": {
    "id": "result-<round_id>",
    "text": "Round #<round_id> settled — Alpha wins! (score: 8 vs 5)",
    "properties": [
      { "key": "type",       "value": "round_result" },
      { "key": "round_id",   "value": "<round_id>" },
      { "key": "winner",     "value": "alpha" },
      { "key": "alpha_score","value": "8" },
      { "key": "beta_score", "value": "5" }
    ]
  },
  "execution": "FAST_UNCONFIRMED"
}
```

---

### 11. `GET /feed?profileId=<id>` — Activity feed

**When:** User opens the Social Feed screen.

**Called by:** Frontend.

**Response:** Paginated list of `ActivityItem` objects — `new_content` (bet/result events), `new_follower`, `following` actions — from profiles the user follows.

Activity item shape:
```json
{
  "type": "new_content",
  "actor_id": "player123",
  "actor_username": "sol_degen",
  "timestamp": 1771982486000,
  "activity": "Bet 0.25 SOL on Alpha in Round #42"
}
```

---

## Indexer Bridge (Crank Side)

The crank service already tracks every on-chain event. We add a thin Tapestry client module:

```
services/crank/src/
  tapestry/
    client.ts        # HTTP wrapper (fetch + API key header)
    profiles.ts      # findOrCreate, getProfile helpers
    content.ts       # publishBetEvent, publishRoundResult
```

**Trigger points in the crank:**
- After `place_bet` confirmed → `publishBetEvent(round_id, wallet, choice, amount, tx_sig)`
- After `settle_and_undelegate` confirmed → `publishRoundResult(round_id, winner, scores)`

**Failure handling:** Use `FAST_UNCONFIRMED` execution — Tapestry call failing does NOT block the round lifecycle. Log the error and move on. The crank should never stall a round over a social API call.

---

## Execution Method

Use `FAST_UNCONFIRMED` for all writes (profile create, follows, content publish).

| Mode | Roundtrip | Use for |
|------|-----------|---------|
| `FAST_UNCONFIRMED` | < 1s | All social writes (profile, follows, content) |
| `CONFIRMED_AND_PARSED` | ~15s | Not needed — on-chain tx is already our confirmation |

---

## Implementation Order

1. **Profile service** — `findOrCreate` on wallet connect (frontend)
2. **Indexer bridge** — crank publishes bet + result content events
3. **Activity feed** — frontend reads `GET /feed`
4. **Follows** — frontend follow/unfollow + profile follower counts
5. **findAll onboarding** — pre-fill profile from other Tapestry apps

---

> Codex note (2026-02-25): On-chain game/betting flows are validated on devnet (`anchor test`: 4 passing). Tapestry integration is pending — implementation starts at step 1 above.
