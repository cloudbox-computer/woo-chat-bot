import { env } from "./env.ts";

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function key(): Promise<CryptoKey> {
  const secret = env("CONVERSATION_SIGNING_SECRET")?.trim();
  if (!secret || secret.length < 32) throw new Error("CONVERSATION_SIGNING_SECRET must be at least 32 characters");
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function payload(chatbotId: string, conversationId: string): Uint8Array {
  return enc.encode(`v1:${chatbotId}:${conversationId}`);
}

export async function signConversation(chatbotId: string, conversationId: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await key(), payload(chatbotId, conversationId));
  return `v1.${b64url(new Uint8Array(sig))}`;
}

export async function verifyConversation(
  chatbotId: string,
  conversationId: string,
  token?: string,
): Promise<boolean> {
  if (!token?.startsWith("v1.")) return false;
  const raw = token.slice(3).replace(/-/g, "+").replace(/_/g, "/");
  try {
    const bin = atob(raw.padEnd(raw.length + ((4 - raw.length % 4) % 4), "="));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return crypto.subtle.verify("HMAC", await key(), bytes, payload(chatbotId, conversationId));
  } catch {
    return false;
  }
}
