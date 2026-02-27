const CRANK_HTTP_URL =
  (import.meta.env.VITE_CRANK_HTTP_URL as string | undefined) ??
  "http://127.0.0.1:8787";
const BASE_URL =
  (import.meta.env.VITE_TAPESTRY_BASE_URL as string | undefined) ??
  `${CRANK_HTTP_URL}/social`;
const API_KEY = import.meta.env.VITE_TAPESTRY_API_KEY as string | undefined;
const NAMESPACE = import.meta.env.VITE_TAPESTRY_NAMESPACE ?? "magicbet";
const REQUIRES_API_KEY = BASE_URL.startsWith("https://api.usetapestry.dev");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TapestryProfile {
  id: string;
  username: string;
  image?: string;
  bio?: string;
  namespace: string;
  created_at: number;
}

export interface ActivityItem {
  type: "following" | "new_content" | "like" | "comment" | "new_follower";
  actor_id: string;
  actor_username: string;
  target_id?: string;
  target_username?: string;
  timestamp: number;
  activity: string;
}

export interface FeedResponse {
  activities: ActivityItem[];
  page: number;
  pageSize: number;
}

interface ProfileEnvelope {
  profile?: TapestryProfile;
}

function unwrapProfile(value: unknown): TapestryProfile | null {
  if (!value || typeof value !== "object") return null;
  const candidate = (value as ProfileEnvelope).profile ?? value;
  if (!candidate || typeof candidate !== "object") return null;
  if (typeof (candidate as TapestryProfile).id !== "string") return null;
  return candidate as TapestryProfile;
}

function unwrapProfileList(value: unknown): TapestryProfile[] {
  if (!value || typeof value !== "object") return [];
  const rawProfiles = (value as { profiles?: unknown[] }).profiles;
  if (!Array.isArray(rawProfiles)) return [];
  return rawProfiles
    .map((entry) => unwrapProfile(entry))
    .filter((entry): entry is TapestryProfile => entry !== null);
}

// ─── Internal fetch helper ────────────────────────────────────────────────────

async function tapestryFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T | null> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  const url = new URL(`${BASE_URL}${endpoint}`);
  if (REQUIRES_API_KEY) {
    if (!API_KEY) return null;
    headers["x-api-key"] = API_KEY;
    url.searchParams.set("apiKey", API_KEY);
  }

  try {
    const resp = await fetch(url.toString(), { ...options, headers });
    if (!resp.ok) {
      console.warn(
        `[tapestry] ${options.method ?? "GET"} ${endpoint} → ${resp.status}`
      );
      return null;
    }
    return (await resp.json()) as T;
  } catch (err) {
    console.warn("[tapestry] network error:", err);
    return null;
  }
}

// ─── Profile ──────────────────────────────────────────────────────────────────

/**
 * findOrCreate a Tapestry profile for the connected wallet.
 * Safe to call every time the wallet connects — idempotent.
 */
export async function findOrCreateProfile(
  walletPublicKey: string
): Promise<TapestryProfile | null> {
  const username = walletPublicKey.slice(0, 4) + walletPublicKey.slice(-4);

  const resp = await tapestryFetch<unknown>("/profiles/findOrCreate", {
    method: "POST",
    body: JSON.stringify({
      username,
      walletAddress: walletPublicKey,
      blockchain: "SOLANA",
      namespace: NAMESPACE,
      execution: "FAST_UNCONFIRMED",
    }),
  });

  return unwrapProfile(resp);
}

/**
 * Check if this wallet already has a profile on any Tapestry app (onboarding).
 */
export async function findProfilesByWallet(
  walletPublicKey: string
): Promise<TapestryProfile[]> {
  const resp = await tapestryFetch<unknown>(
    `/profiles?walletAddress=${walletPublicKey}`
  );
  return unwrapProfileList(resp);
}

export async function getProfile(
  profileId: string
): Promise<TapestryProfile | null> {
  const resp = await tapestryFetch<unknown>(`/profiles/${profileId}`);
  return unwrapProfile(resp);
}

// ─── Follows ──────────────────────────────────────────────────────────────────

export async function followProfile(
  followerId: string,
  followeeId: string
): Promise<boolean> {
  const resp = await tapestryFetch<unknown>("/followers/add", {
    method: "POST",
    body: JSON.stringify({
      startId: followerId,
      endId: followeeId,
      execution: "FAST_UNCONFIRMED",
    }),
  });
  return resp !== null;
}

export async function unfollowProfile(
  followerId: string,
  followeeId: string
): Promise<boolean> {
  const resp = await tapestryFetch<unknown>("/followers/remove", {
    method: "POST",
    body: JSON.stringify({
      startId: followerId,
      endId: followeeId,
    }),
  });
  return resp !== null;
}

export async function isFollowing(
  followerId: string,
  followeeId: string
): Promise<boolean> {
  const resp = await tapestryFetch<{ isFollowing: boolean }>(
    `/followers/state?startId=${followerId}&endId=${followeeId}`
  );
  return resp?.isFollowing ?? false;
}

// ─── Feed ─────────────────────────────────────────────────────────────────────

