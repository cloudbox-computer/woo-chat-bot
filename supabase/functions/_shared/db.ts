import type { CartItem, Chatbot, Conversation, Feedback, KnowledgeItem, Message, Tenant, Ticket, TicketMessage } from "./types.ts";
import { databaseMode, supabaseConfig } from "./env.ts";
import {
  IVY_PEARLS_CHATBOT,
  IVY_PEARLS_KNOWLEDGE,
  IVY_PEARLS_TENANT,
  NTM_ASSOCIATES_CHATBOT,
  NTM_ASSOCIATES_KNOWLEDGE,
  NTM_ASSOCIATES_TENANT,
} from "./mock-data.ts";

export interface Db {
  /** Resolve a chatbot by its internal id (slug) OR its opaque public widget
   *  id ("cb_..."). The public widget only ever passes the public id. */
  resolveChatbot(ref: string): Promise<Chatbot | null>;
  getTenantByChatbot(chatbotId: string): Promise<Tenant | null>;
  getChatbot(chatbotId: string): Promise<Chatbot | null>;
  getKnowledge(chatbotId: string, query?: string): Promise<KnowledgeItem[]>;
  createConversation(c: Conversation): Promise<void>;
  getConversation(id: string): Promise<Conversation | null>;
  setConversationEmail(conversationId: string, email: string, consent?: boolean): Promise<void>;
  getMessages(conversationId: string): Promise<Message[]>;
  appendMessage(m: Message): Promise<void>;
  logFeedback(f: Feedback): Promise<void>;
  getCart(conversationId: string): Promise<CartItem[]>;
  setCart(conversationId: string, items: CartItem[]): Promise<void>;
  createTicket(t: Ticket): Promise<Ticket>;
  getTicketByReference(tenantId: string, reference: string): Promise<Ticket | null>;
  listTickets(tenantId: string): Promise<Ticket[]>;
  appendTicketMessage(m: TicketMessage): Promise<void>;
}

// ---------------------------------------------------------------------------
// In-memory store (local dev, tests, zero-config demos)
// ---------------------------------------------------------------------------

export class MemoryDb implements Db {
  tenants: Tenant[] = [IVY_PEARLS_TENANT, NTM_ASSOCIATES_TENANT];
  chatbots: Chatbot[] = [IVY_PEARLS_CHATBOT, NTM_ASSOCIATES_CHATBOT];
  knowledge: KnowledgeItem[] = [...IVY_PEARLS_KNOWLEDGE, ...NTM_ASSOCIATES_KNOWLEDGE];
  conversations: Conversation[] = [];
  messages: Message[] = [];
  feedback: Feedback[] = [];
  carts = new Map<string, CartItem[]>();
  tickets: Ticket[] = [];
  ticketMessages: TicketMessage[] = [];

