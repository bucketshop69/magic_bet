import { useEffect, useMemo, useRef, useState } from "react";
import { Routes, Route, useNavigate, useLocation } from "react-router-dom";
import * as anchor from "@coral-xyz/anchor";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import { SnakeBoard } from "./components/SnakeBoard";
import { LcdButton } from "./components/ui/LcdButton";
import { LcdInput } from "./components/ui/LcdInput";
import { LcdSelect } from "./components/ui/LcdSelect";
import { NavTabButton } from "./components/ui/NavTabButton";
import { Panel } from "./components/ui/Panel";
import { parseCrankStatus, parseWsEvent } from "./lib/adapters";
import { APP_CONFIG } from "./lib/config";
import {
  claimWinnings,
  createConnection,
  createProgram,
  createWalletAdapter,
  fetchBet,
  fetchRound,
  lamportsFromSol,
  placeBet,
  type Choice,
} from "./lib/program";
import { deriveUiRoundView } from "./lib/uiState";
import { findOrCreateProfile, publishBetEvent } from "./lib/tapestry";
import { FeedPage } from "./pages/FeedPage";
import { ProfilePage } from "./pages/ProfilePage";
import type { CrankStatus } from "./types/contracts";
import type { RoundStateV1, WsEvent } from "./types/ws";

const EMPTY_BOARD = new Array(400).fill(0);
const BETTING_WINDOW_FALLBACK_SECONDS = 45;
const GAME_WINDOW_SECONDS = 300;
const PHASE_RING_RADIUS = 44;
const PHASE_RING_CIRCUMFERENCE = 2 * Math.PI * PHASE_RING_RADIUS;

type PhaseClock = {
  kind: "betting" | "game";
  roundId: string;
  startedAtMs: number;
};

function short(pk?: string) {
  if (!pk) return "-";
  return `${pk.slice(0, 4)}...${pk.slice(-4)}`;
}

function winnerKey(value: unknown): "alpha" | "beta" | "draw" | null {
  if (!value || typeof value !== "object") return null;
  const keys = Object.keys(value as Record<string, unknown>);
  if (keys.length === 0) return null;
  const k = keys[0]?.toLowerCase();
  if (k === "alpha" || k === "beta" || k === "draw") return k;
  return null;
}

function normalizeEpochMs(ts: number): number {
  if (!Number.isFinite(ts) || ts <= 0) return Date.now();
  return ts >= 1_000_000_000_000 ? ts : ts * 1000;
}

