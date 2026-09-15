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
  table?: string;
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
  // Never coerce missing/blank database values to zero. Number("") and
  // Number(null) are 0 in JavaScript, which previously made an unmapped
  // catalogue price appear to customers as a genuine £0.00 product.
  if (v === null || v === undefined) return undefined;
  if (typeof v === "string" && !v.trim()) return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function money(v: unknown, column?: string): number | undefined {
  const n = num(v);
  if (n === undefined) return undefined;
  const c = (column ?? "").toLowerCase();
  // Common commerce schemas persist money as integer minor units. Infer this
  // semantically from the discovered column rather than hard-coding a table.
  if (/(?:_minor|_cents|_pence|minor_units|minor_amount)$/.test(c)) return n / 100;
  return n;
}

function bool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (v === "true" || v === "1" || v === 1) return true;
  if (v === "false" || v === "0" || v === 0) return false;
  return undefined;
}

function imageUrl(v: unknown): string | undefined {
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (!trimmed) return undefined;
    // Some catalogues store image arrays/objects as JSON strings.
    if ((trimmed.startsWith("[") && trimmed.endsWith("]")) || (trimmed.startsWith("{") && trimmed.endsWith("}"))) {
      try { return imageUrl(JSON.parse(trimmed)); } catch { /* use as a normal string below */ }
    }
    return /^https?:\/\//i.test(trimmed) ? trimmed : undefined;
  }
  if (Array.isArray(v)) {
    for (const item of v) {
      const found = imageUrl(item);
      if (found) return found;
    }
    return undefined;
  }
  if (v && typeof v === "object") {
    const row = v as Record<string, unknown>;
    for (const key of ["url", "src", "publicUrl", "public_url", "imageUrl", "image_url", "thumbnail", "thumbnail_url"]) {
      const found = imageUrl(row[key]);
      if (found) return found;
    }
    for (const key of ["image", "images", "media", "gallery", "data"]) {
      const found = imageUrl(row[key]);
      if (found) return found;
    }
  }
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

  async schema(): Promise<Record<string, string[]>> {
    const res = await fetch(`${this.url.replace(/\/$/, "")}/rest/v1/`, {
      headers: { apikey: this.anonKey, Authorization: `Bearer ${this.anonKey}`, Accept: "application/openapi+json" },
    });
    if (!res.ok) throw new Error(`Connected schema discovery returned ${res.status}`);
    const doc = await res.json() as Record<string, unknown>;
    const defs = ((doc.definitions ?? (doc.components as any)?.schemas) ?? {}) as Record<string, any>;
    const out: Record<string, string[]> = {};
    for (const [name, def] of Object.entries(defs)) {
      if (!safeIdent(name) || !def || typeof def !== "object") continue;
      const props = def.properties && typeof def.properties === "object" ? Object.keys(def.properties) : [];
      if (props.length) out[name] = props.filter((x) => !!safeIdent(x));
    }
    return out;
  }

}

export class SupabaseCatalogueProvider implements CatalogueProvider {
  readonly providerId = "supabase";
  private rest: SupabaseRest;
  private resolved?: Promise<{ product: ResourceMap; variant?: ResourceMap }>;

  constructor(private tenant: Tenant, private map: ResourceMap) {
    if (!tenant.supabaseUrl || !tenant.supabaseAnonKey) throw new Error("Supabase connection is incomplete");
    this.rest = new SupabaseRest(tenant.supabaseUrl, tenant.supabaseAnonKey);
  }

  private scoreTable(name: string, cols: string[]): number {
    const n = name.toLowerCase(); const c = new Set(cols.map((x) => x.toLowerCase())); let score = 0;
    if (/product|catalog|item|merch/.test(n)) score += 7;
    if (/variant|sku|option/.test(n)) score -= 4;
    if (["name","title","product_name"].some((x) => c.has(x))) score += 5;
    if (["description","short_description","summary"].some((x) => c.has(x))) score += 2;
    if (["image_url","image","images","featured_image"].some((x) => c.has(x))) score += 2;
    if (["price","sale_price","selling_price","retail_price","unit_price"].some((x) => c.has(x))) score += 1;
    return score;
  }