export async function getActivityFeed(
  profileId: string,
  page = 1,
  pageSize = 20
): Promise<FeedResponse | null> {
  return tapestryFetch<FeedResponse>(
    `/activity/feed?username=${profileId}&page=${page}&pageSize=${pageSize}`
  );
}

// ─── Bet event publishing (frontend) ─────────────────────────────────────────

/**
 * Publish a bet event to Tapestry after place_bet confirms on-chain.
 * Takes profileId directly — no extra network call needed.
 */
export async function publishBetEvent(
  profileId: string,
  params: {
    roundId: string;
    choice: string;
    amountSol: number;
    txSig?: string;
  }
): Promise<void> {
  const contentId = `bet-${params.roundId}-${profileId}`;
  const text = `Bet ${params.amountSol} SOL on ${params.choice.toUpperCase()} in Round #${params.roundId}`;

  const properties: { key: string; value: string }[] = [
    { key: "type", value: "bet" },
    { key: "round_id", value: params.roundId },
    { key: "ai_choice", value: params.choice },
    { key: "amount_sol", value: String(params.amountSol) },
    { key: "text", value: text },
  ];
  if (params.txSig) {
    properties.push({ key: "tx_sig", value: params.txSig });
  }

  await tapestryFetch<unknown>("/contents/findOrCreate", {
    method: "POST",
    body: JSON.stringify({
      id: contentId,
      profileId,
      properties,
      execution: "FAST_UNCONFIRMED",
    }),
  });
}

// ─── Profile content (recent bets) ───────────────────────────────────────────

export interface ContentItem {
  id: string;
  text: string;
  created_at: number;
  properties?: { key: string; value: string }[];
}

function mapContentItem(raw: unknown): ContentItem | null {
  if (!raw || typeof raw !== "object") return null;
  const rawObj = raw as Record<string, unknown>;
  const content =
    rawObj.content && typeof rawObj.content === "object"
      ? (rawObj.content as Record<string, unknown>)
      : rawObj;

  const id = content.id;
  const createdAtValue = content.created_at ?? rawObj.created_at;
  const createdAt = Number(createdAtValue);
  if (typeof id !== "string" || !Number.isFinite(createdAt)) return null;

  const rawProperties = Array.isArray(content.properties)
    ? content.properties
    : Array.isArray(rawObj.properties)
      ? rawObj.properties
      : [];
  const properties = rawProperties
    .map((p) => {
      if (!p || typeof p !== "object") return null;
      const key = (p as { key?: unknown }).key;
      const value = (p as { value?: unknown }).value;
      if (typeof key !== "string") return null;
      return { key, value: String(value ?? "") };
    })
    .filter((p): p is { key: string; value: string } => p !== null);

  const textFromProps = properties.find((p) => p.key === "text")?.value;
  const directText = content.text ?? rawObj.text;

  return {
    id,
    created_at: createdAt,
    text: typeof directText === "string" ? directText : textFromProps ?? "",
    properties,
  };
}

export async function getProfileContent(
  profileId: string,
  pageSize = 10
): Promise<ContentItem[]> {
  const resp = await tapestryFetch<{ contents?: unknown[] }>(
    `/contents/?profileId=${profileId}&pageSize=${pageSize}`
  );
  const rawContents = Array.isArray(resp?.contents) ? resp.contents : [];
  return rawContents
    .map((item) => mapContentItem(item))
    .filter((item): item is ContentItem => item !== null);
}

export async function getGlobalRoundResults(
  pageSize = 20
): Promise<ContentItem[]> {
  const resp = await tapestryFetch<{ contents?: unknown[] }>(
    `/contents/?filterField=type&filterValue=round_result&pageSize=${pageSize}&orderByField=created_at&orderByDirection=DESC`
  );
  const rawContents = Array.isArray(resp?.contents) ? resp.contents : [];
  return rawContents
    .map((item) => mapContentItem(item))
    .filter((item): item is ContentItem => item !== null);
}

// ─── Follow counts ────────────────────────────────────────────────────────────

export interface FollowListResponse {
  profiles: TapestryProfile[];
  page: number;
  pageSize: number;
  totalCount?: number;
}

export async function getFollowers(
  profileId: string,
  pageSize = 1
): Promise<FollowListResponse | null> {
  const resp = await tapestryFetch<unknown>(
    `/profiles/${profileId}/followers?pageSize=${pageSize}`
  );
  if (!resp || typeof resp !== "object") return null;
  const base = resp as Omit<FollowListResponse, "profiles"> & {
    profiles?: unknown[];
  };
  return {
    ...base,
    profiles: unwrapProfileList(resp),
  };
}

export async function getFollowing(
  profileId: string,
  pageSize = 1
): Promise<FollowListResponse | null> {
  const resp = await tapestryFetch<unknown>(
    `/profiles/${profileId}/following?pageSize=${pageSize}`
  );
  if (!resp || typeof resp !== "object") return null;
  const base = resp as Omit<FollowListResponse, "profiles"> & {
    profiles?: unknown[];
  };
  return {
    ...base,
    profiles: unwrapProfileList(resp),
  };
}