  async getTenantByChatbot(chatbotId: string): Promise<Tenant | null> {
    const bot = await this.getChatbot(chatbotId);
    return bot ? this.tenants.find((t) => t.id === bot.tenantId) ?? null : null;
  }
  async resolveChatbot(ref: string): Promise<Chatbot | null> {
    return (
      this.chatbots.find((b) => b.id === ref) ??
      this.chatbots.find((b) => b.publicId === ref) ??
      null
    );
  }
  async getChatbot(chatbotId: string): Promise<Chatbot | null> {
    return this.chatbots.find((b) => b.id === chatbotId && b.active) ?? null;
  }
  async getKnowledge(chatbotId: string, query?: string): Promise<KnowledgeItem[]> {
    let items = this.knowledge.filter((k) => k.chatbotId === chatbotId);
    if (query) {
      const q = query.toLowerCase();
      const words = q.split(/\W+/).filter((w) => w.length > 2);
      const score = (k: KnowledgeItem) => {
        const hay = (k.title + " " + k.content + " " + (k.keywords ?? []).join(" ")).toLowerCase();
        return words.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0);
      };
      items = items
        .map((k) => ({ k, s: score(k) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .map((x) => x.k);
    }
    return items.slice(0, 3);
  }
  async createConversation(c: Conversation): Promise<void> {
    this.conversations.push(c);
  }
  async setConversationEmail(conversationId: string, email: string, consent?: boolean): Promise<void> {
    const c = this.conversations.find((x) => x.id === conversationId);
    if (c) {
      c.customerEmail = email;
      if (consent !== undefined) c.emailConsent = consent;
    }
  }
  async getConversation(id: string): Promise<Conversation | null> {
    return this.conversations.find((c) => c.id === id) ?? null;
  }
  async getMessages(conversationId: string): Promise<Message[]> {
    return this.messages
      .filter((m) => m.conversationId === conversationId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async appendMessage(m: Message): Promise<void> {
    this.messages.push(m);
  }
  async logFeedback(f: Feedback): Promise<void> {
    this.feedback.push(f);
  }
  async getCart(conversationId: string): Promise<CartItem[]> {
    return this.carts.get(conversationId) ?? [];
  }
  async setCart(conversationId: string, items: CartItem[]): Promise<void> {
    this.carts.set(conversationId, items);
  }
  async createTicket(t: Ticket): Promise<Ticket> {
    this.tickets.push(t);
    return t;
  }
  async getTicketByReference(tenantId: string, reference: string): Promise<Ticket | null> {
    return this.tickets.find((t) => t.tenantId === tenantId && t.reference === reference) ?? null;
  }
  async listTickets(tenantId: string): Promise<Ticket[]> {
    return this.tickets.filter((t) => t.tenantId === tenantId);
  }
  async appendTicketMessage(m: TicketMessage): Promise<void> {
    this.ticketMessages.push(m);
  }
}

// ---------------------------------------------------------------------------
// PostgREST-backed store (Supabase). Tables from supabase/schema.sql.
// ---------------------------------------------------------------------------

export class SupabaseDb implements Db {
  private headers: Record<string, string>;
  private base: string;

  constructor() {
    const { url, serviceRoleKey } = supabaseConfig();
    this.base = `${url}/rest/v1`;
    this.headers = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    };
  }

  private async get<T>(table: string, qs: Record<string, string>): Promise<T[]> {
    const res = await fetch(`${this.base}/${table}?${new URLSearchParams(qs)}`, { headers: this.headers });
    if (!res.ok) throw new Error(`DB ${table}: ${res.status} ${await res.text()}`);
    return res.json() as Promise<T[]>;
  }

  private async insert(table: string, row: Record<string, unknown>): Promise<void> {
    const res = await fetch(`${this.base}/${table}`, {
      method: "POST",
      headers: { ...this.headers, Prefer: "return=minimal" },
      body: JSON.stringify(row),
    });
    if (!res.ok) throw new Error(`DB insert ${table}: ${res.status} ${await res.text()}`);
  }

  private mapTenant(row: Record<string, unknown>): Tenant {
    const integ = row.integrations as Array<Record<string, unknown>> | undefined;
    const creds = (integ?.[0]?.credentials ?? {}) as Record<string, string>;
    const scope = (row.scope ?? {}) as Record<string, unknown>;
    const allowedTopics = scope.allowedTopics;
    const refusalMessage = row.refusal_message ? String(row.refusal_message) : undefined;
    return {
      id: String(row.id),
      slug: String(row.slug),
      name: String(row.name),
      currency: String(row.currency ?? "GBP"),
      storeUrl: row.store_url ? String(row.store_url) : undefined,
      welcomeMessage: String(row.welcome_message ?? ""),
      assistantHeaderMessage: row.assistant_header_message ? String(row.assistant_header_message) : undefined,
      tone: row.tone ? String(row.tone) : undefined,
      brandColour: row.brand_colour ? String(row.brand_colour) : undefined,
      businessContext: row.business_context ? String(row.business_context) : undefined,
      wooUrl: creds.url,
      wooKey: creds.consumer_key,
      wooSecret: creds.consumer_secret,
      policy:
        Array.isArray(allowedTopics) || refusalMessage
          ? {
              allowedTopics: Array.isArray(allowedTopics)
                ? (allowedTopics as string[]).filter((t) => typeof t === "string")
                : [],
              refusalMessage:
                refusalMessage ??
                `I'm sorry, I can only help with ${String(row.name)} products, orders, delivery, returns and other services provided by ${String(row.name)}.`,
              securityLevel:
                scope.securityLevel === "standard" || scope.securityLevel === "strict" || scope.securityLevel === "extra-strict"
                  ? scope.securityLevel
                  : "strict",
              useModelClassifier: scope.useModelClassifier === true,
            }
          : undefined,
      supportEmail: row.support_email ? String(row.support_email) : undefined,
      ticketPrefix: row.ticket_prefix ? String(row.ticket_prefix) : undefined,
      privacyPolicyUrl: row.privacy_policy_url ? String(row.privacy_policy_url) : undefined,
    };
  }

  async getTenantByChatbot(chatbotId: string): Promise<Tenant | null> {
    const bot = await this.getChatbot(chatbotId);
    if (!bot) return null;
    const rows = await this.get<Record<string, unknown>>("tenants", {
      select: "id,slug,name,currency,store_url,welcome_message,assistant_header_message,tone,brand_colour,business_context,scope,refusal_message,support_email,ticket_prefix,privacy_policy_url,integrations(credentials)",
      id: `eq.${bot.tenantId}`,
      limit: "1",
    });
    return rows[0] ? this.mapTenant(rows[0]) : null;
  }

  async resolveChatbot(ref: string): Promise<Chatbot | null> {
    const rows = await this.get<Record<string, unknown>>("chatbots", {
      select: "id,public_id,tenant_id,name,active",
      or: `(id.eq.${ref},public_id.eq.${ref})`,
      limit: "1",
    });
    const bot = rows[0];
    if (!bot || bot.active === false) return null;
    return {
      id: String(bot.id),
      publicId: bot.public_id ? String(bot.public_id) : undefined,
      tenantId: String(bot.tenant_id),
      name: String(bot.name),
      active: true,
    };
  }

  async getChatbot(chatbotId: string): Promise<Chatbot | null> {
    const rows = await this.get<Record<string, unknown>>("chatbots", {
      select: "id,public_id,tenant_id,name,active",
      id: `eq.${chatbotId}`,
      limit: "1",
    });
    const bot = rows[0];
    if (!bot || bot.active === false) return null;
    return {
      id: String(bot.id),
      publicId: bot.public_id ? String(bot.public_id) : undefined,
      tenantId: String(bot.tenant_id),
      name: String(bot.name),
      active: true,
    };
  }

  async getKnowledge(chatbotId: string, query?: string): Promise<KnowledgeItem[]> {
    const rows = await this.get<Record<string, unknown>>("knowledge", {
      select: "id,chatbot_id,title,content,keywords",
      chatbot_id: `eq.${chatbotId}`,
      limit: "20",
    });
    let items = rows.map((r) => ({
      id: String(r.id),
      chatbotId: String(r.chatbot_id),
      title: String(r.title),
      content: String(r.content),
      keywords: Array.isArray(r.keywords) ? (r.keywords as string[]) : [],
    }));
    if (query) {
      const q = query.toLowerCase();
      const words = q.split(/\W+/).filter((w) => w.length > 2);
      const score = (k: KnowledgeItem) => {
        const hay = (k.title + " " + k.content + " " + (k.keywords ?? []).join(" ")).toLowerCase();
        return words.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0);
      };
      items = items
        .map((k) => ({ k, s: score(k) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .map((x) => x.k);
    }
    return items.slice(0, 3);
  }

  async createConversation(c: Conversation): Promise<void> {
    await this.insert("conversations", {
      id: c.id,
      chatbot_id: c.chatbotId,
      customer_email: c.customerEmail ?? null,
      email_consent: c.emailConsent ?? null,
      title: c.title ?? null,
      created_at: c.createdAt,
      updated_at: c.updatedAt,
    });
  }

  async setConversationEmail(conversationId: string, email: string, consent?: boolean): Promise<void> {
    const patch: Record<string, unknown> = { customer_email: email };
    if (consent !== undefined) patch.email_consent = consent;
    const res = await fetch(`${this.base}/conversations?id=eq.${conversationId}`, {
      method: "PATCH",
      headers: { ...this.headers, Prefer: "return=minimal" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`DB update conversations: ${res.status} ${await res.text()}`);
  }

  async getConversation(id: string): Promise<Conversation | null> {
    const rows = await this.get<Record<string, unknown>>("conversations", {
      select: "id,chatbot_id,customer_email,email_consent,title,created_at,updated_at",
      id: `eq.${id}`,
      limit: "1",
    });
    const r = rows[0];
    if (!r) return null;
    return {
      id: String(r.id),
      chatbotId: String(r.chatbot_id),
      customerEmail: r.customer_email ? String(r.customer_email) : undefined,
      emailConsent: r.email_consent === true ? true : undefined,
      title: r.title ? String(r.title) : undefined,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  }

  async getMessages(conversationId: string): Promise<Message[]> {
    const rows = await this.get<Record<string, unknown>>("messages", {
      select: "id,conversation_id,role,content,products,created_at",
      conversation_id: `eq.${conversationId}`,
      order: "created_at.asc",
    });
    return rows.map((r) => {
      let products = r.products;
      // Legacy rows may hold a jsonb *string* containing the JSON array.
      if (typeof products === "string") {
        try {
          const parsed = JSON.parse(products);
          products = Array.isArray(parsed) ? parsed : undefined;
        } catch {
          products = undefined;
        }
      }
      return {
        id: String(r.id),
        conversationId: String(r.conversation_id),
        role: r.role as "user" | "assistant",
        content: String(r.content),
        products: products ? (products as Message["products"]) : undefined,
        createdAt: String(r.created_at),
      };
    });
  }

  async appendMessage(m: Message): Promise<void> {
    await this.insert("messages", {
      id: m.id,
      conversation_id: m.conversationId,
      role: m.role,
      content: m.content,
      // Raw array -> jsonb array (avoids double-encoding as a jsonb string).
      products: m.products ?? null,
      created_at: m.createdAt,
    });
  }

  async logFeedback(f: Feedback): Promise<void> {
    await this.insert("feedback", {
      conversation_id: f.conversationId,
      rating: f.rating === "up" ? 1 : -1,
      comment: f.comment ?? null,
      created_at: f.createdAt,
    });
  }

  async getCart(conversationId: string): Promise<CartItem[]> {
    const rows = await this.get<Record<string, unknown>>("carts", {
      select: "items",
      conversation_id: `eq.${conversationId}`,
      limit: "1",
    });
    const items = rows[0]?.items;
    // Legacy rows may hold a jsonb *string* containing the JSON array (old
    // setCart double-encoded with JSON.stringify). Parse those defensively.
    if (typeof items === "string") {
      try {
        const parsed = JSON.parse(items);
        return Array.isArray(parsed) ? (parsed as CartItem[]) : [];
      } catch {
        return [];
      }
    }
    if (!Array.isArray(items)) return [];
    return items as CartItem[];
  }

  async setCart(conversationId: string, items: CartItem[]): Promise<void> {
    const existing = await this.get<Record<string, unknown>>("carts", {
      select: "conversation_id",
      conversation_id: `eq.${conversationId}`,
      limit: "1",
    });
    if (existing.length) {
      const res = await fetch(`${this.base}/carts?conversation_id=eq.${conversationId}`, {
        method: "PATCH",
        headers: { ...this.headers, Prefer: "return=minimal" },
        // Send the array directly so PostgREST stores it as a jsonb array
        // (not a double-encoded jsonb string).
        body: JSON.stringify({ items, updated_at: new Date().toISOString() }),
      });
      if (!res.ok) throw new Error(`DB cart update: ${res.status} ${await res.text()}`);
    } else {
      await this.insert("carts", {
        conversation_id: conversationId,
        items, // raw array -> jsonb array
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
  }

  private mapTicket(row: Record<string, unknown>): Ticket {
    return {
      id: String(row.id),
      tenantId: String(row.tenant_id),
      reference: String(row.reference),
      conversationId: row.conversation_id ? String(row.conversation_id) : undefined,
      customerName: row.customer_name ? String(row.customer_name) : undefined,
      customerEmail: String(row.customer_email),
      subject: String(row.subject),
      description: String(row.description),
      category: row.category as Ticket["category"],
      priority: (row.priority ?? "normal") as Ticket["priority"],
      status: (row.status ?? "open") as Ticket["status"],
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  async createTicket(t: Ticket): Promise<Ticket> {
    // Insert the ticket and return the stored row (includes server-generated id).
    const res = await fetch(`${this.base}/tickets`, {
      method: "POST",
      headers: { ...this.headers, Prefer: "return=representation" },
      body: JSON.stringify({
        tenant_id: t.tenantId,
        reference: t.reference,
        conversation_id: t.conversationId ?? null,
        customer_name: t.customerName ?? null,
        customer_email: t.customerEmail,
        subject: t.subject,
        description: t.description,
        category: t.category,
        priority: t.priority,
        status: t.status,
        created_at: t.createdAt,
        updated_at: t.updatedAt,
      }),
    });
    if (!res.ok) throw new Error(`DB insert tickets: ${res.status} ${await res.text()}`);
    const created = (await res.json()) as Record<string, unknown> | Record<string, unknown>[];
    const row = Array.isArray(created) ? created[0] : created;
    return this.mapTicket(row);
  }

  async getTicketByReference(tenantId: string, reference: string): Promise<Ticket | null> {
    const rows = await this.get<Record<string, unknown>>("tickets", {
      select: "id,tenant_id,reference,conversation_id,customer_name,customer_email,subject,description,category,priority,status,created_at,updated_at",
      tenant_id: `eq.${tenantId}`,
      reference: `eq.${reference}`,
      limit: "1",
    });
    return rows[0] ? this.mapTicket(rows[0]) : null;
  }

  async listTickets(tenantId: string): Promise<Ticket[]> {
    const rows = await this.get<Record<string, unknown>>("tickets", {
      select: "id,tenant_id,reference,conversation_id,customer_name,customer_email,subject,description,category,priority,status,created_at,updated_at",
      tenant_id: `eq.${tenantId}`,
      order: "created_at.asc",
      limit: "1000",
    });
    return rows.map((r) => this.mapTicket(r));
  }

  async appendTicketMessage(m: TicketMessage): Promise<void> {
    await this.insert("ticket_messages", {
      id: m.id,
      ticket_id: m.ticketId,
      sender_type: m.senderType,
      sender_id: m.senderId ?? null,
      message: m.message,
      created_at: m.createdAt,
    });
  }
}

let dbInstance: Db | null = null;

export function getDb(): Db {
  if (!dbInstance) {
    dbInstance = databaseMode() === "supabase" ? new SupabaseDb() : new MemoryDb();
  }
  return dbInstance;
}