  private inferField(cols: string[], logical: string): string | undefined {
    const aliases: Record<string,string[]> = {
      id:["id","product_id","item_id","sku"], name:["name","title","product_name","item_name"],
      description:["description","short_description","summary","details"], category:["category","category_name","type","collection"],
      url:["url","permalink","product_url","link","slug"], image_url:["image_url","image","images","image_urls","featured_image","thumbnail","media"],
      price:["price","sale_price","selling_price","retail_price","unit_price","amount","price_minor","sale_price_minor","selling_price_minor","retail_price_minor","unit_price_minor","amount_minor","price_cents","price_pence"], currency:["currency","currency_code"],
      in_stock:["in_stock","available","is_available","active","stock_status"], stock_quantity:["stock_quantity","stock","quantity","inventory_quantity","qty"],
      product_fk:["product_id","item_id","parent_id","catalogue_id","catalog_id"], sku:["sku","variant_sku"],
      variant_name:["name","title","variant_name","option_name"], size:["size","ring_size"], colour:["colour","color"],
    };
    const lower = new Map(cols.map((x)=>[x.toLowerCase(),x]));
    for (const a of aliases[logical] ?? []) if (lower.has(a)) return lower.get(a);
    return undefined;
  }

  private async resolve(): Promise<{ product: ResourceMap; variant?: ResourceMap }> {
    if (this.resolved) return this.resolved;
    this.resolved = (async () => {
      if (safeIdent(this.map.table) && this.map.fields && Object.keys(this.map.fields).length) return { product: this.map };
      let schema: Record<string,string[]> = {};
      try { schema = await this.rest.schema(); } catch { /* conventional fallback below */ }
      const configured = safeIdent(this.map.table);
      const productTable = configured && schema[configured] ? configured
        : Object.entries(schema).sort((a,b)=>this.scoreTable(b[0],b[1])-this.scoreTable(a[0],a[1]))[0]?.[0]
          ?? configured ?? "products";
      const productCols = schema[productTable] ?? [];
      const fields: FieldMap = { ...(this.map.fields ?? {}) };
      for (const logical of ["id","name","description","category","url","image_url","price","currency","in_stock","stock_quantity"]) {
        const found = this.inferField(productCols, logical); if (!fields[logical] && found) fields[logical] = found;
      }
      const product: ResourceMap = { ...this.map, table: productTable, fields };
      const productId = fields.id ?? "id";
      let bestVariant: {score:number,map:ResourceMap}|undefined;
      for (const [table, cols] of Object.entries(schema)) {
        if (table === productTable) continue;
        const price = this.inferField(cols,"price"); const fk = this.inferField(cols,"product_fk");
        if (!price || !fk) continue;
        let score = (/variant|sku|option|price|inventory/.test(table.toLowerCase()) ? 6 : 0) + 5;
        if (this.inferField(cols,"sku")) score += 2; if (this.inferField(cols,"stock_quantity")) score += 2;
        const vf:FieldMap = { product_fk:fk, price };
        for (const logical of ["id","variant_name","sku","currency","in_stock","stock_quantity","size","colour"]) { const found=this.inferField(cols,logical); if(found) vf[logical]=found; }
        if (!bestVariant || score > bestVariant.score) bestVariant={score,map:{table,fields:vf,identityColumn:productId,maxRows:250}};
      }
      return { product, variant: bestVariant?.map };
    })();
    return this.resolved;
  }

  private pick(row: Record<string, unknown>, map: ResourceMap, logical: string, fallbacks: string[]): unknown {
    const explicit = safeIdent(map.fields?.[logical]);
    if (explicit && Object.prototype.hasOwnProperty.call(row, explicit)) return row[explicit];
    for (const key of fallbacks) if (Object.prototype.hasOwnProperty.call(row,key) && row[key] != null) return row[key];
    return undefined;
  }

  private baseProduct(row: Record<string,unknown>, map: ResourceMap): Product {
    const rawPrice=this.pick(row,map,"price",["price","sale_price","selling_price","retail_price","unit_price","amount","price_minor","sale_price_minor","selling_price_minor","retail_price_minor","unit_price_minor","amount_minor","price_cents","price_pence"]); const parsed=money(rawPrice, safeIdent(map.fields?.price));
    const rawStock=this.pick(row,map,"in_stock",["in_stock","available","is_available","active","stock_status"]); let inStock=bool(rawStock);
    if(inStock===undefined && typeof rawStock==="string"){const v=rawStock.toLowerCase();if(["instock","in_stock","available","active"].includes(v))inStock=true;if(["outofstock","out_of_stock","unavailable","inactive"].includes(v))inStock=false;}
    return {
      id:(this.pick(row,map,"id",["id","product_id","item_id","sku"]) as string|number)??"",
      name:str(this.pick(row,map,"name",["name","title","product_name","item_name"]))??"Unnamed product",
      price:parsed ?? 0, priceAvailable: parsed !== undefined,
      currency:str(this.pick(row,map,"currency",["currency","currency_code"]))??this.tenant.currency,
      description:str(this.pick(row,map,"description",["description","short_description","summary","details"])),
      category:str(this.pick(row,map,"category",["category","category_name","type","collection"])),
      url:str(this.pick(row,map,"url",["url","permalink","product_url","link"])),
      imageUrl:imageUrl(this.pick(row,map,"image_url",["image_url","image","images","featured_image","thumbnail","media"])),
      inStock, stockQuantity:num(this.pick(row,map,"stock_quantity",["stock_quantity","stock","quantity","inventory_quantity","qty"])),
    };
  }

