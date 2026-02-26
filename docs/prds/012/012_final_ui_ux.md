# 012 — Final UI/UX Polish

## Implementation Status (Current)

- 1. Design Tokens First: Done (Pass A on `apps/web`)
- 2. Component Kit Second: Done (Pass A on `apps/web`)
- 3. Theme Architecture: Done (Pass A on `apps/web`)
- 4. Layout Rules: Done (Pass A on `apps/web`)
- 5. State-to-UI Mapping: Done (Pass A on `apps/web`)
- 6. Motion and Interaction Feedback: Planned
- 7. Data Contracts for UI: Done (Pass A on `apps/web`)

## 1. Design Tokens First

- Create a shared token source for:
  - Colors: LCD/retro palette used in `docs/web.html`.
  - Typography: display and body scales.
  - Spacing: 4/8/12/16/24 rhythm.
  - Radius, border, elevation, and focus styles.
- Keep tokens framework-agnostic (JSON or TS constants) so web and app can consume the same values.

## 2. Component Kit Second

- Convert repeated UI blocks into reusable components:
  - `ScoreBar`
  - `SnakeBoardCard`
  - `BetActionBar`
  - `NavTabButton`
  - `LcdButton`
  - `LcdInput`
- Rule: no inline one-off styling in screen files for core primitives.

## 3. Theme Architecture

- Implement a dedicated LCD theme module and provider.
- Theme should expose semantic roles, not raw hex:
  - `surface.base`, `surface.panel`, `text.primary`, `text.muted`, `accent.active`, `border.strong`.
- All new screens must consume theme values via shared helpers/hooks.

## 4. Layout Rules

- Web:
  - 12-column shell with centered 8-column main rail.
  - Boards side-by-side in the main body.
  - Action bar anchored at bottom of main rail.
- Mobile (web first but mobile-safe):
  - Portrait-first stacked layout.
  - No unnecessary scrolling for core gameplay state.
  - Bottom elevated action zone remains reachable.

## 5. State-to-UI Mapping

- Standardize UI state mapping for round lifecycle:
  - `BettingOpen`
  - `InProgress`
  - `Settled`
  - `Claimable`
  - `Claimed`
- For each state define:
  - Enabled/disabled actions.
  - Primary status label and timer behavior.
  - Visual emphasis (active panel, muted controls, banners).

## 6. Motion and Interaction Feedback

- Define consistent interactions:
  - Press/hover/active states for buttons.
  - Input focus and validation feedback.
  - Loading and pending transaction states.
  - WS reconnect and stale-data banners.
- Keep motion minimal and meaningful, focused on clarity.

## 7. Data Contracts for UI

- Freeze typed payload contracts for:
  - Health/status API response.
  - WebSocket round state events.
  - Claim eligibility + balances for user actions.
- UI components consume typed view models, not raw RPC responses.
- Add versioned event naming and fallback handling for missing fields.
