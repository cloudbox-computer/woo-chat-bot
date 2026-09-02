import { supabaseConfig } from "./env.ts";

function headers() {
  const { serviceRoleKey } = supabaseConfig();
  return { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" };
}
function base() { return `${supabaseConfig().url.replace(/\/+$/g, "")}/rest/v1`; }

export interface PublicTenantControls {
  tenantId: string;
  allowedOrigins: string[];
  monthlyRequestLimit: number;
  monthlyTokenLimit: number;
}
export async function controlsForChatbot(ref: string): Promise<PublicTenantControls | null> {
  const bots = await fetch(`${base()}/chatbots?or=(id.eq.${encodeURIComponent(ref)},public_id.eq.${encodeURIComponent(ref)})&select=tenant_id&limit=1`, { headers: headers() });
  if (!bots.ok) return null;
  const rows = await bots.json() as Array<{tenant_id:string}>;
  if (!rows[0]) return null;
  const res = await fetch(`${base()}/tenants?id=eq.${rows[0].tenant_id}&select=id,allowed_origins,monthly_request_limit,monthly_token_limit&limit=1`, { headers: headers() });
  if (!res.ok) return null;
  const tenants = await res.json() as Array<Record<string, unknown>>;
  const t = tenants[0];
  if (!t) return null;
  return { tenantId: String(t.id), allowedOrigins: Array.isArray(t.allowed_origins) ? t.allowed_origins.map(String) : [], monthlyRequestLimit: Number(t.monthly_request_limit ?? 100000), monthlyTokenLimit: Number(t.monthly_token_limit ?? 10000000) };
}
export function originAllowed(req: Request, allowed: string[]): boolean {
  if (!allowed.length) return true;
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    const host = new URL(origin).host.toLowerCase();
    return allowed.some((v) => {
      try { return new URL(v.includes("://") ? v : `https://${v}`).host.toLowerCase() === host; }
      catch { return v.toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "") === host; }
    });
  } catch { return false; }
}
export async function monthlyUsage(tenantId: string): Promise<{requests:number;tokens:number;estimatedCostUsd:number}> {
  const res = await fetch(`${base()}/rpc/tenant_usage_current_month`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ p_tenant: tenantId }),
  });
  if (!res.ok) return { requests: 0, tokens: 0, estimatedCostUsd: 0 };
  const rows = await res.json() as Array<Record<string, unknown>>;
  const row = rows[0] ?? {};
  return {
    requests: Number(row.requests ?? 0),
    tokens: Number(row.tokens ?? 0),
    estimatedCostUsd: Number(row.estimated_cost_usd ?? 0),
  };
}
export async function logAcceptedRequest(tenantId: string, chatbotId: string, requestId: string): Promise<void> {
  await fetch(`${base()}/usage_logs`, { method: "POST", headers: {...headers(), Prefer:"return=minimal"}, body: JSON.stringify({tenant_id:tenantId, chatbot_id:chatbotId, request_id:requestId, provider:"pending", model:"pending", tool_calls:0, input_tokens:0, output_tokens:0, latency_ms:0}) });
}

export async function finalizeUsage(requestId: string, inputChars: number, outputChars: number, latencyMs: number, provider: string, model: string): Promise<void> {
  const inputTokens = Math.max(1, Math.ceil(inputChars / 4));
  const outputTokens = Math.max(1, Math.ceil(outputChars / 4));
  await fetch(`${base()}/usage_logs?request_id=eq.${encodeURIComponent(requestId)}`, { method: "PATCH", headers: {...headers(), Prefer:"return=minimal"}, body: JSON.stringify({input_tokens:inputTokens,output_tokens:outputTokens,latency_ms:latencyMs,provider,model}) });
}
export async function conversationControl(conversationId: string): Promise<{mode:string}|null> {
  const res = await fetch(`${base()}/conversations?id=eq.${encodeURIComponent(conversationId)}&select=control_mode&limit=1`, { headers: headers() });
  if (!res.ok) return null;
  const rows = await res.json() as Array<Record<string,unknown>>;
  return rows[0] ? { mode: String(rows[0].control_mode ?? "ai") } : null;
}
