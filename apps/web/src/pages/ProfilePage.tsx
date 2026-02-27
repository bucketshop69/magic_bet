import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import {
  getProfile,
  getFollowers,
  getFollowing,
  getProfileContent,
  type TapestryProfile,
  type ContentItem,
} from "../lib/tapestry";

interface Props {
  walletPk: PublicKey | null;
  profileId: string | null;
}

function short(pk: string): string {
  return `${pk.slice(0, 4)}...${pk.slice(-4)}`;
}

export function ProfilePage({ walletPk, profileId }: Props) {
  const [profile, setProfile] = useState<TapestryProfile | null>(null);
  const [followerCount, setFollowerCount] = useState<number | null>(null);
  const [followingCount, setFollowingCount] = useState<number | null>(null);
  const [recentBets, setRecentBets] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profileId) {
      setLoading(false);
      return;
    }

    async function loadProfile() {
      setLoading(true);
      try {
        const [profileData, followers, following, content] = await Promise.all([
          getProfile(profileId!),
          getFollowers(profileId!, 100),
          getFollowing(profileId!, 100),
          getProfileContent(profileId!, 10),
        ]);

        setProfile(profileData);
        setFollowerCount(followers?.profiles.length ?? 0);
        setFollowingCount(following?.profiles.length ?? 0);
        setRecentBets(
          content.filter((c) =>
            c.properties?.some((p) => p.key === "type" && p.value === "bet") ||
            c.text.toLowerCase().startsWith("bet ")
          )
        );
      } catch {
        // silently degrade — show wallet only
      } finally {
        setLoading(false);
      }
    }

    loadProfile();
  }, [profileId]);

  if (!walletPk) {
    return (
      <div className="profile-page">
        <div className="feed-empty">
          <p>Connect your wallet to view your profile.</p>
        </div>
      </div>
    );
  }

  const walletStr = walletPk.toBase58();

  return (
    <div className="profile-page">
      <div className="profile-header">
        <div className="profile-avatar">
          {(profile?.username ?? short(walletStr)).slice(0, 2).toUpperCase()}
        </div>
        <div className="profile-identity">
          <div className="profile-username">
            {loading ? "Loading…" : (profile?.username ?? short(walletStr))}
          </div>
          <div className="profile-wallet">{short(walletStr)}</div>
          {profile?.bio && (
            <div className="profile-bio">{profile.bio}</div>
          )}
        </div>
      </div>

      <div className="profile-counts">
        <div className="profile-count-item">
          <span className="profile-count-value">
            {followerCount ?? "—"}
          </span>
          <span className="profile-count-label">Followers</span>
        </div>
        <div className="profile-count-divider" />
        <div className="profile-count-item">
          <span className="profile-count-value">
            {followingCount ?? "—"}
          </span>
          <span className="profile-count-label">Following</span>
        </div>
      </div>

      <div className="profile-section-title">Recent Bets</div>
      {recentBets.length === 0 && !loading && (
        <div className="feed-empty">
          <p>No bets recorded yet.</p>
        </div>
      )}
      <ul className="feed-list">
        {recentBets.map((item) => (
          <li key={item.id} className="feed-item">
            <div className="feed-activity">{item.text}</div>
            <div className="feed-time">
              {new Date(item.created_at).toLocaleString()}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
