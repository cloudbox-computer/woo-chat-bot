import { env } from "./env.ts";

const enc = new TextEncoder();
const dec = new TextDecoder();
const PREFIX = "enc:v1:";

function b64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function unb64(value: string): Uint8Array {
  const raw = atob(value);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
async function key(): Promise<CryptoKey> {
  const raw = env("INTEGRATION_ENCRYPTION_KEY")?.trim() ?? "";
  if (!raw) throw new Error("INTEGRATION_ENCRYPTION_KEY is required");
  const material = await crypto.subtle.digest("SHA-256", enc.encode(raw));
  return crypto.subtle.importKey("raw", material, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export function isEncryptedSecret(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(PREFIX);
}
export async function encryptSecret(value: string | undefined | null): Promise<string | undefined> {
  if (!value) return undefined;
  if (isEncryptedSecret(value)) return value;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), enc.encode(value)));
  return `${PREFIX}${b64(iv)}:${b64(cipher)}`;
}
export async function decryptSecret(value: unknown): Promise<string | undefined> {
  if (typeof value !== "string" || !value) return undefined;
  if (!isEncryptedSecret(value)) return value; // migration compatibility
  const [, , iv64, cipher64] = value.split(":");
  if (!iv64 || !cipher64) throw new Error("Invalid encrypted secret format");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv64) }, await key(), unb64(cipher64));
  return dec.decode(plain);
}
