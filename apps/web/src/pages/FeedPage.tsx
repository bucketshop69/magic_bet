import { useEffect, useState } from "react";
import { LcdButton } from "../components/ui/LcdButton";
import {
  getActivityFeed,
  getGlobalRoundResults,
  getProfileContent,
  type ActivityItem,
  type ContentItem,
} from "../lib/tapestry";

interface Props {
  profileId: string | null;
  walletConnected: boolean;
  liveEvents: string[];
  onConnectWallet: () => void | Promise<void>;
}

interface FeedEntry {
  key: string;
  text: string;
  timestamp?: number;
}

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function normalizeFeedText(text: string): string {
  return text.replace(/settled\s+[-—]\s+UNKNOWN wins!?/i, "settled.");
}

function activityLabel(item: ActivityItem): string {
  switch (item.type) {
    case "new_content":
      return item.activity.toLowerCase().includes(item.actor_username.toLowerCase())
        ? item.activity
        : `${item.actor_username} ${item.activity}`;
    case "new_follower":
      return `${item.actor_username} started following you`;
    case "following":
      return item.activity.toLowerCase().includes(item.actor_username.toLowerCase())
        ? item.activity
        : `${item.actor_username} ${item.activity}`;
    default:
      return item.activity;
  }
}

function mapRoundLifecycleEvents(liveEvents: string[]): FeedEntry[] {
  const out: FeedEntry[] = [];
  const seen = new Set<string>();

  for (const line of liveEvents) {
    const match = line.match(/^Round (\d+) transition [A-Z_]+ -> ([A-Z_]+)$/);
    if (!match) continue;

    const roundId = match[1] ?? "";
    const nextPhase = match[2] ?? "";

    let statusLabel: string | null = null;
    if (nextPhase === "BETTING_OPEN") statusLabel = "Betting open";
    if (nextPhase === "GAME_LOOP") statusLabel = "Game started";
    if (nextPhase === "SETTLE") statusLabel = "Game ended";
    if (!statusLabel) continue;

    const dedupeKey = `${roundId}:${statusLabel}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push({
      key: `lifecycle-${dedupeKey}`,
      text: `Round ${roundId} ${statusLabel}`,
    });
  }

  return out.slice(0, 12);
}

export function FeedPage({
  profileId,
  walletConnected,
  liveEvents,
  onConnectWallet,
}: Props) {
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [myBets, setMyBets] = useState<ContentItem[]>([]);
  const [roundResults, setRoundResults] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const lifecycleEvents = mapRoundLifecycleEvents(liveEvents);

  async function loadFeed() {
    setLoading(true);
    try {
      const socialPromise = profileId
        ? getActivityFeed(profileId).then((resp) => resp?.activities ?? [])
        : Promise.resolve<ActivityItem[]>([]);
      const myBetsPromise = profileId
        ? getProfileContent(profileId, 20).then((items) =>
            items.filter(
              (c) =>
                c.properties?.some((p) => p.key === "type" && p.value === "bet") ||
                c.text.toLowerCase().startsWith("bet ")
            )
          )
        : Promise.resolve<ContentItem[]>([]);
      const resultsPromise = getGlobalRoundResults(20);

      const [socialItems, myBetItems, roundResultItems] = await Promise.all([
        socialPromise,
        myBetsPromise,
        resultsPromise,
      ]);

      setActivities(socialItems);
      setMyBets(myBetItems);
      setRoundResults(roundResultItems);
    } catch {
      setActivities([]);
      setMyBets([]);
      setRoundResults([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadFeed();
    const id = window.setInterval(loadFeed, 15_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, walletConnected]);

  const unifiedEntries: FeedEntry[] = [];
  const seen = new Set<string>();

  for (const item of activities) {
    const entry: FeedEntry = {
      key: `social-${item.actor_id}-${item.timestamp}-${item.type}`,
      text: normalizeFeedText(activityLabel(item)),
      timestamp: item.timestamp,
    };
    const dedupeKey = `${entry.text}|${entry.timestamp ?? ""}`;
    if (!seen.has(dedupeKey)) {
      seen.add(dedupeKey);
      unifiedEntries.push(entry);
    }
  }

  for (const item of myBets) {
    const entry: FeedEntry = {
      key: `my-bet-${item.id}`,
      text: normalizeFeedText(item.text),
      timestamp: item.created_at,
    };
    const dedupeKey = `${entry.text}|${entry.timestamp ?? ""}`;
    if (!seen.has(dedupeKey)) {
      seen.add(dedupeKey);
      unifiedEntries.push(entry);
    }
  }

  for (const item of roundResults) {
    const entry: FeedEntry = {
      key: `round-result-${item.id}`,
      text: normalizeFeedText(item.text),
      timestamp: item.created_at,
    };
    const dedupeKey = `${entry.text}|${entry.timestamp ?? ""}`;
    if (!seen.has(dedupeKey)) {
      seen.add(dedupeKey);
      unifiedEntries.push(entry);
    }
  }

  unifiedEntries.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
  const finalEntries = [...unifiedEntries, ...lifecycleEvents];

  return (
    <div className="feed-page">
      <div className="feed-header">
        <span className="meta-title">Feed</span>
        {profileId ? (
          <button className="feed-refresh" onClick={loadFeed} title="Refresh">
            ↻
          </button>
        ) : null}
      </div>

      {!profileId && (
        <div className="feed-empty">
          <p>Social feed is personalized by follows.</p>
          <p className="feed-hint">
            {walletConnected
              ? "Wallet connected. Initializing your social profile..."
              : "Connect wallet to load your feed."}
          </p>
          {!walletConnected ? (
            <div className="feed-connect-wrap">
              <LcdButton
                variant="primary"
                icon="power_settings_new"
                className="feed-connect-btn"
                onClick={onConnectWallet}
              >
                Connect Wallet
              </LcdButton>
            </div>
          ) : null}
        </div>
      )}

      {profileId && loading && (
        <div className="feed-empty">
          <p>Loading…</p>
        </div>
      )}

      {!loading && finalEntries.length === 0 && (
        <div className="feed-empty">
          <p>No activity yet.</p>
          <p className="feed-hint">Waiting for bets and round results...</p>
        </div>
      )}

      {!loading && finalEntries.length > 0 ? (
        <ul className="feed-list">
          {finalEntries.map((entry) => (
            <li key={entry.key} className="feed-item">
              <div className="feed-activity">{entry.text}</div>
              {entry.timestamp ? (
                <div className="feed-time">{timeAgo(entry.timestamp)}</div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
