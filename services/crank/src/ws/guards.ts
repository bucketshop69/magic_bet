import { WsClientMessage } from "./protocol";

export function parseClientMessage(raw: string): WsClientMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  if (obj.type !== "subscribe") return null;
  if (typeof obj.topic !== "string") return null;
  if (!obj.topic.startsWith("round:")) return null;
  if (obj.topic.length < 8) return null;
  return { type: "subscribe", topic: obj.topic };
}