  private async variants(productId:string|number, map:ResourceMap):Promise<ProductVariant[]> {
    const table=safeIdent(map.table), fk=safeIdent(map.fields?.product_fk); if(!table||!fk)return[];
    const p=new URLSearchParams({select:"*",limit:String(Math.min(map.maxRows??100,250))}); p.set(fk,`eq.${String(productId).replace(/[,()]/g,"")}`);
    const rows=await this.rest.query(table,p); return rows.map((r,i)=>{
      const price=money(this.pick(r,map,"price",["price","sale_price","selling_price","retail_price","unit_price","amount","price_minor","sale_price_minor","selling_price_minor","retail_price_minor","unit_price_minor","amount_minor","price_cents","price_pence"]), safeIdent(map.fields?.price));
      const qty=num(this.pick(r,map,"stock_quantity",["stock_quantity","stock","quantity","inventory_quantity","qty"]));
      const rawStock=this.pick(r,map,"in_stock",["in_stock","available","is_available","stock_status"]); let inStock=bool(rawStock); if(inStock===undefined&&qty!==undefined)inStock=qty>0; if(inStock===undefined)inStock=true;
      const attrs:Record<string,string>={}; for(const logical of ["size","colour"]){const v=this.pick(r,map,logical,[logical,logical==="colour"?"color":"ring_size"]);if(v!=null)attrs[logical]=String(v);}
      const id=this.pick(r,map,"id",["id","variant_id","sku"]); const name=this.pick(r,map,"variant_name",["name","title","variant_name"]);
      return {id:String(id??`${productId}:${i}`),name:str(name) ?? (Object.values(attrs).join(" / ") || `Option ${i+1}`),price,inStock,attributes:Object.keys(attrs).length?attrs:undefined};
    });
  }

  private async hydrate(row:Record<string,unknown>, resolved:{product:ResourceMap;variant?:ResourceMap}):Promise<Product>{
    const p=this.baseProduct(row,resolved.product); if(resolved.variant){const vs=await this.variants(p.id,resolved.variant);p.variants=vs;if(vs.length){const prices=vs.map(v=>v.price).filter((x):x is number=>x!==undefined&&Number.isFinite(x));if(prices.length){p.price=Math.min(...prices);p.priceMax=Math.max(...prices);p.priceAvailable=true;}if(p.inStock===undefined)p.inStock=vs.some(v=>v.inStock);}} return p;
  }

  private matches(p:Product,input:ProductSearchInput):boolean{
    if(input.query){const q=input.query.toLowerCase().trim();const hay=`${p.name} ${p.description??""} ${p.category??""}`.toLowerCase();if(q&&!q.split(/\s+/).filter(Boolean).every(w=>hay.includes(w)))return false;}
    if(input.minPrice!==undefined && (!p.priceAvailable || p.price<input.minPrice))return false;
    if(input.maxPrice!==undefined && (!p.priceAvailable || p.price>input.maxPrice))return false;
    if(input.category && !(p.category??p.name).toLowerCase().includes(input.category.toLowerCase()))return false; return true;
  }

  async searchProducts(input:ProductSearchInput):Promise<Product[]>{
    const r=await this.resolve(); const table=safeIdent(r.product.table); if(!table)throw new Error("Catalogue discovery could not identify a product source");
    const q=new URLSearchParams({select:"*",limit:String(Math.min(Math.max(1,r.product.maxRows??100),250))});
    const rows=await this.rest.query(table,q); const out:Product[]=[]; for(const row of rows){const p=await this.hydrate(row,r);if(p.id!==""&&p.name!=="Unnamed product"&&this.matches(p,input))out.push(p);} return out;
  }
  async getProduct(id:string|number):Promise<Product|null>{const r=await this.resolve();const table=safeIdent(r.product.table);if(!table)return null;const idCol=safeIdent(r.product.fields?.id)??"id";const q=new URLSearchParams({select:"*",limit:"1"});q.set(idCol,`eq.${String(id).replace(/[,()]/g,"")}`);const rows=await this.rest.query(table,q);return rows[0]?this.hydrate(rows[0],r):null;}
  async getVariants(productId:string|number):Promise<ProductVariant[]>{const r=await this.resolve();return r.variant?this.variants(productId,r.variant):[];}
  async listProducts():Promise<Product[]>{return this.searchProducts({});}
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
