const BASE_URL = "https://api.usetapestry.dev/api/v1";
const API_KEY = import.meta.env.VITE_TAPESTRY_API_KEY as string | undefined;
const NAMESPACE = import.meta.env.VITE_TAPESTRY_NAMESPACE ?? "magicbet";

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

// ─── Internal fetch helper ────────────────────────────────────────────────────

async function tapestryFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T | null> {
  if (!API_KEY) return null;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": API_KEY,
    ...(options.headers as Record<string, string>),
  };

  try {
    const resp = await fetch(`${BASE_URL}${endpoint}`, { ...options, headers });
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
  const username =
    walletPublicKey.slice(0, 4) + "..." + walletPublicKey.slice(-4);

  return tapestryFetch<TapestryProfile>("/profiles", {
    method: "POST",
    body: JSON.stringify({
      username,
      walletAddress: walletPublicKey,
      blockchain: "solana",
      namespace: NAMESPACE,
      execution: "FAST_UNCONFIRMED",
    }),
  });
}

/**
 * Check if this wallet already has a profile on any Tapestry app (onboarding).
 */
export async function findProfilesByWallet(
  walletPublicKey: string
): Promise<TapestryProfile[]> {
  const resp = await tapestryFetch<{ profiles: TapestryProfile[] }>(
    `/profiles?walletAddress=${walletPublicKey}`
  );
  return resp?.profiles ?? [];
}

export async function getProfile(
  profileId: string
): Promise<TapestryProfile | null> {
  return tapestryFetch<TapestryProfile>(`/profiles/${profileId}`);
}

// ─── Follows ──────────────────────────────────────────────────────────────────

export async function followProfile(
  followerId: string,
  followeeId: string
): Promise<boolean> {
  const resp = await tapestryFetch<unknown>("/follows", {
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
  const resp = await tapestryFetch<unknown>("/follows", {
    method: "DELETE",
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
    `/profiles/${followerId}/isFollowing?targetId=${followeeId}`
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
    `/feed?profileId=${profileId}&page=${page}&pageSize=${pageSize}`
  );
}
