import { env } from "./env.ts";

const enc = new TextEncoder();
const dec = new TextDecoder();
const PREFIX = "enc:v1:";

function b64(bytes: Uint8Array): string { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); }
function unb64(value: string): Uint8Array { const raw = atob(value); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); }
async function cryptoKey(secret:string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  return crypto.subtle.importKey("raw", material, "AES-GCM", false, ["encrypt", "decrypt"]);
}
function currentSecret():string { const raw=env("INTEGRATION_ENCRYPTION_KEY")?.trim()??"";if(!raw)throw new Error("INTEGRATION_ENCRYPTION_KEY is required");return raw; }
function decryptionSecrets():string[]{
  const current=currentSecret();
  const previous=(env("INTEGRATION_ENCRYPTION_KEY_PREVIOUS")??"").split(",").map(v=>v.trim()).filter(Boolean);
  return [current,...previous.filter(v=>v!==current)];
}
export function isEncryptedSecret(value: unknown): value is string { return typeof value === "string" && value.startsWith(PREFIX); }
export async function encryptSecret(value: string | undefined | null): Promise<string | undefined> {
  if (!value) return undefined;
  if (isEncryptedSecret(value)) return value;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await cryptoKey(currentSecret()), enc.encode(value)));
  return `${PREFIX}${b64(iv)}:${b64(cipher)}`;
}
export async function decryptSecret(value: unknown): Promise<string | undefined> {
  if (typeof value !== "string" || !value) return undefined;
  if (!isEncryptedSecret(value)) return value; // migration compatibility
  const [, , iv64, cipher64] = value.split(":");
  if (!iv64 || !cipher64) throw new Error("Invalid encrypted secret format");
  let last:unknown;
  for(const secret of decryptionSecrets()){
    try { const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:unb64(iv64)},await cryptoKey(secret),unb64(cipher64));return dec.decode(plain); }
    catch(e){ last=e; }
  }
  console.error("Could not decrypt integration secret with current or previous keys",last);
  throw new Error("Integration credential decryption failed");
}
