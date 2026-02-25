import { useEffect, useMemo, useRef, useState } from "react";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
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
import type { RoundStateV1, WsEvent } from "./types/ws";
import { SnakeBoard } from "./components/SnakeBoard";
import "./styles.css";

type CrankStatus = {
  orchestrator?: {
    currentRoundId?: string | null;
    phase?: string;
  };
  ws?: {
    clients?: number;
    topics?: number;
    subscriptions?: number;
  };
};

const EMPTY_BOARD = new Array(400).fill(0);

function short(pk?: string) {
  if (!pk) return "-";
  return `${pk.slice(0, 4)}...${pk.slice(-4)}`;
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

  const canBet = roundState?.status === "Active";
  const canClaim = !!walletPk && selectedClaimRound.length > 0;

  const addEvent = (line: string) => {
    setEvents((prev) => [line, ...prev].slice(0, 14));
  };

  const topic = useMemo(() => {
    if (!roundId) return null;
    return `round:${roundId.toString()}`;
  }, [roundId]);

  function winnerKey(value: unknown): "alpha" | "beta" | "draw" | null {
    if (!value || typeof value !== "object") return null;
    const keys = Object.keys(value as Record<string, unknown>);
    if (keys.length === 0) return null;
    const k = keys[0]?.toLowerCase();
    if (k === "alpha" || k === "beta" || k === "draw") return k;
    return null;
  }

  async function refreshClaimables(p: anchor.Program, user: PublicKey) {
    try {
      const allBets = await (p.account as any).bet.all();
      const mine = allBets.filter(
        (entry: any) =>
          entry.account?.user?.toBase58?.() === user.toBase58() &&
          !entry.account?.claimed
      );

      const winningRoundIds: bigint[] = [];
      for (const entry of mine) {
        const round = BigInt(entry.account.roundId.toString());
        const roundAccount = await fetchRound(p, round);
        if (!roundAccount) continue;
        const winner = winnerKey(roundAccount.winner);
        if (!winner || winner === "draw") continue;
        const choice = winnerKey(entry.account.choice);
        if (choice === winner) {
          winningRoundIds.push(round);
        }
      }

      const uniqueDesc = Array.from(new Set(winningRoundIds.map(String)))
        .map((v) => BigInt(v))
        .sort((a, b) => (a > b ? -1 : 1));
      setClaimableRounds(uniqueDesc);
      if (uniqueDesc.length === 0) {
        setSelectedClaimRound("");
      } else if (
        !selectedClaimRound ||
        !uniqueDesc.some((r) => r.toString() === selectedClaimRound)
      ) {
        setSelectedClaimRound(uniqueDesc[0].toString());
      }
      addEvent(`Claimable rounds refreshed: ${uniqueDesc.length}`);
    } catch (err) {
      addEvent(`claimable refresh failed: ${(err as Error).message}`);
    }
  }

  async function refreshBalance(pk: PublicKey) {
    const balance = await connection.getBalance(pk, "confirmed");
    setBalanceSol(balance / anchor.web3.LAMPORTS_PER_SOL);
  }

  async function connectWallet() {
    if (!window.solana?.isPhantom) {
      addEvent("Phantom not found. Install Phantom extension.");
      return;
    }
    const res = await window.solana.connect();
    setWalletPk(res.publicKey);
    const wallet = createWalletAdapter();
    const p = createProgram(connection, wallet);
    setProgram(p);
    await refreshBalance(res.publicKey);
    await refreshClaimables(p, res.publicKey);
    addEvent(`Wallet connected: ${res.publicKey.toBase58()}`);
  }

  async function disconnectWallet() {
    if (window.solana) await window.solana.disconnect();
    setWalletPk(null);
    setProgram(null);
    setBalanceSol(null);
    addEvent("Wallet disconnected");
  }

  async function pollCrankStatus() {
    try {
      const r = await fetch(`${APP_CONFIG.crankHttpUrl}/status`);
      if (!r.ok) throw new Error(`status ${r.status}`);
      const data = (await r.json()) as CrankStatus;
      setCrankStatus(data);
      const id = data.orchestrator?.currentRoundId;
      if (id) {
        const parsed = BigInt(id);
        setRoundId(parsed);
        if (program) {
          const onChain = await fetchRound(program, parsed);
          if (onChain) {
            addEvent(`Round ${parsed.toString()} fetched from L1`);
          }
          if (walletPk) {
            await refreshClaimables(program, walletPk);
          }
        }
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
      const parsed = JSON.parse(String(event.data)) as WsEvent;
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
  }, [program]);

  useEffect(() => {
    if (!topic) return;
    setRoundState(null);
    connectSocket(topic);
    return () => closeSocket();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic]);

  return (
    <main className="layout">
      <section className="topbar">
        <div>
          <h1>Magic Bet | Pass A</h1>
          <p>Functional web control room for round stream + L1 actions.</p>
        </div>
        <div className="wallet-box">
          <div>Wallet: {walletPk ? short(walletPk.toBase58()) : "Disconnected"}</div>
          <div>Balance: {balanceSol == null ? "-" : `${balanceSol.toFixed(4)} SOL`}</div>
          <div className="wallet-actions">
            {!walletPk ? (
              <button onClick={connectWallet}>Connect Phantom</button>
            ) : (
              <button className="ghost" onClick={disconnectWallet}>
                Disconnect
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="status-grid">
        <div className="card">
          <h2>Round</h2>
          <div>ID: {roundId?.toString() ?? "-"}</div>
          <div>Status: {roundState?.status ?? "-"}</div>
          <div>Move: {roundState?.moveCount ?? 0}</div>
          <div>Winner: {roundState?.winner ?? "-"}</div>
          <div>Crank phase: {crankStatus?.orchestrator?.phase ?? "-"}</div>
        </div>

        <div className="card">
          <h2>Bet</h2>
          <label>
            Choice
            <select
              value={betChoice}
              onChange={(e) => setBetChoice(e.target.value as Choice)}
            >
              <option value="alpha">Alpha</option>
              <option value="beta">Beta</option>
            </select>
          </label>
          <label>
            Amount (SOL)
            <input
              value={betAmountSol}
              onChange={(e) => setBetAmountSol(e.target.value)}
              placeholder="0.02 (min 0.01, max 1)"
            />
          </label>
          <button disabled={!walletPk || !canBet || !!busy} onClick={submitBet}>
            {busy === "placing_bet" ? "Placing..." : "Place Bet (L1)"}
          </button>
          <label>
            Claim Round
            <select
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
            </select>
          </label>
          <button
            className="ghost"
            disabled={!walletPk || !canClaim || !!busy}
            onClick={submitClaim}
          >
            {busy === "claiming"
              ? "Claiming..."
              : "Claim Winnings (L1)"}
          </button>
        </div>

        <div className="card">
          <h2>Gateway</h2>
          <div>WS: {APP_CONFIG.wsUrl}</div>
          <div>Topic: {topic ?? "-"}</div>
          <div>Clients: {crankStatus?.ws?.clients ?? 0}</div>
          <div>Topics: {crankStatus?.ws?.topics ?? 0}</div>
          <div>Subs: {crankStatus?.ws?.subscriptions ?? 0}</div>
        </div>
      </section>

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

      <section className="events card">
        <h2>Event Log</h2>
        {events.length === 0 ? <div>No events yet</div> : null}
        {events.map((eventLine, idx) => (
          <div className="event" key={`${idx}-${eventLine}`}>
            {eventLine}
          </div>
        ))}
      </section>
    </main>
  );
}
