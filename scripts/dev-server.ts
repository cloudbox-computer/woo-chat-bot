// Local development server.
//
// Serves the widget demo page + dist/widget.js, and exposes the same API
// surface the widget expects (`/chat`, `/feedback`) backed by the in-memory
// database + mock AI provider — so you can run the whole system with zero
// Supabase and zero API keys.
//
// Usage: bun run dev   → http://localhost:3001
import { runAgent } from "../supabase/functions/_shared/agent.ts";
import { getDb } from "../supabase/functions/_shared/db.ts";

const PORT = Number(process.env.PORT ?? 3001);
const WIDGET = import.meta.dir + "/../widget";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // API: chat
  if (url.pathname === "/chat" && req.method === "POST") {
    try {
      const body = await req.json();
      const result = await runAgent({
        chatbotId: String(body.chatbotId ?? "ivy-pearls"),
        message: String(body.message ?? ""),
        customerEmail: body.customerEmail ? String(body.customerEmail) : undefined,
        conversationId: body.conversationId ? String(body.conversationId) : undefined,
      });
      return json({ reply: result.reply, conversationId: result.conversationId, products: result.products });
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
    }
  }

  // API: feedback
  if (url.pathname === "/feedback" && req.method === "POST") {
    try {
      const body = await req.json();
      const db = getDb();
      await db.recordFeedback(String(body.conversationId ?? ""), Number(body.rating) === 1 ? 1 : -1, body.comment ? String(body.comment) : undefined);
      return json({ ok: true });
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
    }
  }

  // Static: demo page + built widget
  const path = url.pathname === "/" ? "/index.html" : url.pathname;
  const file = Bun.file(WIDGET + path);
  if (await file.exists()) {
    const ext = path.slice(path.lastIndexOf("."));
    return new Response(file, { headers: { "Content-Type": MIME[ext] ?? "application/octet-stream" } });
  }

  return new Response("Not found", { status: 404 });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const server = Bun.serve({ port: PORT, fetch: handle });
console.log(`Dev server: http://localhost:${server.port}`);
console.log(`Chat API:   POST http://localhost:${server.port}/chat`);
