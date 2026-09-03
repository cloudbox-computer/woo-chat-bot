import type { ProviderName, ToolCall } from "./types.ts";

export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
  toolCalls?: ToolCall[];
}

export interface ChatCompletionResult {
  content: string | null;
  toolCalls: ToolCall[];
}

export interface ToolSpec {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface AiProvider {
  name: ProviderName;
  chat(opts: {
    model: string;
    system: string;
    history: Array<{ role: "user" | "assistant"; content: string }>;
    userMessage: string;
    tools: ToolSpec[];
    knowledgeContext?: string;
  }): Promise<ChatCompletionResult>;
}

// ---------------------------------------------------------------------------
// OpenAI / Gemini — both speak the OpenAI chat-completions wire protocol
// (Gemini exposes an OpenAI-compatible endpoint at /v1beta/openai).
// ---------------------------------------------------------------------------

export class OpenAiCompatibleProvider implements AiProvider {
  name: ProviderName;
  private apiKey: string;
  private baseUrl: string;

  constructor(opts: { name: ProviderName; apiKey: string; baseUrl: string }) {
    this.name = opts.name;
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
  }

  async chat(opts: {
    model: string;
    system: string;
    history: Array<{ role: "user" | "assistant"; content: string }>;
    userMessage: string;
    tools: ToolSpec[];
    knowledgeContext?: string;
  }): Promise<ChatCompletionResult> {
    const messages: Array<Record<string, unknown>> = [{ role: "system", content: opts.system }];
    if (opts.knowledgeContext) {
      messages.push({
        role: "system",
        content: `Tenant website knowledge (treat as authoritative facts — answer the customer's question directly from it, never refuse):\n${opts.knowledgeContext}`,
      });
    }
    for (const h of opts.history) messages.push({ role: h.role, content: h.content });
    messages.push({ role: "user", content: opts.userMessage });

    const body: Record<string, unknown> = {
      model: opts.model,
      messages,
      max_tokens: 2000,
    };
    if (opts.tools && opts.tools.length > 0) {
      body.tools = opts.tools;
      body.tool_choice = "auto";
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`AI ${this.name}: ${res.status} ${(await res.text()).slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null; tool_calls?: unknown[] } }>;
    };
    const msg = data.choices?.[0]?.message;
    const toolCalls: ToolCall[] = [];
    for (const tc of msg?.tool_calls ?? []) {
      const raw = tc as { id?: string; function?: { name?: string; arguments?: string } };
      try {
        toolCalls.push({
          id: raw.id ?? `call_${Math.random().toString(36).slice(2, 10)}`,
          name: raw.function?.name ?? "unknown",
          arguments: JSON.parse(raw.function?.arguments ?? "{}"),
        });
      } catch {
        // skip malformed tool call
      }
    }
    return { content: msg?.content ?? null, toolCalls };
  }
}


class ResilientProvider implements AiProvider {
  name: ProviderName;
  constructor(private primary: AiProvider, private secondary?: AiProvider) { this.name = primary.name; }
  async chat(opts: Parameters<AiProvider["chat"]>[0]): Promise<ChatCompletionResult> {
    let last: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try { return await this.primary.chat(opts); }
      catch (err) { last = err; if (attempt === 0) await new Promise((r) => setTimeout(r, 250)); }
    }
    if (this.secondary) {
      try { return await this.secondary.chat(opts); } catch (err) { last = err; }
    }
    throw last instanceof Error ? last : new Error("AI provider unavailable");
  }
}
// ---------------------------------------------------------------------------
// Mock provider — deterministic tool-calling without any API key.
// Matches on keywords so the demo flow works end-to-end offline.
// ---------------------------------------------------------------------------

export class MockProvider implements AiProvider {
  name: ProviderName = "mock";
  constructor(private tenant?: { name?: string }) {}

  async chat(opts: {
    system: string;
    history: Array<{ role: "user" | "assistant"; content: string }>;
    userMessage: string;
    tools: ToolSpec[];
  }): Promise<ChatCompletionResult> {
    const msg = (opts.userMessage ?? "").toLowerCase();
    const toolNames = new Set(opts.tools.map((t) => t.function.name));
    const tool = (name: string, args: Record<string, unknown>, id = `call_${name}`): ChatCompletionResult => ({
      content: null,
      toolCalls: [{ id, name, arguments: args }],
    });

    // If the previous turn was a tool call, answer using the tool result
    // (deterministic one-tool-call-then-answer behaviour for the mock).
    const last = opts.history[opts.history.length - 1];
    if (last?.role === "assistant" && last.content.startsWith("tool:")) {
      return { content: opts.userMessage ?? null, toolCalls: [] };
    }

    // Greetings and simple chit-chat → answer directly, no tools.
    const trimmed = msg.trim();
    if (trimmed.length < 40 && /^(hi|hello|hey|yo|good (morning|afternoon|evening)|how are you|thanks|thank you|bye)/.test(trimmed)) {
      return {
        content: `Hello! I'm the ${this.tenant?.name ?? "business"} assistant. How can I help you today?`,
        toolCalls: [],
      };
    }