function derivePhaseClockFromRoundState(state: RoundStateV1): PhaseClock | null {
  const roundId = state.roundId;
  if (state.status === "Active") {
    return {
      kind: "betting",
      roundId,
      startedAtMs: normalizeEpochMs(state.ts),
    };
  }
  if (state.status === "InProgress") {
    return {
      kind: "game",
      roundId,
      startedAtMs: normalizeEpochMs(state.ts) - Math.max(0, state.moveCount) * 1000,
    };
  }
  return null;
}

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    wallet,
    publicKey: adapterPublicKey,
    connect,
    disconnect,
    signTransaction,
    signAllTransactions,
  } = useWallet();
  const { setVisible: setWalletModalVisible } = useWalletModal();
  const [walletPk, setWalletPk] = useState<PublicKey | null>(null);
  const [tapestryProfileId, setTapestryProfileId] = useState<string | null>(null);
  const [connection] = useState(() => createConnection());
  const [program, setProgram] = useState<anchor.Program | null>(null);
  const [balanceSol, setBalanceSol] = useState<number | null>(null);

  const [crankStatus, setCrankStatus] = useState<CrankStatus | null>(null);
  const [roundId, setRoundId] = useState<bigint | null>(null);
  const [roundState, setRoundState] = useState<RoundStateV1 | null>(null);
  const [claimableRounds, setClaimableRounds] = useState<bigint[]>([]);
  const [userBetRounds, setUserBetRounds] = useState<string[]>([]);
  const [selectedClaimRound, setSelectedClaimRound] = useState<string>("");
  const [betChoice, setBetChoice] = useState<Choice>("alpha");
  const [betAmountSol, setBetAmountSol] = useState("0.02");
  const [busy, setBusy] = useState<string | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const [phaseClock, setPhaseClock] = useState<PhaseClock | null>(null);
  const [clockNowMs, setClockNowMs] = useState(() => Date.now());

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const shouldReconnectRef = useRef(false);
  const wsGenerationRef = useRef(0);
  const lastRoundRef = useRef<string | null>(null);
  const walletMenuRef = useRef<HTMLDivElement | null>(null);
  const walletSyncRef = useRef<string | null>(null);

  const addEvent = (line: string) => {
    setEvents((prev) => [line, ...prev].slice(0, 14));
  };

  const topic = useMemo(() => {
    if (!roundId) return null;
    return `round:${roundId.toString()}`;
  }, [roundId]);

  const currentRoundId = roundId?.toString() ?? null;
  const currentRoundClaimable = Boolean(
    currentRoundId &&
    claimableRounds.some((r) => r.toString() === currentRoundId)
  );
  const currentRoundHasUserBet = Boolean(
    currentRoundId && userBetRounds.includes(currentRoundId)
  );

  const uiRound = deriveUiRoundView({
    roundState,
    walletConnected: !!walletPk,
    currentRoundClaimable,
    currentRoundHasUserBet,
  });

  const canBet = !!walletPk && !busy && uiRound.canPlaceBet;
  const canClaim = !!walletPk && !busy && selectedClaimRound.length > 0;
  const phaseClockForCurrentRound =
    phaseClock && currentRoundId && phaseClock.roundId === currentRoundId
      ? phaseClock
      : null;

  const bettingDeadlineMs = crankStatus?.orchestrator.bettingDeadlineMs ?? null;
  const roundCreatedAtMs = crankStatus?.orchestrator.roundCreatedAtMs ?? null;
  const bettingWindowSeconds =
    bettingDeadlineMs != null &&
      roundCreatedAtMs != null &&
      bettingDeadlineMs > roundCreatedAtMs
      ? Math.max(1, (bettingDeadlineMs - roundCreatedAtMs) / 1000)
      : BETTING_WINDOW_FALLBACK_SECONDS;
  const bettingRemainingSeconds =
    bettingDeadlineMs != null
      ? Math.max(0, (bettingDeadlineMs - clockNowMs) / 1000)
      : phaseClockForCurrentRound
        ? Math.max(
          0,
          bettingWindowSeconds -
          Math.max(0, (clockNowMs - phaseClockForCurrentRound.startedAtMs) / 1000)
        )
        : 0;
  const gameRemainingMoves = Math.max(
    0,
    GAME_WINDOW_SECONDS - Math.max(0, roundState?.moveCount ?? 0)
  );

  const ringProgress =
    uiRound.state === "BettingOpen"
      ? Math.max(0, Math.min(1, bettingRemainingSeconds / bettingWindowSeconds))
      : uiRound.state === "InProgress"
        ? Math.max(0, Math.min(1, gameRemainingMoves / GAME_WINDOW_SECONDS))
        : 1;
  const ringDashOffset = PHASE_RING_CIRCUMFERENCE * (1 - ringProgress);
  const scorelineText =
    uiRound.state === "BettingOpen"
      ? Math.ceil(bettingRemainingSeconds).toString()
      : `${(roundState?.alphaScore ?? 0).toString()}:${(roundState?.betaScore ?? 0).toString()}`;
  const ringTone =
    uiRound.state === "BettingOpen"
      ? "betting"
      : uiRound.state === "InProgress"
        ? "game"
        : "idle";

  async function refreshClaimables(p: anchor.Program, user: PublicKey) {
    try {
      const allBets = await (p.account as any).bet.all();
      const userBets = allBets.filter(
        (entry: any) =>
          entry.account?.user?.toBase58?.() === user.toBase58()
      );
      const userRoundsSet = new Set<string>();
      const winningRoundIds: bigint[] = [];

      for (const entry of userBets) {
        const round = BigInt(entry.account.roundId.toString());
        const roundKey = round.toString();
        userRoundsSet.add(roundKey);
        const isClaimed = Boolean(entry.account.claimed);
        if (isClaimed) continue;

        const roundAccount = await fetchRound(p, round);
        if (!roundAccount) continue;
        const winner = winnerKey(roundAccount.winner);
        if (!winner || winner === "draw") continue;
        const choice = winnerKey(entry.account.choice);
        if (choice === winner) winningRoundIds.push(round);
      }

      const uniqueDesc = Array.from(new Set(winningRoundIds.map(String)))
        .map((v) => BigInt(v))
        .sort((a, b) => (a > b ? -1 : 1));
      const betRounds = Array.from(userRoundsSet).sort((a, b) =>
        BigInt(a) > BigInt(b) ? -1 : 1
      );

      setUserBetRounds(betRounds);
      setClaimableRounds(uniqueDesc);

      if (uniqueDesc.length === 0) {
        setSelectedClaimRound("");
      } else if (
        !selectedClaimRound ||
        !uniqueDesc.some((r) => r.toString() === selectedClaimRound)
      ) {
        setSelectedClaimRound(uniqueDesc[0].toString());
      }
    } catch (err) {
      addEvent(`claimable refresh failed: ${(err as Error).message}`);
    }
  }

  async function refreshBalance(pk: PublicKey) {
    const balance = await connection.getBalance(pk, "confirmed");
    setBalanceSol(balance / anchor.web3.LAMPORTS_PER_SOL);
  }

  async function connectWallet() {
    try {
      if (!wallet) {
        setWalletModalVisible(true);
        return;
      }
      await connect();
      setWalletMenuOpen(false);
    } catch (err) {
      addEvent(`connect wallet failed: ${(err as Error).message}`);
      setWalletModalVisible(true);
    }
  }

  async function disconnectWallet() {
    try {
      await disconnect();
    } catch (err) {
      addEvent(`disconnect wallet failed: ${(err as Error).message}`);
    } finally {
      setWalletMenuOpen(false);
    }
  }

  async function copyWalletAddress() {
    if (!walletPk) return;
    const address = walletPk.toBase58();
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(address);
      } else {
        const temp = document.createElement("textarea");
        temp.value = address;
        temp.setAttribute("readonly", "true");
        temp.style.position = "absolute";
        temp.style.left = "-9999px";
        document.body.appendChild(temp);
        temp.select();
        document.execCommand("copy");
        document.body.removeChild(temp);
      }
      addEvent(`Copied wallet address: ${short(address)}`);
    } catch (err) {
      addEvent(`copy address failed: ${(err as Error).message}`);
    } finally {
      setWalletMenuOpen(false);
    }
  }

  async function pollCrankStatus() {
    try {
      const r = await fetch(`${APP_CONFIG.crankHttpUrl}/status`);
      if (!r.ok) throw new Error(`status ${r.status}`);
      const raw = await r.json();
      const data = parseCrankStatus(raw);
      setCrankStatus(data);

      const id = data.orchestrator.currentRoundId;
      if (id) {
        const parsed = BigInt(id);
        setRoundId(parsed);
        if (id !== lastRoundRef.current) {
          lastRoundRef.current = id;
          addEvent(`Round ${id} discovered from crank`);
        }
      }

      if (program && walletPk) {
        await refreshClaimables(program, walletPk);
      }
    } catch (err) {
      addEvent(`Status poll error: ${(err as Error).message}`);
    }
  }

  function closeSocket() {
    shouldReconnectRef.current = false;
    if (reconnectRef.current) {
      window.clearTimeout(reconnectRef.current);
      reconnectRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.onopen = null;
      wsRef.current.close();
      wsRef.current = null;
    }
  }

  function connectSocket(activeTopic: string) {
    closeSocket();
    shouldReconnectRef.current = true;
    const generation = ++wsGenerationRef.current;
    const ws = new WebSocket(APP_CONFIG.wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (generation !== wsGenerationRef.current) return;
      reconnectAttemptRef.current = 0;
      ws.send(JSON.stringify({ type: "subscribe", topic: activeTopic }));
      addEvent(`WS subscribed ${activeTopic}`);
    };

    ws.onmessage = (event) => {
      if (generation !== wsGenerationRef.current) return;

      let parsed: WsEvent;
      try {
        parsed = parseWsEvent(String(event.data));
      } catch (err) {
        addEvent(`WS parse error: ${(err as Error).message}`);
        return;
      }

      if (parsed.type === "error_v1") {
        addEvent(`WS error: ${parsed.code} ${parsed.message}`);
        return;
      }

      if (parsed.type === "round_transition_v1") {
        if (parsed.to === "BETTING_OPEN") {
          setPhaseClock({
            kind: "betting",
            roundId: parsed.roundId,
            startedAtMs: normalizeEpochMs(parsed.ts),
          });
        } else if (parsed.to === "GAME_LOOP") {
          setPhaseClock({
            kind: "game",
            roundId: parsed.roundId,
            startedAtMs: normalizeEpochMs(parsed.ts),
          });
        } else if (parsed.to === "SETTLE" || parsed.to === "CLEANUP" || parsed.to === "READY") {
          setPhaseClock((prev) =>
            prev?.roundId === parsed.roundId ? null : prev
          );
        }
        addEvent(
          `Round ${parsed.roundId} transition ${parsed.from} -> ${parsed.to}`
        );
        return;
      }

      if (parsed.type === "snapshot_v1") {
        setRoundState(parsed.roundState);
        const derivedClock = derivePhaseClockFromRoundState(parsed.roundState);
        if (derivedClock) {
          setPhaseClock((prev) => {
            if (
              prev &&
              prev.roundId === derivedClock.roundId &&
              prev.kind === derivedClock.kind
            ) {
              return prev;
            }
            return derivedClock;
          });
        } else {
          setPhaseClock((prev) =>
            prev?.roundId === parsed.roundState.roundId ? null : prev
          );
        }
        if (parsed.roundState.status === "Settled" && program && walletPk) {
          refreshClaimables(program, walletPk);
        }
        addEvent(
          `Snapshot round ${parsed.roundState.roundId} move ${parsed.roundState.moveCount}`
        );
        return;
      }

      if (parsed.type === "round_state_v1") {
        setRoundState(parsed);
        const derivedClock = derivePhaseClockFromRoundState(parsed);
        if (derivedClock) {
          setPhaseClock((prev) => {
            if (
              prev &&
              prev.roundId === derivedClock.roundId &&
              prev.kind === derivedClock.kind
            ) {
              return prev;
            }
            return derivedClock;
          });
        } else {
          setPhaseClock((prev) =>
            prev?.roundId === parsed.roundId ? null : prev
          );
        }
        if (parsed.status === "Settled" && program && walletPk) {
          refreshClaimables(program, walletPk);
        }
      }
    };

    ws.onclose = () => {
      if (!shouldReconnectRef.current) return;
      if (generation !== wsGenerationRef.current) return;
      const delay = Math.min(5000, 500 * 2 ** reconnectAttemptRef.current);
      reconnectAttemptRef.current += 1;
      addEvent(`WS disconnected, retrying in ${delay}ms`);
      reconnectRef.current = window.setTimeout(() => {
        if (!shouldReconnectRef.current) return;
        if (generation !== wsGenerationRef.current) return;
        connectSocket(activeTopic);
      }, delay);
    };

    ws.onerror = () => {
      if (generation !== wsGenerationRef.current) return;
      ws.close();
    };
  }

  async function submitBet() {
    if (!walletPk || !program || !roundId) return;
    try {
      setBusy("placing_bet");
      const amount = lamportsFromSol(betAmountSol);
      const sig = await placeBet(program, walletPk, roundId, betChoice, amount);
      addEvent(`place_bet success: ${sig.slice(0, 12)}...`);
      await refreshBalance(walletPk);
      await refreshClaimables(program, walletPk);
      // Publish bet event to Tapestry social layer (fire-and-forget)
      if (tapestryProfileId) {
        publishBetEvent(tapestryProfileId, {
          roundId: roundId.toString(),
          choice: betChoice,
          amountSol: parseFloat(betAmountSol),
          txSig: sig,
        }).catch(() => null);
      }
    } catch (err) {
      addEvent(`place_bet failed: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function submitClaim() {
    if (!walletPk || !program || !selectedClaimRound) return;
    const claimRoundId = BigInt(selectedClaimRound);
    try {
      setBusy("claiming");
      const bet = await fetchBet(program, claimRoundId, walletPk);
      if (!bet) {
        addEvent(
          `claim_winnings blocked: no bet account for round ${claimRoundId.toString()}`
        );
        return;
      }
      const sig = await claimWinnings(program, walletPk, claimRoundId);
      addEvent(`claim_winnings success: ${sig.slice(0, 12)}...`);
      await refreshClaimables(program, walletPk);
      await refreshBalance(walletPk);
    } catch (err) {
      addEvent(`claim_winnings failed: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    const currentPk = adapterPublicKey?.toBase58() ?? null;
    if (walletSyncRef.current === currentPk) return;
    walletSyncRef.current = currentPk;

    if (!adapterPublicKey) {
      setWalletPk(null);
      setTapestryProfileId(null);
      setProgram(null);
      setBalanceSol(null);
      setClaimableRounds([]);
      setSelectedClaimRound("");
      setUserBetRounds([]);
      addEvent("Wallet disconnected");
      return;
    }

    setWalletPk(adapterPublicKey);

    if (!signTransaction || !signAllTransactions) {
      addEvent("Wallet signer unavailable");
      return;
    }

    const walletAdapter = createWalletAdapter({
      publicKey: adapterPublicKey,
      signTransaction,
      signAllTransactions,
    });
    const p = createProgram(connection, walletAdapter);
    setProgram(p);
    refreshBalance(adapterPublicKey).catch(() => null);
    refreshClaimables(p, adapterPublicKey).catch(() => null);
    addEvent(`Wallet connected: ${adapterPublicKey.toBase58()}`);

    // Register / fetch Tapestry profile — store the ID for feed + bet events
    findOrCreateProfile(adapterPublicKey.toBase58())
      .then((profile) => {
        if (profile?.id) {
          setTapestryProfileId(profile.id);
          addEvent(`Social profile ready: ${profile.id}`);
        } else {
          addEvent("Social profile unavailable");
        }
      })
      .catch(() => null);
  }, [adapterPublicKey, connection, signAllTransactions, signTransaction]);

  useEffect(() => {
    pollCrankStatus();
    const id = window.setInterval(() => {
      pollCrankStatus();
    }, 3500);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [program, walletPk]);

  useEffect(() => {
    if (!topic) return;
    setRoundState(null);
    setPhaseClock(null);
    connectSocket(topic);
    return () => closeSocket();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic]);

  useEffect(() => {
    if (uiRound.state !== "BettingOpen") return;
    setClockNowMs(Date.now());
    const id = window.setInterval(() => {
      setClockNowMs(Date.now());
    }, 250);
    return () => window.clearInterval(id);
  }, [uiRound.state, phaseClockForCurrentRound?.roundId, phaseClockForCurrentRound?.kind]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!walletMenuOpen) return;
      const target = event.target as Node | null;
      if (walletMenuRef.current && target && !walletMenuRef.current.contains(target)) {
        setWalletMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [walletMenuOpen]);

  const isHome = location.pathname === "/";
  const isFeed = location.pathname === "/feed";
  const isProfile = location.pathname === "/profile";

  return (
    <main className="app-shell">
      <section className="rail-grid">
        <div className="rail-main">
          {/* ── Route content ── */}
          <div className="route-content">
            <Routes>
              <Route
                path="/feed"
                element={
                  <FeedPage
                    profileId={tapestryProfileId}
                    walletConnected={Boolean(walletPk)}
                    liveEvents={events}
                    onConnectWallet={connectWallet}
                  />
                }
              />
              <Route path="/profile" element={<ProfilePage walletPk={walletPk} profileId={tapestryProfileId} />} />
              <Route path="/" element={
                <>
                  <Panel className="score-shell">
                    <div className="center-state">
                      <div className={`status-pill ${uiRound.bannerTone}`}>
                        <span className="status-dot" />
                        {uiRound.statusLabel}
                      </div>
                      <div className="scoreline-wrap">
                        <svg className="phase-ring" viewBox="0 0 120 120" aria-hidden="true">
                          <circle
                            className="phase-ring-bg"
                            cx="60"
                            cy="60"
                            r={PHASE_RING_RADIUS}
                          />
                          <circle
                            className={`phase-ring-progress ${ringTone}`}
                            cx="60"
                            cy="60"
                            r={PHASE_RING_RADIUS}
                            strokeDasharray={PHASE_RING_CIRCUMFERENCE}
                            strokeDashoffset={ringDashOffset}
                          />
                        </svg>
                        <div className="scoreline">{scorelineText}</div>
                      </div>
                      <span className="round-meta">
                        Round #{roundId?.toString() ?? "-"} · Move {roundState?.moveCount ?? 0}
                      </span>
                    </div>
                  </Panel>

                  <section className="boards">
                    <SnakeBoard
                      side="alpha"
                      title="Alpha"
                      alive={roundState?.alphaAlive ?? false}
                      board={roundState?.alphaBoard ?? EMPTY_BOARD}
                    />
                    <SnakeBoard
                      side="beta"
                      title="Beta"
                      alive={roundState?.betaAlive ?? false}
                      board={roundState?.betaBoard ?? EMPTY_BOARD}
                    />
                  </section>

                  <Panel className="action-shell">
                    <div className="bet-grid">
                      <div className="segmented">
                        <LcdButton
                          variant="tab"
                          active={betChoice === "alpha"}
                          icon="circle"
                          onClick={() => setBetChoice("alpha")}
                        >
                          Alpha
                        </LcdButton>
                        <LcdButton
                          variant="tab"
                          active={betChoice === "beta"}
                          icon="change_history"
                          onClick={() => setBetChoice("beta")}
                        >
                          Beta
                        </LcdButton>
                      </div>
                      <label className="field">
                        <span>Bet Amount (SOL)</span>
                        <LcdInput
                          value={betAmountSol}
                          onChange={(e) => setBetAmountSol(e.target.value)}
                          placeholder="0.02 (min 0.01, max 1)"
                        />
                      </label>
                      <LcdButton
                        variant="primary"
                        disabled={!canBet}
                        onClick={submitBet}
                      >
                        {busy === "placing_bet" ? "Placing..." : "Place Bet"}
                      </LcdButton>
                      <LcdButton
                        variant="secondary"
                        disabled={!program || !walletPk}
                        onClick={() => {
                          if (program && walletPk) refreshClaimables(program, walletPk);
                        }}
                      >
                        Refresh
                      </LcdButton>
                    </div>

                    <div className="claim-grid">
                      <label className="field">
                        <span>Claim Round</span>
                        <LcdSelect
                          value={selectedClaimRound}
                          onChange={(e) => setSelectedClaimRound(e.target.value)}
                        >
                          {claimableRounds.length === 0 ? (
                            <option value="">No claimable wins</option>
                          ) : null}
                          {claimableRounds.map((r) => (
                            <option key={r.toString()} value={r.toString()}>
                              Round {r.toString()}
                            </option>
                          ))}
                        </LcdSelect>
                      </label>
                      <LcdButton
                        variant="secondary"
                        disabled={!canClaim}
                        onClick={submitClaim}
                      >
                        {busy === "claiming" ? "Claiming..." : "Claim Winnings"}
                      </LcdButton>
                    </div>

                  </Panel>

                  {/* <section className="meta-grid">
            <Panel className="meta-card">
              <div className="meta-title">Round</div>
              <div className="meta-line">ID: {roundId?.toString() ?? "-"}</div>
              <div className="meta-line">Status: {roundState?.status ?? "-"}</div>
              <div className="meta-line">Winner: {roundState?.winner ?? "-"}</div>
              <div className="meta-line">
                Crank phase: {crankStatus?.orchestrator.phase ?? "-"}
              </div>
            </Panel>
            <Panel className="meta-card">
              <div className="meta-title">Wallet</div>
              <div className="meta-line">
                Balance: {balanceSol == null ? "-" : `${balanceSol.toFixed(4)} SOL`}
              </div>
              <div className="meta-line">
                Claimables: {claimableRounds.length.toString()}
              </div>
              <div className="meta-line">Bet rounds: {userBetRounds.length}</div>
            </Panel>
            <Panel className="meta-card">
              <div className="meta-title">Gateway</div>
              <div className="meta-line">WS: {APP_CONFIG.wsUrl}</div>
              <div className="meta-line">Topic: {topic ?? "-"}</div>
              <div className="meta-line">
                Clients: {crankStatus?.ws.clients ?? 0}
              </div>
              <div className="meta-line">Topics: {crankStatus?.ws.topics ?? 0}</div>
            </Panel>
          </section>

          <Panel className="events">
            <div className="meta-title">Event Log</div>
            {events.length === 0 ? <div className="meta-line">No events yet</div> : null}
            {events.map((eventLine, idx) => (
              <div className="event" key={`${idx}-${eventLine}`}>
                {eventLine}
              </div>
            ))}
          </Panel> */}
                </>
              } />
            </Routes>
          </div>

          {/* ── Global toolbar — always visible on every route ── */}
          <div className="toolbar">
            <div className="toolbar-nav">
              <NavTabButton active={isHome} onClick={() => navigate("/")}>Live</NavTabButton>
              <NavTabButton active={isFeed} onClick={() => navigate("/feed")}>Feed</NavTabButton>
              <NavTabButton>Ranking</NavTabButton>
            </div>
            <div className="toolbar-wallet">
              {!walletPk ? (
                <LcdButton
                  variant="primary"
                  icon="power_settings_new"
                  className="toolbar-power-btn"
                  aria-label="Connect Wallet"
                  title="Connect Wallet"
                  onClick={connectWallet}
                />
              ) : (
                <div className="wallet-menu-wrap" ref={walletMenuRef}>
                  <LcdButton
                    variant="secondary"
                    icon="account_balance_wallet"
                    className="wallet-trigger"
                    aria-label={`Wallet ${short(walletPk.toBase58())}`}
                    title={walletPk.toBase58()}
                    onClick={() => setWalletMenuOpen((v) => !v)}
                  >
                    {short(walletPk.toBase58())}
                  </LcdButton>
                  {walletMenuOpen ? (
                    <div className="wallet-dropdown" role="menu">
                      <button
                        type="button"
                        className="wallet-menu-item"
                        onClick={() => { setWalletMenuOpen(false); navigate("/profile"); }}
                      >
                        <span className="material-symbols-outlined wallet-menu-icon" aria-hidden="true">person</span>
                        <span>Profile</span>
                      </button>
                      <button
                        type="button"
                        className="wallet-menu-item"
                        onClick={() => {
                          setWalletMenuOpen(false);
                          setWalletModalVisible(true);
                        }}
                      >
                        <span className="material-symbols-outlined wallet-menu-icon" aria-hidden="true">sync_alt</span>
                        <span>Switch Wallet</span>
                      </button>
                      <button
                        type="button"
                        className="wallet-menu-item"
                        onClick={disconnectWallet}
                      >
                        <span className="material-symbols-outlined wallet-menu-icon" aria-hidden="true">logout</span>
                        <span>Logout</span>
                      </button>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
