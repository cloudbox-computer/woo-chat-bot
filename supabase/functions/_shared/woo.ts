import type { CartItem, Order, OrderPatch, Product, ProductVariant, SalesSummary, InventoryItem, AnalyticsReport, Tenant } from "./types.ts";
import { IVY_PEARLS_CATALOGUE, IVY_PEARLS_CATEGORIES, IVY_PEARLS_ORDERS } from "./mock-data.ts";

// Statuses an order must be in for a customer-facing change to be allowed.
export const CANCELLABLE_STATUSES = ["pending", "processing", "on-hold"];
export const MODIFIABLE_STATUSES = ["pending", "processing", "on-hold"];
export const REFUNDABLE_STATUSES = ["processing", "completed", "on-hold"];
export const VALID_STATUSES = ["pending", "processing", "on-hold", "completed", "cancelled", "refunded", "failed", "trash"];

// Mutable copy of seed orders so demo changes (cancel/modify/refund) persist
// for the process lifetime in mock mode.
let MOCK_ORDERS: Order[] = IVY_PEARLS_ORDERS.map((o) => ({ ...o, items: o.items.map((i) => ({ ...i })) }));

function setMockOrderStatus(orderId: string, status: string): Order {
  const order = MOCK_ORDERS.find((o) => o.id === orderId);
  if (!order) return { id: orderId, customerEmail: "", status, total: 0, currency: "GBP", items: [], date: "" };
  order.status = status;
  return { ...order };
}

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
    if (opts.orderId && /^\d+$/.test(opts.orderId)) {
      try {
        const row = await this.get<WooOrder>(`orders/${opts.orderId}`);
        return [wooToOrder(row)];
      } catch {
        return [];
      }
    }
    if (opts.email) {
      const rows = await this.get<WooOrder[]>("orders", { per_page: "10", search: opts.email });
      return rows.map((r) => wooToOrder(r)).filter((o) => o.customerEmail.toLowerCase() === opts.email!.toLowerCase());
    }
    return [];
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
// Mock WooCommerce (dev/demo when no credentials configured)
// ---------------------------------------------------------------------------

function singularize(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 3 && w.endsWith("es") && !w.endsWith("ces")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s")) return w.slice(0, -1);
  return w;
}

export class MockWooClient implements WooClient {
  constructor(private products: Product[] = IVY_PEARLS_CATALOGUE) {}


  // Module-level mutable order store so cancel/modify/refund persist across
  // tool calls within the same process (demo mode).
  private static mutableOrders: Order[] = IVY_PEARLS_ORDERS.map((o) => ({ ...o, items: [...o.items] }));

