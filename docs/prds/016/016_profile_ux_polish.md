# 016 — Profile UX Polish

> Status (2026-02-27): Pending design review. Functional profile page is live at `/profile` (PRD 014 Step 3). This PRD covers visual polish only — no new functionality.

## Overview

The `/profile` route delivers a fully functional player profile (PRD 014). This PRD defines the visual and interaction polish pass to be done with the UX designer and product manager after the functional version is validated.

**Do not start this PRD until PRD 014 is signed off.**

---

## What Already Works (from PRD 014)

- Profile route at `/profile` (own profile)
- Pulls Tapestry profile by connected wallet — username, bio, image
- Displays follower + following counts
- Follow / Unfollow button with live state (isFollowing check on load)
- Recent bets pulled from Tapestry content items
- Graceful fallback to truncated wallet if Tapestry unreachable

---

## Scope (Polish Only)

### Visual

- [ ] Avatar display — circular image, fallback to generated identicon
- [ ] Username + bio typography hierarchy
- [ ] Follower / Following counts as tappable links → open follower list
- [ ] Follow button states — Follow / Following / Unfollow (hover/press)
- [ ] Recent bets list — styled bet event cards (match feed card style)
- [ ] "Edit Profile" button (own profile only) → inline username/bio/avatar edit
- [ ] Profile header background — subtle gradient from wallet identity color

### Interaction

- [ ] Tapping "Followers" → sheet/modal with follower list (each tappable)
- [ ] Tapping "Following" → sheet/modal with following list
- [ ] Follow action optimistic — button flips instantly, rolls back on API error
- [ ] Copy wallet address (long-press or icon — accessible but not prominent)
- [ ] Share profile link (optional, Phase 2)

### Navigation

- [ ] Back button / close gesture from profile overlay
- [ ] Deep link: `/profile/:walletAddress` — any player's profile, not just own
- [ ] Navigating from feed item username → correct player's profile

### Performance

- [ ] Profile data cached client-side for 60s (avoid repeat fetches on navigation)
- [ ] Follower count badge updates after follow/unfollow action

---

## Success Criteria

1. Own profile page shows correct username, follower/following counts, recent bets
2. Follow/unfollow round-trips API and updates button state without page reload
3. Any player's profile accessible via `/profile/:walletAddress`
4. Profile loads with a perceived skeleton within 200ms of navigation

---

## CTO Acceptance

**Target Score: 8/10**

Must pass:
- Correct profile shown for own wallet vs other wallets
- Follow/unfollow state never out of sync after API round-trip
- No crash if Tapestry is unreachable — graceful fallback to wallet address

> To be scheduled with UX designer and PM after PRD 014 functional sign-off.
