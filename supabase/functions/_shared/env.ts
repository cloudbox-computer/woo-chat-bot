import type { ProviderName } from "./types.ts";

export type DatabaseMode = "memory" | "supabase";

export function env(name: string): string | undefined {
  const g = globalThis as Record<string, unknown>;
  if (g.process && typeof (g.process as { env?: Record<string, string | undefined> }).env === "object") {
    return (g.process as { env: Record<string, string | undefined> }).env[name];
  }
  const deno = g.Deno as { env?: { get(k: string): string | undefined } } | undefined;
  if (deno?.env) return deno.env.get(name);
  return undefined;
}

export function databaseMode(): DatabaseMode {
  const v = env("DATABASE");
  if (v === "memory") return "memory";
  if (v === "supabase") return "supabase";

  // Supabase Edge Functions provide SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
  // automatically. In that environment production must fail toward the real
  // database, never toward seeded in-memory demo tenants/catalogues. Memory
  // mode is therefore opt-in only (DATABASE=memory).
  if (env("SUPABASE_URL") && env("SUPABASE_SERVICE_ROLE_KEY")) return "supabase";

  return "memory";
}

export function supabaseConfig(): { url: string; serviceRoleKey: string } {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("DATABASE=supabase requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  }
  return { url, serviceRoleKey: key };
}

export function aiConfig(): {
  provider: ProviderName;
  openaiKey?: string;
  openaiModel: string;
  openaiBaseUrl: string;
  geminiKey?: string;
  geminiModel: string;
  geminiBaseUrl: string;
} {
  const forced = env("AI_PROVIDER") as ProviderName | undefined;
  const openaiKey = env("OPENAI_API_KEY");
  const geminiKey = env("GEMINI_API_KEY");
  let provider: ProviderName;
  if (forced === "mock" || forced === "openai" || forced === "gemini") {
    provider = forced;
  } else if (openaiKey) {
    provider = "openai";
  } else if (geminiKey) {
    provider = "gemini";
  } else {
    throw new Error("No AI provider configured. Set OPENAI_API_KEY or GEMINI_API_KEY, or explicitly set AI_PROVIDER=mock for local tests only.");
  }
  return {
    provider,
    openaiKey,
    openaiModel: env("OPENAI_MODEL") ?? "gpt-4o-mini",
    openaiBaseUrl: env("OPENAI_BASE_URL") ?? "https://api.openai.com/v1",
    geminiKey,
    geminiModel: env("GEMINI_MODEL") ?? "gemini-2.5-flash",
    geminiBaseUrl:
      env("GEMINI_BASE_URL") ?? "https://generativelanguage.googleapis.com/v1beta/openai",
  };
}

export function modelFor(provider: ProviderName, cfg: ReturnType<typeof aiConfig>): string {
  return provider === "gemini" ? cfg.geminiModel : cfg.openaiModel;
}
