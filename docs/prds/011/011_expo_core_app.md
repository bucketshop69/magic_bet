# 011 — Expo Core App (Wallet, Live Round, Bet, Claim)

## Overview

This PRD defines the core mobile experience on Expo for the current on-chain flow.

Focus is on the critical gameplay loop and wallet UX, not full social polish.

---

## Goal

Ship a usable core app that lets users:

1. Connect wallet
2. Watch live round state (dual snake grids)
3. Place bet on L1 during betting window
4. See round result
5. Claim winnings on L1

---

## Build Order (Mandatory)

1. Wallet connection (Mobile Wallet Adapter)
2. Home live round screen (WS-fed grids)
3. Bet flow (`place_bet` on L1)
4. Result + claim flow
5. Basic history and profile shell

---

## Scope

### In Scope

- Wallet connect/disconnect
- Active round screen (live rendering)
- Bet modal and tx status
- Result screen + claim tx
- Error states and retry UX

### Out of Scope

- Full Tapestry social feed implementation
- Advanced profile editing
- Blink creation UI (handled by web endpoint)

---

## Proposed Folder Structure

```text
apps/
  mobile/
    app.json
    package.json
    tsconfig.json
    app/
      _layout.tsx
      index.tsx                   # home/active round
      bet-confirm.tsx
      result.tsx
      claim.tsx
      (tabs)/
        history.tsx
        profile.tsx
    src/
      components/
        board/
          SnakeGrid.tsx
          Cell.tsx
        round/
          RoundHeader.tsx
          BetControls.tsx
      features/
        wallet/
          useWallet.ts
          WalletProvider.tsx
        round/
          useRoundSocket.ts
          roundStore.ts
        betting/
          placeBet.ts
          claimWinnings.ts
      services/
        ws/
          client.ts
          protocol.ts
        chain/
          l1.ts
          program.ts
      lib/
        config.ts
        format.ts
      types/
        round.ts
        events.ts
```

---

## Core Screens

## 1. Onboarding

- Connect Phantom/Solflare via MWA
- Show connected wallet + balance
- Persist session locally

## 2. Home / Active Round

- Render Alpha and Beta 20x20 boards
- Live score and status
- Betting timer and pool totals
- Bet buttons + amount input
- Disable bet controls when status != `Active`

## 3. Bet Confirmation

- Choice, amount, expected payout
- Submit L1 tx (`place_bet`)
- Pending/success/failure states

## 4. Round Result

- Winner + final scores + final board snapshot
- Win/loss badge
- Claim CTA if user won and not claimed

## 5. Claim

- Submit L1 tx (`claim_winnings`)
- Update local state and history

---

## Data Sources

- Realtime state: WebSocket Gateway (`round_state_v1`)
- Transaction execution: L1 RPC via wallet
- Historical data (initial): on-chain queries
- Social (later): Tapestry API

---

## UX Rules

1. Never block UI on websocket reconnect.
2. Use optimistic pending UI for tx submission, then confirm from chain.
3. Distinguish recoverable vs fatal tx errors clearly.
4. Preserve last known board state during reconnect.
5. Show clear round phase banner: `Active`, `InProgress`, `Settled`.

---

## Technical Requirements

- Expo + React Native
- MWA integration for signing
- WS client with reconnect/backoff
- Board renderer optimized for 20x20 x 2 updates
- Minimal state manager (Zustand/Redux Toolkit acceptable)

---

## Success Criteria

1. User can connect wallet and place a bet in under 20 seconds.
2. Home screen shows smooth live board updates from websocket.
3. Claim flow succeeds for winning bet from app.
4. App handles socket disconnect/reconnect without crash.

---

## CTO Acceptance

**Target Score: 9/10**

Must pass:
- reliable wallet flow
- reliable live rendering
- reliable L1 tx UX (`place_bet`, `claim_winnings`)
- clear error handling for hackathon demo conditions