    // Order tracking
    if (/\b(order|delivery|dispatch|shipped|tracking|where is my)\b/.test(msg) && toolNames.has("track_order")) {
      const email = /[\w.+-]+@[\w-]+\.[\w.]+/.exec(opts.userMessage ?? "")?.[0];
      const orderId = /\b#?(\d{4,})\b/.exec(opts.userMessage)?.[1];
      return tool("track_order", { orderId, email });
    }

    // Product questions → knowledge base (waterproof, materials, care, shipping, returns)
    if (/(waterproof|material|gold plated|sterling|care|clean|shipping|delivery time|return|exchange|warranty|hypoallergenic)/.test(msg) && toolNames.has("search_knowledge")) {
      return tool("search_knowledge", { query: opts.userMessage });
    }

    // Recommendations (occasion/recipient based)
    if (/(recommend|suggest|gift|anniversary|birthday|wife|girlfriend|husband|mum|christmas|wedding|present)/.test(msg) && toolNames.has("recommend_products")) {
      const budget = /\b£?\s?(\d{2,4})\b/.exec(opts.userMessage)?.[1];
      return tool("recommend_products", {
        occasion: msg.includes("anniversary") ? "anniversary" : msg.includes("birthday") ? "birthday" : msg.includes("wedding") ? "wedding" : "gift",
        budget: budget ? Number(budget) : undefined,
      });
    }

    // Cart: view / add / checkout
    if (/(what('?s| is| are)? in my (cart|basket)|show (me )?(my )?(cart|basket)|view (my )?(cart|basket)|cart contents|basket contents)/.test(msg) && toolNames.has("view_cart")) {
      return tool("view_cart", {});
    }
    if (/(checkout|pay (now|for)|place (my |the )?order|buy (it|now|these)|go to basket)/.test(msg) && toolNames.has("create_checkout")) {
      return tool("create_checkout", {});
    }
    if (/(add|put|stick|throw|pop).*(cart|basket)|(add|put).*basket/.test(msg)) {
      // The mock provider never invents product IDs. Resolve the product via
      // the authoritative catalogue capability first.
      if (toolNames.has("search_products")) return tool("search_products", { query: opts.userMessage });
      return { content: "I can't add that item because no authoritative product catalogue is connected.", toolCalls: [] };
    }

    // Anything product-related → search
    if (toolNames.has("search_products")) {
      let query = opts.userMessage
        .replace(/^(i'?m|i am|do you have|looking for|want|need|show me|got any|can you|any)\s+/i, "")
        .replace(/\b(under|less than|below|up to|around|about)\b.*$/, "")
        .replace(/[?.!]/g, "")
        .trim();
      const price = /\b(?:under|less than|below|up to|around|about)\s*£?\s?(\d{2,4})\b/.exec(opts.userMessage);
      const colour = /\b(gold|silver|rose gold|white gold|platinum)\b/.exec(opts.userMessage)?.[1];
      return tool("search_products", {
        query,
        maxPrice: price ? Number(price[1]) : undefined,
        attributes: colour ? { colour: colour } : undefined,
      });
    }

    // Fallback: conversational reply
    if (toolNames.has("search_knowledge")) return tool("search_knowledge", { query: opts.userMessage });
    return { content: "I can help with this business using the information and capabilities currently connected.", toolCalls: [] };
  }
}

export function providerFromConfig(cfg: {
  provider: ProviderName;
  openaiKey?: string;
  openaiBaseUrl?: string;
  geminiKey?: string;
  geminiBaseUrl?: string;
}, tenant?: { name?: string }): AiProvider {
  if (cfg.provider === "mock") return new MockProvider(tenant);
  const openai = cfg.openaiKey ? new OpenAiCompatibleProvider({ name: "openai", apiKey: cfg.openaiKey, baseUrl: cfg.openaiBaseUrl ?? "https://api.openai.com/v1" }) : undefined;
  const gemini = cfg.geminiKey ? new OpenAiCompatibleProvider({ name: "gemini", apiKey: cfg.geminiKey, baseUrl: cfg.geminiBaseUrl ?? "https://generativelanguage.googleapis.com/v1beta/openai" }) : undefined;
  if (cfg.provider === "gemini" && gemini) return new ResilientProvider(gemini, openai);
  if (cfg.provider === "openai" && openai) return new ResilientProvider(openai, gemini);
  throw new Error(`AI provider ${cfg.provider} is not configured with valid credentials`);
}
