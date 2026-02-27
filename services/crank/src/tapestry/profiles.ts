import { TapestryClient } from "./client";

export async function findOrCreateProfile(
  client: TapestryClient,
  walletAddress: string
) {
  if (!client.isConfigured) return null;

  const username =
    walletAddress.slice(0, 4) + "..." + walletAddress.slice(-4);

  const body = {
    username,
    walletAddress,
    blockchain: "solana",
    execution: "FAST_UNCONFIRMED",
  };

  const resp = await client.request("/profiles", {
    method: "POST",
    body: JSON.stringify(body),
  });

  return resp; // Return the profile object
}
