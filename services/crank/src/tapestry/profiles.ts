import { TapestryClient } from "./client";

type Profile = {
  id: string;
  username: string;
  namespace: string;
  created_at: number;
};

export async function findOrCreateProfile(
  client: TapestryClient,
  walletAddress: string
): Promise<Profile | null> {
  if (!client.isConfigured) return null;

  const username = walletAddress.slice(0, 4) + walletAddress.slice(-4);

  const body = {
    username,
    walletAddress,
    blockchain: "SOLANA",
    execution: "FAST_UNCONFIRMED",
  };

  const resp = await client.request("/profiles/findOrCreate", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!resp || typeof resp !== "object") return null;
  const candidate = (resp as { profile?: unknown }).profile ?? resp;
  if (!candidate || typeof candidate !== "object") return null;
  if (typeof (candidate as { id?: unknown }).id !== "string") return null;
  return candidate as Profile;
}
