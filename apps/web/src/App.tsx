import { useEffect, useMemo, useRef, useState } from "react";
import * as anchor from "@coral-xyz/anchor";
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
  getPhantomProvider,
  lamportsFromSol,
  placeBet,
  type Choice,
} from "./lib/program";
import { deriveUiRoundView } from "./lib/uiState";
import { findOrCreateProfile } from "./lib/tapestry";
import type { CrankStatus } from "./types/contracts";
import type { RoundStateV1, WsEvent } from "./types/ws";

const EMPTY_BOARD = new Array(400).fill(0);

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

export default function App() {
  const [walletPk, setWalletPk] = useState<PublicKey | null>(null);
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

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const shouldReconnectRef = useRef(false);
  const wsGenerationRef = useRef(0);
  const lastRoundRef = useRef<string | null>(null);

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
    const phantom = getPhantomProvider();
    if (!phantom) {
      addEvent(
        "Phantom not found. Install/enable Phantom in this browser profile and reload."
      );
      return;
    }
    const res = await phantom.connect();
    setWalletPk(res.publicKey);
    const wallet = createWalletAdapter();
    const p = createProgram(connection, wallet);
    setProgram(p);
    await refreshBalance(res.publicKey);
    await refreshClaimables(p, res.publicKey);
    addEvent(`Wallet connected: ${res.publicKey.toBase58()}`);
    // Register / fetch Tapestry profile (fire-and-forget)
    findOrCreateProfile(res.publicKey.toBase58()).catch(() => null);
  }

  async function disconnectWallet() {
    const phantom = getPhantomProvider();
    if (phantom) await phantom.disconnect();
    setWalletPk(null);
    setProgram(null);
    setBalanceSol(null);
    setClaimableRounds([]);
    setSelectedClaimRound("");
    setUserBetRounds([]);
    addEvent("Wallet disconnected");
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
        addEvent(
          `Round ${parsed.roundId} transition ${parsed.from} -> ${parsed.to}`
        );
        return;
      }

      if (parsed.type === "snapshot_v1") {
        setRoundState(parsed.roundState);
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
    connectSocket(topic);
    return () => closeSocket();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic]);

  return (
    <main className="app-shell">
      <section className="rail-grid">
        <div className="rail-main">
          <Panel className="score-shell">
            <div className="score-team">
              <span className="score-label">Alpha</span>
              <div className="score-box">
                <span className="score-value">{roundState?.alphaScore ?? 0}</span>
                <span className="score-hint">Score</span>
              </div>
            </div>
            <div className="center-state">
              <div className={`status-pill ${uiRound.bannerTone}`}>
                <span className="status-dot" />
                {uiRound.statusLabel}
              </div>
              <div className="scoreline">
                {(roundState?.alphaScore ?? 0).toString()}:
                {(roundState?.betaScore ?? 0).toString()}
              </div>
              <span className="round-meta">
                Round #{roundId?.toString() ?? "-"} · Move {roundState?.moveCount ?? 0}
              </span>
            </div>
            <div className="score-team right">
              <span className="score-label">Beta</span>
              <div className="score-box">
                <span className="score-value">{roundState?.betaScore ?? 0}</span>
                <span className="score-hint">Score</span>
              </div>
            </div>
          </Panel>

          <section className="boards">
            <SnakeBoard
              title="Alpha"
              score={roundState?.alphaScore ?? 0}
              alive={roundState?.alphaAlive ?? false}
              board={roundState?.alphaBoard ?? EMPTY_BOARD}
            />
            <SnakeBoard
              title="Beta"
              score={roundState?.betaScore ?? 0}
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
                  onClick={() => setBetChoice("alpha")}
                >
                  Alpha
                </LcdButton>
                <LcdButton
                  variant="tab"
                  active={betChoice === "beta"}
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

            <div className="toolbar">
              <NavTabButton active>Live</NavTabButton>
              <NavTabButton>Ranking</NavTabButton>
              <NavTabButton>History</NavTabButton>
              {!walletPk ? (
                <LcdButton variant="primary" onClick={connectWallet}>
                  Connect Wallet
                </LcdButton>
              ) : (
                <LcdButton variant="secondary" onClick={disconnectWallet}>
                  Disconnect
                </LcdButton>
              )}
            </div>
          </Panel>

          <section className="meta-grid">
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
                Wallet: {walletPk ? short(walletPk.toBase58()) : "Disconnected"}
              </div>
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
          </Panel>
        </div>
      </section>
    </main>
  );
}
