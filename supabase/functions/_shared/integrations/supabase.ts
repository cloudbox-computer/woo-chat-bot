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

  private selectFields(): string[] {
    // When an explicit map is supplied, query only configured physical columns
    // so optional columns that do not exist cannot break the entire catalogue.
    if (this.map.fields && Object.keys(this.map.fields).length) {
      const mapped = Object.values(this.map.fields).map(safeIdent).filter(Boolean) as string[];
      for (const required of [field(this.map, "id", "id"), field(this.map, "name", "name"), field(this.map, "price", "price")]) {
        if (safeIdent(required)) mapped.push(required);
      }
      return Array.from(new Set(mapped));
    }
    return ["id", "name", "price", "currency", "description", "category", "url", "image_url", "in_stock", "stock_quantity"];
  }

  private toProduct(row: Record<string, unknown>): Product {
    const idCol = field(this.map, "id", "id");
    const nameCol = field(this.map, "name", "name");
    const priceCol = field(this.map, "price", "price");
    const currencyCol = field(this.map, "currency", "currency");
    const descriptionCol = field(this.map, "description", "description");
    const categoryCol = field(this.map, "category", "category");
    const urlCol = field(this.map, "url", "url");
    const imageCol = field(this.map, "image_url", "image_url");
    const stockCol = field(this.map, "in_stock", "in_stock");
    const qtyCol = field(this.map, "stock_quantity", "stock_quantity");
    return {
      id: (row[idCol] as string | number) ?? "",
      name: str(row[nameCol]) ?? "Unnamed product",
      price: num(row[priceCol]) ?? 0,
      currency: str(row[currencyCol]) ?? this.tenant.currency,
      description: str(row[descriptionCol]),
      category: str(row[categoryCol]),
      url: str(row[urlCol]),
      imageUrl: str(row[imageCol]),
      inStock: bool(row[stockCol]),
      stockQuantity: num(row[qtyCol]),
    };
  }

  async searchProducts(input: ProductSearchInput): Promise<Product[]> {
    const table = safeIdent(this.map.table);
    if (!table) throw new Error("Catalogue mapping is invalid");
    const p = new URLSearchParams();
    p.set("select", this.selectFields().join(","));
    p.set("limit", String(Math.min(Math.max(1, this.map.maxRows ?? 50), 100)));
    const nameCol = field(this.map, "name", "name");
    const priceCol = field(this.map, "price", "price");
    const categoryCol = field(this.map, "category", "category");
    if (input.query) p.set(nameCol, `ilike.*${input.query.replace(/[%*,()]/g, "")}*`);
    if (input.minPrice !== undefined) p.append(priceCol, `gte.${input.minPrice}`);
    if (input.maxPrice !== undefined) p.append(priceCol, `lte.${input.maxPrice}`);
    if (input.category) p.set(categoryCol, `ilike.${input.category.replace(/[%*,()]/g, "")}`);
    for (const [logical, value] of Object.entries(input.attributes ?? {})) {
      const col = safeIdent(this.map.fields?.[logical]);
      if (col) p.set(col, `eq.${String(value).replace(/[,()]/g, "")}`);
    }
    return (await this.rest.query(table, p)).map((r) => this.toProduct(r));
  }

  async getProduct(id: string | number): Promise<Product | null> {
    const table = safeIdent(this.map.table);
    if (!table) return null;
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
