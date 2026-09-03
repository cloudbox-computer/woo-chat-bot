import type { CartItem, Order, OrderPatch, Product, ProductVariant, SalesSummary, InventoryItem, AnalyticsReport, Tenant } from "./types.ts";

// Statuses an order must be in for a customer-facing change to be allowed.
export const CANCELLABLE_STATUSES = ["pending", "processing", "on-hold"];
export const MODIFIABLE_STATUSES = ["pending", "processing", "on-hold"];
export const REFUNDABLE_STATUSES = ["processing", "completed", "on-hold"];
export const VALID_STATUSES = ["pending", "processing", "on-hold", "completed", "cancelled", "refunded", "failed", "trash"];

function periodParam(days?: number): string {
  if (days === undefined || days === 7) return "week";
  if (days <= 1) return "today";
  if (days <= 30) return "month";
  return "year";
}

function periodLabel(days?: number): string {
  if (days === undefined || days === 7) return "last 7 days";
  if (days <= 1) return "today";
  return `last ${days} days`;
}

export interface WooCategory {
  slug: string;
  name: string;
}

export interface StockResult {
  product: Product;
  variant?: ProductVariant;
  inStock: boolean;
  stockQuantity?: number;
}

export interface WooClient {
  searchProducts(opts: {
    query?: string;
    maxPrice?: number;
    minPrice?: number;
    category?: string;
    attributes?: Record<string, string>;
  }): Promise<Product[]>;
  getProduct(id: string | number): Promise<Product | null>;
  getVariants(productId: string | number): Promise<ProductVariant[]>;
  checkStock(productId: string | number, variantId?: string): Promise<StockResult | null>;
  getCategories(): Promise<WooCategory[]>;
  trackOrder(opts: { orderId?: string; email?: string }): Promise<Order[]>;
  listAll(): Promise<Product[]>;
  buildCheckoutUrl(items: CartItem[], email?: string): string;
  cancelOrder(opts: { orderId: string; email?: string }): Promise<Order | null>;
  modifyOrder(opts: { orderId: string; email?: string; patch: OrderPatch }): Promise<Order | null>;
  refundOrder(opts: { orderId: string; email?: string; reason?: string }): Promise<Order | null>;
  salesSummary(opts: { days?: number }): Promise<SalesSummary>;
  inventory(): Promise<InventoryItem[]>;
  analytics(opts: { days?: number }): Promise<AnalyticsReport>;
}

// ---------------------------------------------------------------------------
// Real WooCommerce REST API (WooCommerce REST API v3, WP Basic auth)
// ---------------------------------------------------------------------------

export class WooCommerceClient implements WooClient {
  private base: string;
  private auth: string;
  private storeUrl: string;

  constructor(tenant: Tenant) {
    const url = tenant.wooUrl ?? "";
    const key = tenant.wooKey ?? "";
    const secret = tenant.wooSecret ?? "";
    this.storeUrl = url.replace(/\/$/, "");
    this.base = this.storeUrl + "/wp-json/wc/v3";
    this.auth = "Basic " + btoa(`${key}:${secret}`);
  }

