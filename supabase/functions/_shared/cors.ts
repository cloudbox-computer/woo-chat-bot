export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

export function corsHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { ...CORS_HEADERS, ...extra };
}

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(extra) },
  });
}

export function badRequest(message: string): Response {
  return json({ error: message }, 400);
}

export function notFound(message = "Not found"): Response {
  return json({ error: message }, 404);
}

export function serverError(message = "Internal error"): Response {
  return json({ error: message }, 500);
}

export function handleOptions(): Response {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("Invalid JSON body");
  }
}
