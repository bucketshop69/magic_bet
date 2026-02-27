# 015 — Feed UX Polish

> Status (2026-02-27): Pending design review. Functional feed is live (PRD 014 Step 2). This PRD covers visual polish only — no new functionality.

## Overview

The `/feed` route delivers a fully functional activity feed (PRD 014). This PRD defines the visual and interaction polish pass to be done with the UX designer and product manager after the functional version is validated.

**Do not start this PRD until PRD 014 is signed off.**

---

## What Already Works (from PRD 014)

- Feed route at `/feed`
- Pulls `getActivityFeed()` from Tapestry (`activities[]`)
- Renders bet events — who bet what on which round
- Renders round result events
- Polls every 15s
- Empty state copy: "No activity yet — follow some players"

---

## Scope (Polish Only)

### Visual

- [ ] Feed item card design — avatar bubble, username, action text, timestamp
- [ ] Color coding: Alpha bets (blue tint), Beta bets (orange tint), results (neutral)
- [ ] Skeleton loader while feed is loading
- [ ] Pull-to-refresh gesture (mobile)
- [ ] Timestamp formatting — "2 min ago" relative time
- [ ] Empty state illustration + improved copy

### Interaction

- [ ] Tap a username in feed → opens their profile (`/profile/:wallet`)
- [ ] Infinite scroll / "Load more" pagination
- [ ] New activity badge / indicator when feed updates in background
- [ ] Smooth entry animation for new feed items

### Performance

- [ ] Optimistic UI — new bet item appears immediately after place_bet confirm, before Tapestry confirms
- [ ] Deduplicate items client-side if API returns repeats

---

## Success Criteria

1. Feed feels alive — new items appear without full refresh
2. Visual hierarchy is clear — username, action, and time are scannable at a glance
3. Tapping any username navigates to their profile without jarring transition
4. Works correctly on mobile viewport (Expo web wrapper)

---

## CTO Acceptance

**Target Score: 8/10**

Must pass:
- No layout shift on load
- Timestamps update without re-fetch
- Profile navigation works from feed item tap

> To be scheduled with UX designer and PM after PRD 014 functional sign-off.