  private async get<T>(path: string, qs: Record<string, string> = {}): Promise<T> {
    const res = await fetch(`${this.base}/${path}?${new URLSearchParams(qs)}`, {
      headers: { Authorization: this.auth },
    });
    if (!res.ok) throw new Error(`WooCommerce ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  private async send<T>(method: string, path: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.base}/${path}`, {
      method,
      headers: { Authorization: this.auth, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`WooCommerce ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  async searchProducts(opts: {
    query?: string;
    maxPrice?: number;
    minPrice?: number;
    category?: string;
    attributes?: Record<string, string>;
  }): Promise<Product[]> {
    const qs: Record<string, string> = { per_page: "10", status: "publish" };
    if (opts.query) qs.search = opts.query;
    if (opts.maxPrice !== undefined) qs.max_price = String(opts.maxPrice);
    if (opts.minPrice !== undefined) qs.min_price = String(opts.minPrice);
    if (opts.category) qs.category = opts.category;
    for (const [name, term] of Object.entries(opts.attributes ?? {})) {
      qs.attribute = name;
      qs.attribute_term = term;
    }
    const rows = await this.get<WooProduct[]>("products", qs);
    return rows.map((w) => wooToProduct(w));
  }

  async getProduct(id: string | number): Promise<Product | null> {
    try {
      const row = await this.get<WooProduct>(`products/${id}`);
      return wooToProduct(row);
    } catch {
      return null;
    }
  }

  async getVariants(productId: string | number): Promise<ProductVariant[]> {
    try {
      const rows = await this.get<WooVariation[]>(`products/${productId}/variations`, { per_page: "50" });
      return rows.map((v) => ({
        id: String(v.id),
        name: v.attributes?.map((a) => a.option).filter(Boolean).join(" / ") || `Variant ${v.id}`,
        price: v.price ? Number(v.price) : undefined,
        inStock: v.stock_status === "instock" || v.stock_status === "onbackorder",
        attributes: Object.fromEntries(
          (v.attributes ?? []).map((a) => [a.name.toLowerCase().replace(/\s+/g, "_"), a.option])
        ),
      }));
    } catch {
      return [];
    }
  }

  async checkStock(productId: string | number, variantId?: string): Promise<StockResult | null> {
    const product = await this.getProduct(productId);
    if (!product) return null;
    if (variantId) {
      const variants = await this.getVariants(productId);
      const variant = variants.find((v) => v.id === String(variantId));
      if (!variant) return { product, inStock: false };
      return { product, variant, inStock: variant.inStock };
    }
    return { product, inStock: product.inStock !== false };
  }

  async getCategories(): Promise<WooCategory[]> {
    try {
      const rows = await this.get<Array<{ slug: string; name: string }>>("products/categories", { per_page: "100" });
      return rows.map((c) => ({ slug: c.slug, name: c.name }));
    } catch {
      return [];
    }
  }

  async trackOrder(opts: { orderId?: string; email?: string }): Promise<Order[]> {
    // Customer order data is account-specific. Never return an order unless a
    // billing email is supplied AND matches WooCommerce exactly (case-insensitive).
    const email = (opts.email ?? "").trim().toLowerCase();
    if (!email) return [];

    if (opts.orderId && /^\d+$/.test(opts.orderId)) {
      try {
        const row = await this.get<WooOrder>(`orders/${opts.orderId}`);
        const order = wooToOrder(row);
        return order.customerEmail.trim().toLowerCase() === email ? [order] : [];
      } catch {
        return [];
      }
    }

    const rows = await this.get<WooOrder[]>("orders", { per_page: "10", search: email });
    return rows
      .map((r) => wooToOrder(r))
      .filter((o) => o.customerEmail.trim().toLowerCase() === email);
  }

  async cancelOrder(opts: { orderId: string; email?: string }): Promise<Order | null> {
    const current = await this.trackOrder({ orderId: opts.orderId, email: opts.email });
    if (!current.length) return null;
    if (!CANCELLABLE_STATUSES.includes(current[0].status)) return current[0];
    try {
      const row = await this.send<WooOrder>("PUT", `orders/${opts.orderId}`, { status: "cancelled" });
      return wooToOrder(row);
    } catch {
      return null;
    }
  }

  async modifyOrder(opts: { orderId: string; email?: string; patch: OrderPatch }): Promise<Order | null> {
    const { patch } = opts;
    const current = await this.trackOrder({ orderId: opts.orderId, email: opts.email });
    if (!current.length) return null;
    if (!MODIFIABLE_STATUSES.includes(current[0].status)) return current[0];
    const body: Record<string, unknown> = {};
    if (patch.status && VALID_STATUSES.includes(patch.status)) body.status = patch.status;
    if (patch.shippingAddress) {
      const s = patch.shippingAddress;
      body.shipping = {
        first_name: s.firstName,
        last_name: s.lastName,
        address_1: s.address1,
        address_2: s.address2,
        city: s.city,
        postcode: s.postcode,
        country: s.country,
      };
    }
    try {
      const row = await this.send<WooOrder>("PUT", `orders/${opts.orderId}`, body);
      return wooToOrder(row);
    } catch {
      return null;
    }
  }

  async refundOrder(opts: { orderId: string; email?: string; reason?: string }): Promise<Order | null> {
    const current = await this.trackOrder({ orderId: opts.orderId, email: opts.email });
    if (!current.length) return null;
    if (!REFUNDABLE_STATUSES.includes(current[0].status)) return current[0];
    try {
      await this.send("POST", `orders/${opts.orderId}/refunds`, {
        amount: String(current[0].total),
        reason: opts.reason ?? "Refund requested via chat",
      });
      const row = await this.send<WooOrder>("PUT", `orders/${opts.orderId}`, { status: "refunded" });
      return wooToOrder(row);
    } catch {
      return null;
    }
  }

  async salesSummary(opts: { days?: number }): Promise<SalesSummary> {
    const period = periodParam(opts.days);
    const [sales, sellers] = await Promise.all([
      this.get<Array<{ total_sales: string; total_orders: string; total_items: string }>>("reports/sales", { period }),
      this.get<Array<{ name: string; total_sales: string; total: string }>>("reports/top_sellers", { period, per_page: "5" }),
    ]);
    const s = sales[0];
    const top = (sellers ?? []).map((t) => ({
      name: t.name,
      units: Number(t.total ?? 0),
      revenue: Number(t.total_sales ?? 0),
    }));
    const revenue = Number(s?.total_sales ?? 0);
    const orders = Number(s?.total_orders ?? 0);
    return {
      period: periodLabel(opts.days),
      revenue,
      orders,
      items: Number(s?.total_items ?? 0),
      avgOrderValue: orders ? revenue / orders : 0,
      topProducts: top,
    };
  }

  async inventory(): Promise<InventoryItem[]> {
    const rows = await this.get<WooProduct[]>("products", { per_page: "100", status: "publish" });
    return rows.map((w) => ({
      productId: w.id,
      name: w.name,
      stockQuantity: w.stock_quantity ?? undefined,
      inStock: w.stock_status === "instock" || w.stock_status === "onbackorder",
      category: w.categories?.[0]?.name,
    }));
  }

  async analytics(opts: { days?: number }): Promise<AnalyticsReport> {
    const period = periodParam(opts.days);
    const [sales, sellers] = await Promise.all([
      this.get<Array<{ total_sales: string; total_orders: string }>>("reports/sales", { period }),
      this.get<Array<{ name: string; total_sales: string; total: string }>>("reports/top_sellers", { period, per_page: "5" }),
    ]);
    const s = sales[0];
    const orders = await this.get<WooOrder[]>("orders", {
      per_page: "100",
      after: daysAgoISO(opts.days),
      status: "processing,completed,on-hold",
    });
    const byDay = new Map<string, { revenue: number; orders: number }>();
    for (const o of orders) {
      const day = (o.date_created ?? "").slice(0, 10);
      if (!day) continue;
      const cur = byDay.get(day) ?? { revenue: 0, orders: 0 };
      cur.revenue += Number(o.total ?? 0);
      cur.orders += 1;
      byDay.set(day, cur);
    }
    return {
      period: periodLabel(opts.days),
      totalRevenue: Number(s?.total_sales ?? 0),
      totalOrders: Number(s?.total_orders ?? 0),
      byDay: [...byDay.entries()].map(([date, v]) => ({ date, ...v })),
      topProducts: (sellers ?? []).map((t) => ({
        name: t.name,
        units: Number(t.total ?? 0),
        revenue: Number(t.total_sales ?? 0),
      })),
    };
  }

  async listAll(): Promise<Product[]> {
    const rows = await this.get<WooProduct[]>("products", { per_page: "50", status: "publish" });
    return rows.map((w) => wooToProduct(w));
  }

  buildCheckoutUrl(items: CartItem[], email?: string): string {
    // Standard WooCommerce cart flow: send the customer to the cart page so
    // they confirm quantities before Stripe checkout. Card details are never
    // handled by the AI.
    // Include customer email if provided for pre-fill.
    const params = new URLSearchParams();
    if (email) params.set("email", email);
    const qs = params.toString();
    return `${this.storeUrl}/cart/${qs ? "?" + qs : ""}`;
  }
}

// ---------------------------------------------------------------------------
// WooCommerce JSON → internal Product/Order
// ---------------------------------------------------------------------------

interface WooProduct {
  id: number;
  name: string;
  price: string;
  regular_price?: string;
  currency?: string;
  description?: string;
  short_description?: string;
  categories?: Array<{ name: string; slug: string }>;
  permalink?: string;
  images?: Array<{ src: string }>;
  stock_status?: string;
  stock_quantity?: number;
  attributes?: Array<{ name: string; options: string[] }>;
  variations?: number[];
}

interface WooVariation {
  id: number;
  price?: string;
  stock_status?: string;
  attributes?: Array<{ name: string; option: string }>;
}

interface WooOrder {
  id: number;
  status: string;
  total: string;
  currency: string;
  billing?: { email?: string };
  date_created?: string;
  line_items?: Array<{ name: string; quantity: number }>;
}

function wooToProduct(w: WooProduct): Product {
  const attrs: Record<string, string> = {};
  for (const a of w.attributes ?? []) {
    const key = a.name.toLowerCase().replace(/\s+/g, "_");
    attrs[key] = a.options.join(", ");
  }
  return {
    id: w.id,
    name: w.name,
    price: Number(w.price || w.regular_price || 0),
    currency: w.currency ?? "GBP",
    description: (w.short_description || w.description || "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 400),
    category: w.categories?.[0]?.name,
    url: w.permalink,
    imageUrl: w.images?.[0]?.src,
    inStock: w.stock_status === "instock" || w.stock_status === "onbackorder",
    attributes: attrs,
    variants: Array.isArray(w.variations) && w.variations.length ? [] : undefined, // populated lazily via getVariants
  };
}

function wooToOrder(w: WooOrder): Order {
  return {
    id: String(w.id),
    customerEmail: w.billing?.email ?? "",
    status: w.status,
    total: Number(w.total),
    currency: w.currency,
    items: (w.line_items ?? []).map((li) => ({ name: li.name, qty: li.quantity })),
    date: w.date_created ?? "",
  };
}
// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function cutoffDate(days?: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - (days ?? 7));
  return d;
}

function daysAgoISO(days?: number): string {
  return cutoffDate(days).toISOString();
}
