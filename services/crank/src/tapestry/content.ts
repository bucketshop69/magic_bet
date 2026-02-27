import { TapestryClient } from "./client";
import { findOrCreateProfile } from "./profiles";

export async function publishBetEvent(
  client: TapestryClient,
  params: {
    roundId: number | string;
    walletPubkey: string;
    choice: string;
    amountSol: number;
    txSig?: string;
  }
) {
  if (!client.isConfigured) return;

  const profile = await findOrCreateProfile(client, params.walletPubkey);
  if (!profile || !profile.id) return;

  const contentId = `bet-${params.roundId}-${params.walletPubkey}`;
  const text = `Bet ${params.amountSol} SOL on ${params.choice.toUpperCase()} in Round #${params.roundId}`;

  const properties = [
    { key: "type", value: "bet" },
    { key: "round_id", value: String(params.roundId) },
    { key: "ai_choice", value: params.choice },
    { key: "amount_sol", value: String(params.amountSol) },
  ];
  if (params.txSig) {
    properties.push({ key: "tx_sig", value: params.txSig });
  }

  const body = {
    id: contentId,
    profileId: profile.id,
    properties: [...properties, { key: "text", value: text }],
    execution: "FAST_UNCONFIRMED",
  };

  await client.request("/contents/findOrCreate", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function publishRoundResult(
  client: TapestryClient,
  houseWallet: string,
  params: {
    roundId: number | string;
    winner: string;
    alphaScore?: number;
    betaScore?: number;
  }
) {
  if (!client.isConfigured) return;

  const profile = await findOrCreateProfile(client, houseWallet);
  if (!profile || !profile.id) return;
  const winner = params.winner.toLowerCase();
  const isKnownWinner = winner === "alpha" || winner === "beta" || winner === "draw";

  const contentId = `result-${params.roundId}`;
  const text =
    winner === "draw"
      ? `Round #${params.roundId} settled in a DRAW.`
      : isKnownWinner
      ? `Round #${params.roundId} settled — ${winner.toUpperCase()} wins!` +
        (params.alphaScore != null && params.betaScore != null
          ? ` (score: ${params.alphaScore} vs ${params.betaScore})`
          : "")
      : `Round #${params.roundId} settled.`;

  const properties = [
    { key: "type", value: "round_result" },
    { key: "round_id", value: String(params.roundId) },
    { key: "winner", value: winner },
  ];
  if (params.alphaScore != null) {
    properties.push({ key: "alpha_score", value: String(params.alphaScore) });
  }
  if (params.betaScore != null) {
    properties.push({ key: "beta_score", value: String(params.betaScore) });
  }

  const body = {
    id: contentId,
    profileId: profile.id,
    properties: [...properties, { key: "text", value: text }],
    execution: "FAST_UNCONFIRMED",
  };

  await client.request("/contents/findOrCreate", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
