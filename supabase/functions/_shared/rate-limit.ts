import { supabaseConfig } from "./env.ts";

function clientIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  ).slice(0, 100);
}

async function consume(bucket: string, limit: number, seconds: number): Promise<boolean> {
  const { url, serviceRoleKey } = supabaseConfig();
  try {
    const res = await fetch(`${url}/rest/v1/rpc/consume_chat_rate_limit`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_bucket_key: bucket,
        p_limit: limit,
        p_window_seconds: seconds,
      }),
    });
    if (!res.ok) return false; // fail closed: don't create an unmetered cost path
    return (await res.json()) === true;
  } catch {
    return false;
  }
}

export async function allowPublicChat(req: Request, chatbotId: string): Promise<boolean> {
  const ip = clientIp(req);
  // Burst protection and chatbot-wide protection. These are intentionally
  // conservative defaults and can be moved to tenant plan settings later.
  const [ipOk, botOk] = await Promise.all([
    consume(`chat:ip:${ip}`, 30, 60),
    consume(`chat:bot:${chatbotId}`, 300, 60),
  ]);
  return ipOk && botOk;
}
