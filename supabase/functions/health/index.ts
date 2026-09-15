import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

serve((req) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), { status: 405, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  }
  const body = req.method === "HEAD" ? null : JSON.stringify({ ok: true, service: "zochat", status: "healthy", time: new Date().toISOString() });
  return new Response(body, { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
});
