import type { CartItem, Order, Product, Tenant, Ticket, TicketCategory, ToolPermission } from "./types.ts";
import { TICKET_CATEGORIES } from "./types.ts";
import type { ToolSpec } from "./ai.ts";
import { MockWooClient, WooCommerceClient, type WooClient } from "./woo.ts";
import { sendTicketEmail } from "./email.ts";
import type { Db } from "./db.ts";

export interface ToolContext {
  tenant: Tenant;
  chatbotId: string;
  conversationId: string;
  db: Db;
  allowed?: Set<string>;
}

export type ToolResult = {
  ok: boolean;
  text: string;
  products?: Product[];
};

// Email used to verify ticket ownership / support follow-up (server-side).
const EMAIL_RE = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i;

// ---------------------------------------------------------------------------
// Tool definitions (OpenAI function-calling schema)
// ---------------------------------------------------------------------------

export const TOOL_SPECS: ToolSpec[] = [
  {
    type: "function",
    function: {
      name: "search_products",
      description:
        "Search the store catalogue by keywords, price range, category and attributes (colour, material). Use for 'do you have…', 'show me…', 'looking for…'.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Free-text search, e.g. 'gold necklace'" },
          maxPrice: { type: "number", description: "Maximum price (GBP)" },
          minPrice: { type: "number", description: "Minimum price (GBP)" },
          category: { type: "string", description: "Category name, e.g. 'Necklaces', 'Rings'" },
          attributes: {
            type: "object",
            description: "Product attributes, e.g. { colour: 'gold' }, { material: 'sterling silver' }",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_product",
      description:
        "Fetch full details for one product: description, attributes, variants, stock. Use when the customer asks about a specific product's features (waterproof, material, size, care).",
      parameters: {
        type: "object",
        properties: {
          id: { type: ["string", "number"], description: "Product id" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recommend_products",
      description:
        "Suggest products for an occasion, recipient and budget (anniversary, birthday, wedding, gift). Use for 'what should I get…', 'recommend…', 'need a present for…'.",
      parameters: {
        type: "object",
        properties: {
          occasion: { type: "string", description: "e.g. anniversary, birthday, wedding, gift" },
          recipient: { type: "string", description: "Who it is for, e.g. 'my wife'" },
          budget: { type: "number", description: "Maximum budget (GBP)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_knowledge",
      description:
        "Search the store knowledge base (policies, care guides, materials, shipping, returns, warranty). Use for questions like 'is it waterproof?', 'what's your returns policy?', 'how long does delivery take?'.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The customer's question" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_website",
      description:
        "Search the store's OWN website (WordPress) for information not covered by the knowledge base: delivery times, returns policy, care & cleaning guides, size guide, FAQ, contact details. Use when the knowledge base has no answer for a store question. This tool can only ever access the store's own website.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search terms, e.g. 'delivery times' or 'returns policy'" },
          path: {
            type: "string",
            description: "Optional known page path on the store website, e.g. '/returns/' or '/delivery/'. Use instead of query when you know the exact page.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "track_order",
      description:
        "Look up an order by order number and the email used at checkout. Use when the customer asks where their order is. Never guess a status.",
      parameters: {
        type: "object",
        properties: {
          orderId: { type: "string", description: "Order number, e.g. '4821'" },
          email: { type: "string", description: "Customer billing email, to verify ownership" },
        },
        required: ["orderId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_to_cart",
      description:
        "Add a product (optionally a specific variant) to the customer's cart. Use only after the customer explicitly asks to add, buy or order something. Returns the updated cart summary.",
      parameters: {
        type: "object",
        properties: {
          productId: { type: ["string", "number"], description: "Product id" },
          variantId: { type: "string", description: "Variant id, e.g. 'gold' when the product has colour variants" },
          quantity: { type: "number", description: "Quantity, defaults to 1" },
        },
        required: ["productId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "view_cart",
      description: "Show the customer what is currently in their cart, with quantities and total. Use when they ask 'what's in my cart?' or before checkout.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "create_checkout",
      description:
        "Send the customer to checkout for the items currently in their cart. Returns the checkout URL. Use only when the customer explicitly asks to checkout or pay. Never ask for payment details in chat.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "create_ticket",
      description:
        "CONTROLLED TOOL — create a support ticket when the customer has a problem that needs human help (damaged item, missing order, wrong product, defect, delivery/refund/payment problem, complaint, or an explicit request to speak to support). ALWAYS confirm with the customer first ('Would you like me to raise this with our support team?') unless they have already explicitly asked to create a ticket. The tenant_id, recipient email and reference are generated server-side — never pass them. This tool emails the support team automatically. The customer's email is used ONLY to verify ownership of the ticket and to contact them about it — never for anything else (GDPR).",
      parameters: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: [
              "damaged_item",
              "missing_order",
              "wrong_product",
              "product_defect",
              "delivery_problem",
              "refund_problem",
              "payment_problem",
              "order_problem",
              "complaint",
              "other",
            ],
            description: "The type of problem. Choose the best fit; use 'other' if none match.",
          },
          subject: { type: "string", description: "Short subject line, e.g. 'Necklace arrived damaged'" },
          description: { type: "string", description: "Clear description of the problem, including any order number or product the customer mentions." },
          customerName: { type: "string", description: "Customer's name, if they have provided it." },
          customerEmail: { type: "string", description: "Customer's email address so support can follow up. Ask for it if not already known." },
          orderNumber: { type: "string", description: "Related order number, if the customer mentioned one." },
        },
        required: ["category", "subject", "description", "customerEmail"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_ticket_status",
      description:
        "Look up the status of an existing support ticket by its reference number (e.g. IP-2026-000042) and the email used to raise it. Use when the customer asks 'what's the status of my ticket?' or mentions a reference they were given.",
      parameters: {
        type: "object",
        properties: {
          reference: { type: "string", description: "The ticket reference, e.g. 'IP-2026-000042'" },
          email: { type: "string", description: "The email used to raise the ticket (verifies ownership)" },
        },
        required: ["reference"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_order",
      description:
        "Cancel an order the customer placed, when they explicitly ask to cancel it. Verifies the order belongs to them. Only possible while the order is pending, processing or on-hold.",
      parameters: {
        type: "object",
        properties: {
          orderId: { type: "string", description: "Order number, e.g. '4821'" },
          email: { type: "string", description: "Customer billing email, to verify ownership" },
        },
        required: ["orderId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "modify_order",
      description:
        "Change an order the customer placed (status or shipping address) when they explicitly ask. Verifies ownership first. Only possible while the order is pending, processing or on-hold.",
      parameters: {
        type: "object",
        properties: {
          orderId: { type: "string" },
          email: { type: "string", description: "Customer billing email, to verify ownership" },
          patch: {
            type: "object",
            description: "Changes to apply",
            properties: {
              status: { type: "string", enum: ["pending", "processing", "on-hold", "completed", "cancelled", "refunded", "failed", "trash"] },
              shippingAddress: {
                type: "object",
                properties: {
                  firstName: { type: "string" },
                  lastName: { type: "string" },
                  address1: { type: "string" },
                  address2: { type: "string" },
                  city: { type: "string" },
                  postcode: { type: "string" },
                  country: { type: "string" },
                },
              },
            },
          },
        },
        required: ["orderId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "refund_order",
      description:
        "Refund a delivered or processing order when the customer explicitly asks for their money back. Verifies ownership first. The store may follow up manually.",
      parameters: {
        type: "object",
        properties: {
          orderId: { type: "string" },
          email: { type: "string", description: "Customer billing email, to verify ownership" },
          reason: { type: "string", description: "Customer's reason, if given" },
        },
        required: ["orderId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "sales_summary",
      description:
        "Store-owner tool: revenue and order totals for a period (default last 7 days). Never use this to answer customer questions.",
      parameters: {
        type: "object",
        properties: { days: { type: "number", description: "Days to look back, default 7" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "inventory",
      description:
        "Store-owner tool: current stock levels and out-of-stock items. Never use this to answer customer questions.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "analytics",
      description:
        "Store-owner tool: revenue and top products over a period (default last 7 days). Never use this to answer customer questions.",
      parameters: {
        type: "object",
        properties: { days: { type: "number", description: "Days to look back, default 7" } },
      },
    },
  },
];

export const TOOL_PERMISSIONS: Record<string, ToolPermission> = {
  search_products: "read",
  get_product: "read",
  recommend_products: "read",
  search_knowledge: "read",
  search_website: "read",
  check_ticket_status: "read",
  // Read-only lookup (order number + billing email verify ownership); never mutates.
  // Classified at "support" so every chatbot (default permissions include support)
  // can offer order tracking. Mutating order tools stay "sensitive" and are gated off.
  track_order: "support",
  add_to_cart: "cart",
  view_cart: "cart",
  create_checkout: "cart",
  create_ticket: "support",
  cancel_order: "sensitive",
  modify_order: "sensitive",
  refund_order: "sensitive",
  sales_summary: "admin",
  inventory: "admin",
  analytics: "admin",
};

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

export async function executeTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  if (ctx.allowed && !ctx.allowed.has(name)) {
    return { ok: false, text: `Tool ${name} is not enabled for this chatbot.` };
  }
  const woo = wooClientFor(ctx.tenant);
  switch (name) {
    case "search_products": {
      const products = await woo.searchProducts({
        query: asStr(args.query),
        maxPrice: asNum(args.maxPrice),
        minPrice: asNum(args.minPrice),
        category: asStr(args.category),
        attributes: asRecord(args.attributes),
      });
      if (!products.length) return { ok: false, text: "No products matched that search." };
      return { ok: true, text: summarizeProducts(products, ctx.tenant.currency), products };
    }
    case "get_product": {
      const id = args.id as string | number;
      const p = await woo.getProduct(id);
      if (!p) return { ok: false, text: "Product not found." };
      return { ok: true, text: describeProduct(p, ctx.tenant.currency), products: [p] };
    }
    case "track_order": {
      const orders = await woo.trackOrder({ orderId: asStr(args.orderId), email: asStr(args.email) });
      if (!orders.length) return { ok: false, text: "No order found. Check the order number or the email used at checkout." };
      return { ok: true, text: orders.map(summarizeOrder).join("\n") };
    }
    case "recommend_products": {
      const occasion = asStr(args.occasion) ?? "gift";
      const budget = asNum(args.budget);
      const products = await woo.listAll();
      let picks = products.filter((p) => p.inStock !== false);
      if (budget !== undefined) picks = picks.filter((p) => p.price <= budget);
      picks = picks.slice(0, 4);
      if (!picks.length) return { ok: false, text: "Nothing in stock fits that brief right now." };
      return {
        ok: true,
        text: `Ideas for a ${occasion}${args.recipient ? ` for ${args.recipient}` : ""}${budget !== undefined ? ` under £${budget}` : ""}:\n${summarizeProducts(picks, ctx.tenant.currency)}`,
        products: picks,
      };
    }
    case "search_knowledge": {
      const items = await ctx.db.getKnowledge(ctx.chatbotId, asStr(args.query) ?? "");
      if (!items.length) return { ok: false, text: "No knowledge base match." };
      return { ok: true, text: items.map((k) => `${k.title}\n${k.content}`).join("\n\n") };
    }
    case "search_website": {
      return await searchTenantWebsite(ctx.tenant, { query: asStr(args.query), path: asStr(args.path) });
    }
    case "add_to_cart": {
      const productId = args.productId as string | number;
      const qty = Math.max(1, Math.floor(asNum(args.quantity) ?? 1));
      const p = await woo.getProduct(productId);
      if (!p) return { ok: false, text: "Product not found." };
      if (p.inStock === false) return { ok: false, text: `${p.name} is currently out of stock.` };

      const variantId = asStr(args.variantId);
      let variantName: string | undefined;
      let price = p.price;
      if (variantId) {
        const variants = await woo.getVariants(productId);
        const v = variants.find((x) => x.id === variantId);
        if (!v) return { ok: false, text: `Variant '${variantId}' not found for ${p.name}.` };
        if (!v.inStock) return { ok: false, text: `${p.name} (${v.name}) is out of stock.` };
        variantName = v.name;
        if (v.price !== undefined) price = v.price;
      }

      const cart = await ctx.db.getCart(ctx.conversationId);
      const existing = cart.find(
        (i) => String(i.productId) === String(productId) && (i.variantId ?? null) === (variantId ?? null),
      );
      if (existing) {
        existing.quantity += qty;
      } else {
        cart.push({
          productId,
          productName: p.name,
          variantId,
          variantName,
          price,
          currency: ctx.tenant.currency,
          quantity: qty,
          url: p.url,
          imageUrl: p.imageUrl,
          inStock: true, // guarded above: out-of-stock already returned
        });
      }
      await ctx.db.setCart(ctx.conversationId, cart);
      return { ok: true, text: `Added to cart: ${qty}× ${p.name}${variantName ? ` (${variantName})` : ""}.\n${summarizeCart(cart, ctx.tenant.currency)}`, products: cartToProducts(cart) };
    }
    case "view_cart": {
      const cart = await ctx.db.getCart(ctx.conversationId);
      if (!cart.length) return { ok: true, text: "Your cart is empty. Would you like me to find something for you?" };
      // Expose cart items as products so the output gate can recognise the
      // product names the model will quote (avoids false off-topic refusals
      // when a name contains a keyword like "tennis").
      return { ok: true, text: summarizeCart(cart, ctx.tenant.currency), products: cartToProducts(cart) };
    }
    case "create_checkout": {
      const cart = await ctx.db.getCart(ctx.conversationId);
      if (!cart.length) return { ok: false, text: "Your cart is empty — nothing to check out yet." };
      const url = woo.buildCheckoutUrl(cart);
      return { ok: true, text: `You have ${cart.length} item${cart.length === 1 ? "" : "s"} ready to check out. Complete your order here: ${url}`, products: cartToProducts(cart) };
    }
    case "cancel_order": {
      const order = await woo.cancelOrder({ orderId: asStr(args.orderId) ?? "", email: asStr(args.email) });
      if (!order) return { ok: false, text: "Could not cancel that order. Check the number, or the order may already be completed or cancelled." };
      return { ok: true, text: `Order #${order.id} has been cancelled.\n${summarizeOrder(order)}` };
    }
    case "modify_order": {
      const patch = (args.patch ?? {}) as Record<string, unknown>;
      const order = await woo.modifyOrder({
        orderId: asStr(args.orderId) ?? "",
        email: asStr(args.email),
        patch: {
          status: typeof patch.status === "string" ? patch.status : undefined,
          shippingAddress: patch.shippingAddress as Record<string, string> | undefined,
        },
      });
      if (!order) return { ok: false, text: "Could not update that order. Check the number, or the order may no longer be changeable." };
      return { ok: true, text: `Order #${order.id} updated.\n${summarizeOrder(order)}` };
    }
    case "refund_order": {
      const order = await woo.refundOrder({ orderId: asStr(args.orderId) ?? "", email: asStr(args.email), reason: asStr(args.reason) });
      if (!order) return { ok: false, text: "Could not process a refund for that order. Check the number and email." };
      return { ok: true, text: `Refund requested for order #${order.id}. Our team will process it and confirm by email.\n${summarizeOrder(order)}` };
    }
    case "create_ticket": {
      // ---- validate (the AI can't invent categories or junk) ----------------
      const category = asStr(args.category) as TicketCategory | undefined;
      if (!category || !TICKET_CATEGORIES.some((c) => c.value === category)) {
        return { ok: false, text: "That ticket category isn't valid. Please pick a recognised problem type." };
      }
      const subject = asStr(args.subject);
      const description = asStr(args.description);
      const customerName = asStr(args.customerName);
      const customerEmail = asStr(args.customerEmail) ?? "";
      if (!subject || !description) {
        return { ok: false, text: "I need a short subject and a description of the problem to raise a ticket." };
      }
      if (!EMAIL_RE.test(customerEmail)) {
        return { ok: false, text: "I need a valid email address so our team can get back to you. What email should I use?" };
      }

      // ---- reference (server-side only: prefix + year + running number) -----
      const prefix = ctx.tenant.ticketPrefix || (ctx.tenant.slug || "SUP").slice(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, "");
      const year = new Date().getFullYear();
      const existing = await ctx.db.listTickets(ctx.tenant.id);
      const seq = existing.reduce((max, t) => {
        const m = t.reference.match(new RegExp(`^${prefix}-${year}-(\\d+)$`));
        return m ? Math.max(max, parseInt(m[1], 10)) : max;
      }, 0);
      const reference = `${prefix}-${year}-${String(seq + 1).padStart(6, "0")}`;
      const now = new Date().toISOString();

      const ticket: Ticket = {
        id: crypto.randomUUID(),
        tenantId: ctx.tenant.id,
        reference,
        conversationId: ctx.conversationId,
        customerName,
        customerEmail,
        subject,
        description: args.orderNumber ? `Order ${args.orderNumber}\n\n${description}` : description,
        category,
        priority: "normal",
        status: "open",
        createdAt: now,
        updatedAt: now,
      };

      // ---- persist FIRST (source of truth); email is best-effort after ------ 
      const created = await ctx.db.createTicket(ticket);
      await ctx.db.appendTicketMessage({
        id: crypto.randomUUID(),
        ticketId: created.id,
        senderType: "customer",
        senderId: customerEmail,
        message: description,
        createdAt: now,
      });

      // Email the tenant. Fire-and-forget: a failure must never fail the ticket.
      sendTicketEmail(ctx.tenant, created)
        .then((r) => {
          if (!r.sent) console.warn("[create_ticket] email not sent:", r.error);
        })
        .catch((err) => console.warn("[create_ticket] email threw:", err));

      return {
        ok: true,
        text: `Your support ticket has been created. Reference: ${created.reference}. The ${ctx.tenant.name} team has been notified and will review your request. You can quote this reference if you need to follow up.`,
      };
    }
    case "check_ticket_status": {
      const reference = asStr(args.reference);
      if (!reference) return { ok: false, text: "Please give me your ticket reference, e.g. IP-2026-000042." };
      const ticket = await ctx.db.getTicketByReference(ctx.tenant.id, reference);
      if (!ticket) {
        return { ok: false, text: `I couldn't find a ticket with reference ${reference}. Double-check the number, or raise a new one.` };
      }
      const email = asStr(args.email) ?? "";
      if (email && ticket.customerEmail.toLowerCase() !== email.toLowerCase()) {
        return { ok: false, text: "That reference doesn't match the email on file. Please use the email the ticket was raised with." };
      }
      const statusLine: Record<string, string> = {
        open: "is open and with our support team",
        pending: "is awaiting information from you or a supplier",
        resolved: "has been resolved",
        closed: "has been closed",
      };
      return {
        ok: true,
        text: `Ticket ${reference} ${statusLine[ticket.status] ?? ticket.status}. Raised ${ticket.createdAt.slice(0, 10)} about “${ticket.subject}”. Our team will be in touch by email.`,
      };
    }
    case "sales_summary": {
      const s = await woo.salesSummary({ days: asNum(args.days) });
      const sym = ctx.tenant.currency === "GBP" ? "£" : ctx.tenant.currency + " ";
      const top = s.topProducts.map((t) => `- ${t.name}: ${t.units} sold, ${sym}${t.revenue.toFixed(2)}`).join("\n");
      return {
        ok: true,
        text: `Sales summary (${s.period}):\nRevenue: ${sym}${s.revenue.toFixed(2)} across ${s.orders} orders (${s.items} items).\nAverage order value: ${sym}${s.avgOrderValue.toFixed(2)}\nTop products:\n${top}`,
      };
    }
    case "inventory": {
      const items = await woo.inventory();
      const low = items.filter((i) => i.inStock && (i.stockQuantity ?? 99) <= 5);
      const out = items.filter((i) => !i.inStock);
      const lines: string[] = [];
      if (low.length) lines.push(`Low stock (≤5):\n${low.map((i) => `- ${i.name}: ${i.stockQuantity} left`).join("\n")}`);
      if (out.length) lines.push(`Out of stock:\n${out.map((i) => `- ${i.name}`).join("\n")}`);
      if (!lines.length) lines.push("All products have healthy stock levels.");
      lines.push(`Total products tracked: ${items.length}.`);
      return { ok: true, text: lines.join("\n") };
    }
    case "analytics": {
      const r = await woo.analytics({ days: asNum(args.days) });
      const sym = ctx.tenant.currency === "GBP" ? "£" : ctx.tenant.currency + " ";
      const days = r.byDay.map((d) => `- ${d.date}: ${sym}${d.revenue.toFixed(2)} (${d.orders} orders)`).join("\n");
      const top = r.topProducts.map((t) => `- ${t.name}: ${t.units} sold, ${sym}${t.revenue.toFixed(2)}`).join("\n");
      return {
        ok: true,
        text: `Analytics (${r.period}):\nTotal revenue: ${sym}${r.totalRevenue.toFixed(2)} across ${r.totalOrders} orders.\nBy day:\n${days}\nTop products:\n${top}`,
      };
    }
    default:
      return { ok: false, text: `Unknown tool: ${name}` };
  }
}

// ---------------------------------------------------------------------------
// Tenant website search (search_website tool) — SSRF-safe.
//
// Lets the AI find store info that isn't in the knowledge base (delivery
// times, returns policy, care guides, FAQ, size guide…) by searching the
// tenant's OWN website. Hard constraints so it can never reach anywhere else:
//   * Base URL comes from the tenant's integrations (server-side only), never
//     from the AI.
//   * The AI supplies only search terms OR a RELATIVE page path.
//   * Every outbound URL is re-validated: tenant host (or subdomain) only,
//     http(s) only, no private/reserved hosts, and redirects re-checked.
//   * Reads are time-boxed and size-capped.
// ---------------------------------------------------------------------------

const WEBSITE_TIMEOUT_MS = 8000;
const WEBSITE_MAX_TEXT = 20000; // chars of extracted text kept per page

function isPublicWebHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]") return false;
  if (/^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
  if (/\.(local|internal|lan)$/.test(h)) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return false; // bare IPv4 literal
  return true;
}

function isSameSiteOrSubdomain(candidate: URL, base: URL): boolean {
  const baseHost = base.hostname.toLowerCase().replace(/^www\./, "");
  const candHost = candidate.hostname.toLowerCase().replace(/^www\./, "");
  return candHost === baseHost || candHost.endsWith("." + baseHost);
}

// Stop-words / question-framing words stripped before a WP search, because
// WordPress REST search matches keywords, not full sentences.
const WEBSITE_STOP_WORDS = new Set([
  "how", "what", "whats", "where", "when", "why", "which", "who", "whom",
  "does", "do", "did", "is", "are", "was", "were", "be", "been", "being",
  "can", "could", "would", "should", "will", "shall", "may", "might", "must",
  "the", "a", "an", "and", "or", "but", "if", "of", "to", "for", "with",
  "on", "in", "at", "by", "from", "as", "about", "into", "over", "under",
  "your", "you", "my", "me", "i", "we", "our", "us", "they", "them", "it",
  "its", "this", "that", "these", "those", "have", "has", "had", "not", "no",
  "any", "all", "please", "tell", "give", "show", "need", "looking",
  "long", "much", "many", "available", "currently",
]);

function extractSearchKeywords(query: string): string {
  const words = query
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !WEBSITE_STOP_WORDS.has(w) && !/^\d+$/.test(w));
  return words.slice(0, 6).join(" ");
}

function tenantWebsiteBase(tenant: Tenant): URL | null {
  const raw = tenant.wooUrl || tenant.storeUrl;
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (!isPublicWebHost(u.hostname)) return null;
  return u;
}

function stripHtmlToText(html: string): string {
  let s = html;
  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  s = s.replace(/<svg[\s\S]*?<\/svg>/gi, " ");
  s = s.replace(/<(header|footer|nav|aside)[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|li|h1|h2|h3|h4|h5|h6|tr|table|section|article|ul|ol)>/gi, "\n");
  s = s.replace(/<li[^>]*>/gi, "- ");
  s = s.replace(/<(th|td)[^>]*>/gi, " | ");
  s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/&nbsp;/g, " ")
    .replace(/&amp;|&#038;/g, "&")
    .replace(/&#0?39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ndash;|&#8211;/g, "-")
    .replace(/&mdash;|&#8212;/g, "—")
    .replace(/&pound;/g, "£")
    .replace(/&ldquo;|&rdquo;|&quot;/g, '"')
    .replace(/&#x2F;|&#47;/gi, "/");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n");
  return s;
}

async function fetchTenantText(url: URL, base: URL): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), WEBSITE_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; StoreSupportBot/1.0)" },
    });
    if (!res.ok) return null;
    // Re-check the final URL after redirects stayed on the tenant's site.
    let finalHost: string;
    try {
      finalHost = new URL(res.url || url.toString()).hostname;
    } catch {
      return null;
    }
    const baseHost = base.hostname.toLowerCase().replace(/^www\./, "");
    const h = finalHost.toLowerCase().replace(/^www\./, "");
    if (h !== baseHost && !h.endsWith("." + baseHost)) return null;
    const html = await res.text();
    return stripHtmlToText(html);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function searchTenantWebsite(
  tenant: Tenant,
  args: { query?: string; path?: string },
  opts: { limit?: number } = {},
): Promise<ToolResult> {
  const base = tenantWebsiteBase(tenant);
  if (!base) return { ok: false, text: "No website is configured for this store." };

  const path = (args.path ?? "").trim();
  if (path) {
    if (!path.startsWith("/") || path.includes("//") || path.split("/").includes("..")) {
      return { ok: false, text: "That page path isn't valid. Use a path like '/returns/'." };
    }
    const target = new URL(base);
    target.pathname = path;
    target.search = "";
    target.hash = "";
    if (!isSameSiteOrSubdomain(target, base)) {
      return { ok: false, text: "Blocked: that page is outside the store's website." };
    }
    const text = await fetchTenantText(target, base);
    if (!text) return { ok: false, text: "Couldn't read that page on the store's website." };
    return { ok: true, text: text.slice(0, WEBSITE_MAX_TEXT) };
  }

  const query = (args.query ?? "").trim();
  if (!query) {
    return {
      ok: false,
      text: "Please give me a search term (e.g. 'delivery times') or a page path (e.g. '/returns/').",
    };
  }

  // WordPress REST search matches keywords, not full sentences. Build a list
  // of candidate search terms from least- to most-aggressive and try them in
  // order until we get hits:
  //   1. extracted keywords (stop-words stripped)   e.g. "deliver internationally"
  //   2. the raw query as-is                        e.g. "Do you deliver internationally?"
  //   3. just the first meaningful keyword          e.g. "deliver"
  const keywords = extractSearchKeywords(query);
  const candidateTerms = [keywords, query];
  if (keywords && keywords !== query) {
    const first = keywords.split(" ")[0];
    if (first && first !== keywords) candidateTerms.push(first);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), WEBSITE_TIMEOUT_MS);
  let hits: Array<{ url: string; title: string }> = [];
  let usedTerm = query;
  try {
    for (const term of candidateTerms) {
      const searchUrl = new URL(base);
      searchUrl.pathname = "/wp-json/wp/v2/search";
      searchUrl.search = new URLSearchParams({ search: term, per_page: "5", subtype: "post,page" }).toString();
      const res = await fetch(searchUrl.toString(), { signal: ctrl.signal });
      if (res.ok) {
        const j = (await res.json()) as Array<Record<string, unknown>>;
        if (Array.isArray(j) && j.length) {
          hits = j
            .filter((x) => typeof x?.url === "string" && typeof x?.title === "string")
            .map((x) => ({ url: x.url as string, title: x.title as string }));
          usedTerm = term;
          break;
        }
      }
    }
  } catch {
    // fall through — no search results
  } finally {
    clearTimeout(timer);
  }

  if (!hits.length) {
    return { ok: false, text: `Nothing found on the store's website for "${query}".` };
  }

  const chunks: string[] = [];
  for (const hit of hits.slice(0, opts.limit ?? 3)) {
    let u: URL;
    try {
      u = new URL(hit.url, base);
    } catch {
      continue;
    }
    if (!isSameSiteOrSubdomain(u, base)) continue;
    const text = await fetchTenantText(u, base);
    if (text) {
      chunks.push(`## ${stripHtmlToText(hit.title)} (${u.toString()})\n${text.slice(0, WEBSITE_MAX_TEXT)}`);
    }
  }

  if (!chunks.length) {
    return { ok: false, text: `Couldn't read any matching pages on the store's website for "${query}".` };
  }
  return { ok: true, text: chunks.join("\n\n---\n\n") };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function wooClientFor(tenant: Tenant): WooClient {
  if (tenant.wooUrl && tenant.wooKey && tenant.wooSecret) {
    return new WooCommerceClient(tenant);
  }
  // Non-retail tenants (e.g. accountancy) have no product catalogue.
  const emptyCatalogue = tenant.slug === "ntm-associates";
  return new MockWooClient(emptyCatalogue ? [] : undefined);
}

function asStr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
function asNum(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function asRecord(v: unknown): Record<string, string> | undefined {
  if (v && typeof v === "object") {
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof val === "string") out[k] = val;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return undefined;
}

export function summarizeProducts(products: Product[], currency: string): string {
  const sym = currency === "GBP" ? "£" : currency === "USD" ? "$" : currency + " ";
  return products
    .map((p) => `- ${p.name} — ${sym}${p.price.toFixed(2)}${p.inStock === false ? " (out of stock)" : ""} (id ${p.id})`)
    .join("\n");
}

export function describeProduct(p: Product, currency: string): string {
  const sym = currency === "GBP" ? "£" : currency === "USD" ? "$" : currency + " ";
  const attrs = Object.entries(p.attributes ?? {})
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
  return `${p.name} — ${sym}${p.price.toFixed(2)}${p.inStock === false ? " (currently out of stock)" : " (in stock)"}
${p.description ?? ""}
${attrs ? `Attributes: ${attrs}` : ""}`;
}

export function summarizeOrder(o: Order): string {
  const items = o.items.map((i) => `${i.qty}× ${i.name}`).join(", ");
  return `Order #${o.id} (${o.date.slice(0, 10)}): ${o.status} — ${items}. Total ${o.currency === "GBP" ? "£" : o.currency}${o.total.toFixed(2)}.`;
}

export function summarizeCart(cart: Array<{ productName: string; variantName?: string; quantity: number; price: number }>, currency: string): string {
  const sym = currency === "GBP" ? "£" : currency === "USD" ? "$" : currency + " ";
  const total = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  const lines = cart.map((i) => `- ${i.productName}${i.variantName ? ` (${i.variantName})` : ""} × ${i.quantity} — ${sym}${(i.price * i.quantity).toFixed(2)}`);
  return `Your cart:\n${lines.join("\n")}\nTotal: ${sym}${total.toFixed(2)}`;
}

/**
 * Maps persisted cart items to Product objects so the output gate can
 * recognise the product names the model quotes in cart replies. Without this,
 * a legitimate product name containing an off-topic keyword (e.g. "Diamond
 * Tennis Bracelet" → "tennis" in the sports list) would trip Gate 5's fuzzy
 * off-topic check and cause a false refusal.
 */
export function cartToProducts(cart: CartItem[]): Product[] {
  return cart.map((i) => ({
    id: i.productId,
    name: i.productName,
    price: i.price,
    currency: i.currency,
    url: i.url,
    imageUrl: i.imageUrl,
    inStock: i.inStock,
  }));
}
