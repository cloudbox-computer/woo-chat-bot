export type ProviderName = "mock" | "openai" | "gemini";

/**
 * Per-tenant policy ("Tenant Policy Engine").
 *
 * The AI is never the authority on tenant boundaries — the application is.
 * Every request passes through the policy engine before the LLM is contacted:
 *
 *   Gate 1  Tenant auth        (chatbotId resolved server-side → tenant)
 *   Gate 2  Input safety       (prompt-injection / jailbreak detection)
 *   Gate 3  Topic gate         (tenant-scope allowlist, never a blocklist)
 *   Gate 4  Main AI + tools    (permission-filtered tool set)
 *   Gate 5  Output gate        (response validator)
 */
export interface TenantPolicy {
  /** Allowlist of topics this tenant's chatbot may discuss. Keys into the
   *  topic lexicon (see _shared/policy.ts). Everything else is rejected. */
  allowedTopics: string[];
  /** Fixed refusal response returned when a request fails a gate (§10).
   *  The model is told to use exactly this when asked out of scope. */
  refusalMessage: string;
  /** How paranoid to be. "extra-strict" is the default for retail tenants. */
  securityLevel: "standard" | "strict" | "extra-strict";
  /** Send ambiguous messages to a cheap classifier model instead of
   *  defaulting to allow. Default false (deterministic rules only). */
  useModelClassifier?: boolean;
}

export interface Tenant {
  id: string;
  slug: string;
  name: string; // business name, e.g. "Ivy & Pearls"
  kind?: "retail" | "services"; // retail: product catalogue; services: knowledge-led
  storeUrl?: string;
  currency: string;
  welcomeMessage: string;
  tone?: string;
  brandColour?: string;
  wooUrl?: string;
  wooKey?: string;
  wooSecret?: string;
  businessContext?: string; // injected into the system prompt
  /** Tenant Policy Engine config — the strict-scope boundary for this tenant. */
  policy?: TenantPolicy;
  /** Email address the tenant wants support tickets delivered to (convo2).
   *  Resolved server-side — the AI never supplies or sees this. */
  supportEmail?: string;
  /** Prefix used in ticket references, e.g. "IP" → IP-2026-000042. */
  ticketPrefix?: string;
}

export interface Chatbot {
  id: string;
  /** Opaque public widget id (e.g. "cb_7f82k91") exposed in the embed snippet
   *  instead of the internal slug or Supabase URL. Resolved server-side. */
  publicId?: string;
  tenantId: string;
  name: string;
  active: boolean;
  // Which tool permission levels this chatbot may use.
  // Default: read + customer actions. Admin/sensitive are added per business.
  permissions?: ToolPermission[];
}

export type ToolPermission = "read" | "cart" | "support" | "sensitive" | "admin";

// Default: browse the catalogue + manage a cart + create support tickets.
// `sensitive` (cancel/modify/refund orders) and `admin` (reports) are
// opt-in per business.
export const DEFAULT_CHATBOT_PERMISSIONS: ToolPermission[] = ["read", "cart", "support"];

export interface Conversation {
  id: string;
  chatbotId: string;
  customerEmail?: string;
  createdAt: string; // ISO
  updatedAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  products?: Product[];
  createdAt: string;
}

export interface ProductVariant {
  id: string;
  name: string; // e.g. "Gold / 45cm"
  price?: number; // falls back to product price
  inStock: boolean;
  attributes?: Record<string, string>; // e.g. { colour: "gold", size: "45cm" }
}

export interface Product {
  id: string | number;
  name: string;
  price: number;
  currency: string;
  description?: string;
  category?: string;
  url?: string;
  imageUrl?: string;
  inStock?: boolean;
  stockQuantity?: number;
  attributes?: Record<string, string>;
  variants?: ProductVariant[];
}

export interface CartItem {
  productId: string | number;
  productName: string;
  variantId?: string;
  variantName?: string;
  price: number;
  currency: string;
  quantity: number;
  url?: string;
  imageUrl?: string;
  inStock: boolean;
}


