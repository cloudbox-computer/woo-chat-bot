import type { Order, Product, ProductVariant, Tenant } from "../types.ts";
import type {
  BusinessDataInput,
  BusinessDataProvider,
  BusinessDataResult,
  CatalogueProvider,
  OrdersProvider,
  ProductSearchInput,
} from "./types.ts";

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

type FieldMap = Record<string, string>;
type ResourceMap = {
  table: string;
  fields?: FieldMap;
  identityColumn?: string;
  public?: boolean;
  preferred?: boolean;
  maxRows?: number;
};

export interface SupabaseCapabilityConfig {
  catalogue?: ResourceMap;
  orders?: ResourceMap;
}

function safeIdent(value: unknown): string | undefined {
  const s = typeof value === "string" ? value.trim() : "";
  return IDENT.test(s) ? s : undefined;
}

function field(map: ResourceMap, logical: string, fallback: string): string {
  return safeIdent(map.fields?.[logical]) ?? fallback;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function num(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function bool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (v === "true" || v === "1" || v === 1) return true;
  if (v === "false" || v === "0" || v === 0) return false;
  return undefined;
}

class SupabaseRest {
  constructor(private url: string, private anonKey: string) {}

  async query(table: string, params: URLSearchParams): Promise<Record<string, unknown>[]> {
    if (!safeIdent(table)) throw new Error("Invalid configured resource table");
    const res = await fetch(`${this.url.replace(/\/$/, "")}/rest/v1/${table}?${params.toString()}`, {
      headers: {
        apikey: this.anonKey,
        Authorization: `Bearer ${this.anonKey}`,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) throw new Error(`Connected data source returned ${res.status}`);
    const body = await res.json();
    return Array.isArray(body) ? body as Record<string, unknown>[] : [];
  }
}

export class SupabaseCatalogueProvider implements CatalogueProvider {
  readonly providerId = "supabase";
  private rest: SupabaseRest;

  constructor(private tenant: Tenant, private map: ResourceMap) {
    if (!tenant.supabaseUrl || !tenant.supabaseAnonKey) throw new Error("Supabase connection is incomplete");
    this.rest = new SupabaseRest(tenant.supabaseUrl, tenant.supabaseAnonKey);
  }

  private hasExplicitFieldMap(): boolean {
    return !!this.map.fields && Object.keys(this.map.fields).length > 0;
  }

  private selectFields(): string[] {
    if (!this.hasExplicitFieldMap()) return ["*"];
    const mapped = Object.values(this.map.fields ?? {}).map(safeIdent).filter(Boolean) as string[];
    for (const required of [field(this.map, "id", "id"), field(this.map, "name", "name"), field(this.map, "price", "price")]) {
      if (safeIdent(required)) mapped.push(required);
    }
    return Array.from(new Set(mapped));
  }

  private pick(row: Record<string, unknown>, logical: string, fallbacks: string[]): unknown {
    const explicit = safeIdent(this.map.fields?.[logical]);
    if (explicit && Object.prototype.hasOwnProperty.call(row, explicit)) return row[explicit];
    for (const key of fallbacks) {
      if (Object.prototype.hasOwnProperty.call(row, key) && row[key] !== null && row[key] !== undefined) return row[key];
    }
    return undefined;
  }

  private toProduct(row: Record<string, unknown>): Product {
    const rawId = this.pick(row, "id", ["id", "product_id", "productId", "sku"]);
    const rawName = this.pick(row, "name", ["name", "title", "product_name", "productName"]);
    const rawPrice = this.pick(row, "price", ["price", "sale_price", "regular_price", "amount", "unit_price"]);
    const rawCurrency = this.pick(row, "currency", ["currency", "currency_code"]);
    const rawDescription = this.pick(row, "description", ["description", "short_description", "summary"]);
    const rawCategory = this.pick(row, "category", ["category", "category_name", "type"]);
    const rawUrl = this.pick(row, "url", ["url", "permalink", "product_url", "link"]);
    const rawImage = this.pick(row, "image_url", ["image_url", "imageUrl", "image", "featured_image", "thumbnail", "thumbnail_url"]);
    const rawStock = this.pick(row, "in_stock", ["in_stock", "available", "is_available", "active", "is_active", "stock_status"]);
    const rawQty = this.pick(row, "stock_quantity", ["stock_quantity", "stock", "quantity", "inventory_quantity"]);

    let inStock = bool(rawStock);
    if (inStock === undefined && typeof rawStock === "string") {
      const v = rawStock.trim().toLowerCase();
      if (["instock", "in_stock", "available", "active"].includes(v)) inStock = true;
      if (["outofstock", "out_of_stock", "unavailable", "inactive"].includes(v)) inStock = false;
    }

    return {
      id: (rawId as string | number) ?? "",
      name: str(rawName) ?? "Unnamed product",
      price: num(rawPrice) ?? 0,
      currency: str(rawCurrency) ?? this.tenant.currency,
      description: str(rawDescription),
      category: str(rawCategory),
      url: str(rawUrl),
      imageUrl: str(rawImage),
      inStock,
      stockQuantity: num(rawQty),
    };
  }

  private matchesLocalFilters(product: Product, input: ProductSearchInput): boolean {
    if (input.query) {
      const q = input.query.trim().toLowerCase();
      if (q) {
        const hay = `${product.name} ${product.description ?? ""} ${product.category ?? ""}`.toLowerCase();
        const words = q.split(/\s+/).filter(Boolean);
        if (!words.every((w) => hay.includes(w))) return false;
      }
    }
    if (input.minPrice !== undefined && product.price < input.minPrice) return false;
    if (input.maxPrice !== undefined && product.price > input.maxPrice) return false;
    if (input.category && !(product.category ?? "").toLowerCase().includes(input.category.toLowerCase())) return false;
    return true;
  }

  async searchProducts(input: ProductSearchInput): Promise<Product[]> {
    const table = safeIdent(this.map.table);
    if (!table) throw new Error("Catalogue mapping is invalid");
    const p = new URLSearchParams();
    p.set("select", this.selectFields().join(","));
    p.set("limit", String(Math.min(Math.max(1, this.map.maxRows ?? 100), 250)));

    // Only push filters into PostgREST when the tenant supplied an explicit
    // field map. With the conventional `products` table we deliberately fetch
    // a bounded result set and normalise/filter locally so schemas using title,
    // product_name, sale_price, etc. work without provider-specific AI logic.
    if (this.hasExplicitFieldMap()) {
      const nameCol = field(this.map, "name", "name");
      const priceCol = field(this.map, "price", "price");
      const categoryCol = field(this.map, "category", "category");
      if (input.query) p.set(nameCol, `ilike.*${input.query.replace(/[%*,()]/g, "")}*`);
      if (input.minPrice !== undefined) p.append(priceCol, `gte.${input.minPrice}`);
      if (input.maxPrice !== undefined) p.append(priceCol, `lte.${input.maxPrice}`);
      if (input.category) p.set(categoryCol, `ilike.*${input.category.replace(/[%*,()]/g, "")}*`);
      for (const [logical, value] of Object.entries(input.attributes ?? {})) {
        const col = safeIdent(this.map.fields?.[logical]);
        if (col) p.set(col, `eq.${String(value).replace(/[,()]/g, "")}`);
      }
    }

    const products = (await this.rest.query(table, p))
      .map((r) => this.toProduct(r))
      .filter((p) => p.id !== "" && p.name !== "Unnamed product");
    return this.hasExplicitFieldMap() ? products : products.filter((product) => this.matchesLocalFilters(product, input));
  }

  async getProduct(id: string | number): Promise<Product | null> {
    const table = safeIdent(this.map.table);
    if (!table) return null;
    if (!this.hasExplicitFieldMap()) {
      const products = await this.searchProducts({});
      return products.find((p) => String(p.id) === String(id)) ?? null;
    }
    const p = new URLSearchParams();
    p.set("select", this.selectFields().join(","));
    p.set(field(this.map, "id", "id"), `eq.${String(id).replace(/[,()]/g, "")}`);
    p.set("limit", "1");
    const rows = await this.rest.query(table, p);
    return rows[0] ? this.toProduct(rows[0]) : null;
  }

  async getVariants(_productId: string | number): Promise<ProductVariant[]> { return []; }
  async listProducts(): Promise<Product[]> { return this.searchProducts({}); }
}

export class SupabaseOrdersProvider implements OrdersProvider {
  readonly providerId = "supabase";
  private rest: SupabaseRest;

  constructor(private tenant: Tenant, private map: ResourceMap) {
    if (!tenant.supabaseUrl || !tenant.supabaseAnonKey) throw new Error("Supabase connection is incomplete");
    this.rest = new SupabaseRest(tenant.supabaseUrl, tenant.supabaseAnonKey);
  }

  async trackOrder(input: { orderId?: string; email?: string }): Promise<Order[]> {
    const email = (input.email ?? "").trim().toLowerCase();
    const table = safeIdent(this.map.table);
    const identity = safeIdent(this.map.identityColumn) ?? field(this.map, "customer_email", "customer_email");
    if (!email || !table) return [];
    const fields = this.map.fields ?? {};
    const select = Array.from(new Set([
      field(this.map,"id","id"), identity, field(this.map,"status","status"), field(this.map,"total","total"),
      field(this.map,"currency","currency"), field(this.map,"items","items"), field(this.map,"date","created_at"),
    ])).join(",");
    const p = new URLSearchParams({ select, limit: "10" });
    p.set(identity, `eq.${email}`);
    if (input.orderId) p.set(field(this.map,"id","id"), `eq.${String(input.orderId).replace(/[,()]/g, "")}`);
    const rows = await this.rest.query(table, p);
    return rows.map((row) => ({
      id: String(row[field(this.map,"id","id")] ?? ""),
      customerEmail: String(row[identity] ?? ""),
      status: String(row[field(this.map,"status","status")] ?? "unknown"),
      total: num(row[field(this.map,"total","total")]) ?? 0,
      currency: str(row[field(this.map,"currency","currency")]) ?? this.tenant.currency,
      items: Array.isArray(row[field(this.map,"items","items")])
        ? (row[field(this.map,"items","items")] as Array<Record<string, unknown>>).map((i) => ({ name: String(i.name ?? "Item"), qty: num(i.qty ?? i.quantity) ?? 1 }))
        : [],
      date: str(row[field(this.map,"date","created_at")]) ?? new Date(0).toISOString(),
    }));
  }
}

export class SupabaseBusinessDataProvider implements BusinessDataProvider {
  readonly providerId = "supabase";
  private rest: SupabaseRest;
  constructor(private tenant: Tenant) {
    if (!tenant.supabaseUrl || !tenant.supabaseAnonKey) throw new Error("Supabase connection is incomplete");
    this.rest = new SupabaseRest(tenant.supabaseUrl, tenant.supabaseAnonKey);
  }

  async query(input: BusinessDataInput): Promise<BusinessDataResult> {
    const policy = this.tenant.supabaseQueryPolicy;
    const resourcePolicy = policy?.tables?.[input.resource];
    const email = (input.customerEmail ?? "").trim();
    if (!resourcePolicy || !email) throw new Error("That business-data resource is not enabled for customer lookup");
    const table = safeIdent((resourcePolicy as any).table) ?? safeIdent(input.resource);
    if (!table) throw new Error("Business-data resource mapping is invalid");
    const allowed = new Set(resourcePolicy.columns.filter((c) => !!safeIdent(c)));
    const identity = safeIdent(resourcePolicy.identityColumn);
    if (!allowed.size || !identity) throw new Error("Business-data policy is invalid");
    const requested = Array.isArray(input.fields) ? input.fields.filter((f) => allowed.has(f)) : [];
    const fields = requested.length ? requested : Array.from(allowed);
    const p = new URLSearchParams({ select: fields.join(",") });
    p.set(identity, `eq.${email}`);
    for (const [key, value] of Object.entries(input.filters ?? {})) {
      if (key === identity || !allowed.has(key) || value == null) continue;
      const s = String(value);
      if (/^[a-zA-Z0-9_@.+\- ]{1,200}$/.test(s)) p.set(key, `eq.${s}`);
    }
    const orderCols = new Set(resourcePolicy.orderColumns ?? []);
    if (input.orderBy && orderCols.has(input.orderBy)) p.set("order", `${input.orderBy}.${input.orderDirection === "asc" ? "asc" : "desc"}`);
    const max = Math.min(Math.max(1, resourcePolicy.maxRows ?? 20), 50);
    p.set("limit", String(Math.min(Math.max(1, Math.floor(input.limit ?? max)), max)));
    return { resource: input.resource, fields, rows: await this.rest.query(table, p) };
  }
}
