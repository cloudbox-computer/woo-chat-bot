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
      messages.push({ role: "system", content: `Store knowledge (use it to answer accurately):\n${opts.knowledgeContext}` });
    }
    for (const h of opts.history) messages.push({ role: h.role, content: h.content });
    messages.push({ role: "user", content: opts.userMessage });

    const body: Record<string, unknown> = {
      model: opts.model,
      messages,
      tools: opts.tools,
      tool_choice: "auto",
      max_tokens: 600,
    };

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

// ---------------------------------------------------------------------------
// Mock provider — deterministic tool-calling without any API key.
// Matches on keywords so the demo flow works end-to-end offline.
// ---------------------------------------------------------------------------

export class MockProvider implements AiProvider {
  name: ProviderName = "mock";
  constructor(private tenant?: { name?: string; retail?: boolean }) {}

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

    // Deterministic map for the mock catalogue: keyword → product id.
    const productIdFromName = (m: string): number => {
      if (/pearl/.test(m)) return 102;
      if (/hoop|earring/.test(m)) return 103;
      if (/bracelet/.test(m)) return 104;
      if (/ring/.test(m)) return 105;
      if (/gold/.test(m) || /necklace/.test(m)) return 101;
      return 101;
    };

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
        content:
          `Hello! I'm the ${this.tenant?.name ?? "Ivy & Pearls"} assistant. ` +
          (this.tenant?.retail === false
            ? "I can help with questions about our services, fees, deadlines and how to get started. What would you like to know?"
            : "I can help you find products, check stock, track an order, or recommend a gift. What are you looking for today?"),
        toolCalls: [],
      };
    }

    // Non-retail tenant (e.g. accountancy): answer from the knowledge base
    if (this.tenant?.retail === false) {
      if (toolNames.has("search_knowledge")) {
        return tool("search_knowledge", { query: opts.userMessage });
      }
      const fallback =
        "I can help with questions about our services, fees, deadlines and how to get started. " +
        "Try: \"what services do you offer?\", \"how much does bookkeeping cost?\", or \"how do I contact you?\".";
      return { content: fallback, toolCalls: [] };
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
    if (/(add|put|stick|throw|pop).*(cart|basket)|(add|put).*basket/.test(msg) && toolNames.has("add_to_cart")) {
      // Deterministic product pick for the demo catalogue; a real model
      // resolves the product from the conversation instead.
      const idMatch = /\b#?(10\d)\b/.exec(opts.userMessage);
      const wordMap: Record<string, number> = {
        "gold chain": 101, "chain": 101, "gold necklace": 101, "necklace": 101,
        "pearl": 102, "hoop": 103, "earring": 103, "earrings": 103,
        "bracelet": 104, "bangle": 104,
      };
      let productId = idMatch ? Number(idMatch[1]) : 101;
      for (const [k, v] of Object.entries(wordMap)) {
        if (opts.userMessage.toLowerCase().includes(k)) { productId = v; break; }
      }
      return tool("add_to_cart", { productId, quantity: 1 });
    }

    // Anything product-related → search
    if (toolNames.has("search_products")) {
      let query = opts.userMessage
        .replace(/^(i'?m|i am|do you have|looking for|want|need|show me|got any|can you|any)\s+/i, "")
        .replace(/\b(under|less than|below|up to|around|about)\b.*$/, "")
        .replace(/[?.!]/g, "")
        .trim();
      // Plural -> singular ("gold necklaces" -> "gold necklace") since the
      // mock catalogue uses singular names, like WooCommerce's stemming.
      query = query.replace(/necklaces/g, "necklace").replace(/earrings/g, "earring")
        .replace(/bracelets/g, "bracelet").replace(/rings/g, "ring").replace(/pendants/g, "pendant");
      const price = /\b(?:under|less than|below|up to|around|about)\s*£?\s?(\d{2,4})\b/.exec(opts.userMessage);
      const colour = /\b(gold|silver|rose gold|white gold|platinum)\b/.exec(opts.userMessage)?.[1];
      return tool("search_products", {
        query,
        maxPrice: price ? Number(price[1]) : undefined,
        attributes: colour ? { colour: colour } : undefined,
      });
    }

    // Fallback: conversational reply
    const fallback =
      "I can help you find products, check an order, or answer questions about our jewellery. " +
      "Try: \"show me gold necklaces under £100\", \"where is my order?\", or \"what's your returns policy?\". " +
      "Or tell me what you're shopping for — I'll point you to the right pieces.";
    return { content: fallback, toolCalls: [] };
  }
}

export function providerFromConfig(cfg: {
  provider: ProviderName;
  openaiKey?: string;
  openaiBaseUrl?: string;
  geminiKey?: string;
  geminiBaseUrl?: string;
}, tenant?: { name?: string; retail?: boolean }): AiProvider {
  if (cfg.provider === "mock") return new MockProvider(tenant);
  if (cfg.provider === "gemini" && cfg.geminiKey) {
    return new OpenAiCompatibleProvider({
      name: "gemini",
      apiKey: cfg.geminiKey!,
      baseUrl: cfg.geminiBaseUrl ?? "https://generativelanguage.googleapis.com/v1beta/openai",
    });
  }
  if (cfg.provider === "openai" && cfg.openaiKey) {
    return new OpenAiCompatibleProvider({
      name: "openai",
      apiKey: cfg.openaiKey!,
      baseUrl: cfg.openaiBaseUrl ?? "https://api.openai.com/v1",
    });
  }
  return new MockProvider();
}