export interface Order {
  id: string;
  customerEmail: string;
  status: string;
  total: number;
  currency: string;
  items: Array<{ name: string; qty: number }>;
  date: string;
}

export interface OrderPatch {
  status?: string;
  shippingAddress?: {
    firstName?: string;
    lastName?: string;
    address1?: string;
    address2?: string;
    city?: string;
    postcode?: string;
    country?: string;
  };
}

export interface SalesSummary {
  period: string;
  revenue: number;
  orders: number;
  items: number;
  avgOrderValue: number;
  topProducts: Array<{ name: string; units: number; revenue: number }>;
}

export interface InventoryItem {
  productId: string | number;
  name: string;
  stockQuantity?: number;
  inStock: boolean;
  category?: string;
}

export interface AnalyticsReport {
  period: string;
  totalRevenue: number;
  totalOrders: number;
  byDay: Array<{ date: string; revenue: number; orders: number }>;
  topProducts: Array<{ name: string; units: number; revenue: number }>;
}

export interface KnowledgeItem {
  id: string;
  chatbotId: string;
  title: string;
  content: string;
  keywords?: string[];
}

export interface Feedback {
  conversationId: string;
  rating: "up" | "down";
  comment?: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Support tickets (convo2.md)
// ---------------------------------------------------------------------------

/** Valid categories the AI may use when raising a ticket. Validated server-side
 *  against this allowlist (the AI can't invent its own). */
export type TicketCategory =
  | "damaged_item"
  | "missing_order"
  | "wrong_product"
  | "product_defect"
  | "delivery_problem"
  | "refund_problem"
  | "payment_problem"
  | "order_problem"
  | "complaint"
  | "other";

export const TICKET_CATEGORIES: ReadonlyArray<{ value: TicketCategory; label: string }> = [
  { value: "damaged_item", label: "Damaged item" },
  { value: "missing_order", label: "Missing order" },
  { value: "wrong_product", label: "Wrong product received" },
  { value: "product_defect", label: "Product defect / fault" },
  { value: "delivery_problem", label: "Delivery problem" },
  { value: "refund_problem", label: "Refund problem" },
  { value: "payment_problem", label: "Payment problem" },
  { value: "order_problem", label: "Order problem" },
  { value: "complaint", label: "Complaint" },
  { value: "other", label: "Other" },
];

export type TicketStatus = "open" | "pending" | "resolved" | "closed";
export type TicketPriority = "low" | "normal" | "high";

/** A support ticket. The customer only ever holds the `reference`;
 *  tenant_id / recipient email are always resolved server-side. */
export interface Ticket {
  id: string;
  tenantId: string;
  reference: string;
  conversationId?: string;
  customerName?: string;
  customerEmail: string;
  subject: string;
  description: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
}

/** A message inside a ticket's thread (customer ↔ agent over time). */
export interface TicketMessage {
  id: string;
  ticketId: string;
  senderType: "customer" | "agent" | "system";
  senderId?: string;
  message: string;
  createdAt: string;
}

/** Payload the AI supplies to create_ticket. Deliberately contains NO
 *  tenant_id, NO recipient email and NO reference — the backend owns those. */
export interface CreateTicketInput {
  category: TicketCategory;
  subject: string;
  description: string;
  customerName?: string;
  customerEmail: string;
  orderNumber?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatRequest {
  chatbotId: string;
  conversationId?: string;
  message: string;
  customerEmail?: string;
}

export interface ChatResponse {
  reply: string;
  products?: Product[];
  conversationId: string;
}

export const SUPPORTED_TOOL_NAMES = [
  // READ
  "search_products",
  "get_product",
  "get_categories",
  "track_order",
  "recommend_products",
  "search_knowledge",
  "check_ticket_status",
  // CART
  "add_to_cart",
  "view_cart",
  "update_cart",
  "remove_from_cart",
  "create_checkout",
  // SUPPORT (tickets — convo2)
  "create_ticket",
  // SENSITIVE (off by default)
  "cancel_order",
  "modify_order",
  "refund_order",
  // ADMIN (off by default)
  "sales_summary",
  "inventory",
  "analytics",
] as const;