  async searchProducts(opts: {
    query?: string;
    maxPrice?: number;
    minPrice?: number;
    category?: string;
    attributes?: Record<string, string>;
  }): Promise<Product[]> {
    let out = this.products;
    if (opts.query) {
      // Like WooCommerce full-text search: every word must match somewhere
      // in name, category or description (stop words ignored).
      const words = opts.query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2 && !["the", "and", "for", "looking", "with", "have", "any", "some", "got"].includes(w))
        .map(singularize);
      if (words.length) {
        out = out.filter((p) => {
          const hay = `${p.name} ${p.category ?? ""} ${p.description ?? ""}`.toLowerCase();
          return words.every(
            (w) => hay.includes(w) || (w.length > 3 && w.endsWith("s") && hay.includes(w.slice(0, -1))),
          );
        });
      }
    }
    if (opts.maxPrice !== undefined) out = out.filter((p) => p.price <= opts.maxPrice!);
    if (opts.minPrice !== undefined) out = out.filter((p) => p.price >= opts.minPrice!);
    if (opts.category) {
      const c = opts.category.toLowerCase();
      out = out.filter((p) => (p.category ?? "").toLowerCase().includes(c));
    }
    for (const [name, term] of Object.entries(opts.attributes ?? {})) {
      const t = term.toLowerCase();
      out = out.filter((p) => (p.attributes?.[name] ?? "").toLowerCase().includes(t));
    }
    return out.slice(0, 6);
  }

  async getProduct(id: string | number): Promise<Product | null> {
    const found = this.products.find((p) => String(p.id) === String(id));
    return found ? structuredClone(found) : null;
  }

  async getVariants(productId: string | number): Promise<ProductVariant[]> {
    const product = await this.getProduct(productId);
    return product?.variants ?? [];
  }

  async checkStock(productId: string | number, variantId?: string): Promise<StockResult | null> {
    const product = await this.getProduct(productId);
    if (!product) return null;
    if (variantId) {
      const variant = product.variants?.find((v) => v.id === String(variantId));
      if (!variant) return { product, inStock: false };
      return { product, variant, inStock: variant.inStock };
    }
    return { product, inStock: product.inStock !== false };
  }

  async getCategories(): Promise<WooCategory[]> {
    return IVY_PEARLS_CATEGORIES;
  }

  async trackOrder(opts: { orderId?: string; email?: string }): Promise<Order[]> {
    let out = MOCK_ORDERS;
    if (opts.orderId) out = out.filter((o) => o.id === opts.orderId);
    if (opts.email) {
      const email = opts.email.toLowerCase();
      out = out.filter((o) => o.customerEmail.toLowerCase() === email);
    }
    return out.map((o) => ({ ...o }));
  }

  async cancelOrder(opts: { orderId: string; email?: string }): Promise<Order | null> {
    const order = findMockOrder(opts.orderId, opts.email);
    if (!order) return null;
    if (!CANCELLABLE_STATUSES.includes(order.status)) return cloneOrder(order);
    order.status = "cancelled";
    return cloneOrder(order);
  }

  async modifyOrder(opts: { orderId: string; email?: string; patch: OrderPatch }): Promise<Order | null> {
    const { patch } = opts;
    const order = findMockOrder(opts.orderId, opts.email);
    if (!order) return null;
    if (!MODIFIABLE_STATUSES.includes(order.status)) return cloneOrder(order);
    if (patch.status && VALID_STATUSES.includes(patch.status)) order.status = patch.status;
    return cloneOrder(order);
  }

  async refundOrder(opts: { orderId: string; email?: string; reason?: string }): Promise<Order | null> {
    const order = findMockOrder(opts.orderId, opts.email);
    if (!order) return null;
    if (!REFUNDABLE_STATUSES.includes(order.status)) return cloneOrder(order);
    order.status = "refunded";
    return cloneOrder(order);
  }

  async salesSummary(opts: { days?: number }): Promise<SalesSummary> {
    const orders = this.mockOrders();
    const cutoff = cutoffDate(opts.days);
    const recent = orders.filter((o) => new Date(o.date) >= cutoff);
    const revenue = recent.reduce((s, o) => s + o.total, 0);
    const items = recent.reduce((s, o) => s + o.items.reduce((a, i) => a + i.qty, 0), 0);
    const byName = new Map<string, { units: number; revenue: number }>();
    for (const o of recent) {
      for (const i of o.items) {
        const cur = byName.get(i.name) ?? { units: 0, revenue: 0 };
        cur.units += i.qty;
        cur.revenue += i.qty * (o.total / Math.max(1, o.items.reduce((a, x) => a + x.qty, 0)));
        byName.set(i.name, cur);
      }
    }
    return {
      period: periodLabel(opts.days),
      revenue,
      orders: recent.length,
      items,
      avgOrderValue: recent.length ? revenue / recent.length : 0,
      topProducts: [...byName.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.revenue - a.revenue).slice(0, 5),
    };
  }

  async inventory(): Promise<InventoryItem[]> {
    return this.products.map((p, i) => ({
      productId: p.id,
      name: p.name,
      stockQuantity: p.stockQuantity ?? (p.inStock === false ? 0 : ((i * 7) % 9) + 2),
      inStock: p.inStock !== false,
      category: p.category,
    }));
  }

  async analytics(opts: { days?: number }): Promise<AnalyticsReport> {
    const orders = this.mockOrders();
    const cutoff = cutoffDate(opts.days);
    const recent = orders.filter((o) => new Date(o.date) >= cutoff);
    const byDay = new Map<string, { revenue: number; orders: number }>();
    for (const o of recent) {
      const day = o.date.slice(0, 10);
      const cur = byDay.get(day) ?? { revenue: 0, orders: 0 };
      cur.revenue += o.total;
      cur.orders += 1;
      byDay.set(day, cur);
    }
    const summary = await this.salesSummary({ days: opts.days });
    return {
      period: periodLabel(opts.days),
      totalRevenue: summary.revenue,
      totalOrders: summary.orders,
      byDay: [...byDay.entries()].map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date)),
      topProducts: summary.topProducts,
    };
  }

  private mockOrders(): Order[] {
    return MockWooClient.mutableOrders;
  }

  async listAll(): Promise<Product[]> {
    return structuredClone(this.products);
  }

  buildCheckoutUrl(items: CartItem[], email?: string): string {
    const params = new URLSearchParams();
    if (email) params.set("email", email);
    const qs = params.toString();
    return `https://ivyandpearls.co.uk/checkout/${qs ? "?" + qs : ""}`;
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
// Shared mock helpers
// ---------------------------------------------------------------------------

function findMockOrder(orderId: string, email?: string): Order | undefined {
  const order = MOCK_ORDERS.find((o) => o.id === orderId);
  if (!order) return undefined;
  if (email && order.customerEmail.toLowerCase() !== email.toLowerCase()) return undefined;
  return order;
}

function cloneOrder(o: Order): Order {
  return { ...o, items: o.items.map((i) => ({ ...i })) };
}

function cutoffDate(days?: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - (days ?? 7));
  return d;
}

function daysAgoISO(days?: number): string {
  return cutoffDate(days).toISOString();
}

// ---------------------------------------------------------------------------
