import type { CartItem, InventoryItem, Order, Product, ProductVariant, Tenant } from "../types.ts";
import type { CatalogueProvider, CheckoutProvider, OrdersProvider, ProductSearchInput, ReportingProvider } from "./types.ts";

type GqlResponse<T> = { data?: T; errors?: Array<{ message?: string }> };

function gid(kind: "Product" | "ProductVariant", value: string | number): string {
  const raw = String(value);
  return raw.startsWith("gid://") ? raw : `gid://shopify/${kind}/${raw.replace(/\D/g, "")}`;
}
function numericId(value: unknown): string {
  const raw = String(value ?? "");
  const m = raw.match(/\/(\d+)$/);
  return m?.[1] ?? raw;
}
function money(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}
function orderStatus(row: any): string {
  const fulfil = String(row?.displayFulfillmentStatus ?? "").toLowerCase().replace(/_/g, "-");
  const financial = String(row?.displayFinancialStatus ?? "").toLowerCase().replace(/_/g, "-");
  if (fulfil && fulfil !== "unfulfilled") return fulfil;
  return financial || "unknown";
}

export class ShopifyClient implements CatalogueProvider, OrdersProvider, CheckoutProvider, ReportingProvider {
  readonly providerId = "shopify";
  private readonly domain: string;
  private readonly adminToken: string;
  private readonly adminVersion: string;
  private readonly storefrontToken?: string;
  private readonly storefrontVersion: string;
  private readonly currency: string;

  constructor(private readonly tenant: Tenant) {
    this.domain = String(tenant.shopifyDomain ?? "").replace(/^https?:\/\//i, "").replace(/\/$/, "");
    this.adminToken = String(tenant.shopifyAdminToken ?? "");
    this.adminVersion = String(tenant.shopifyApiVersion ?? "2026-07");
    this.storefrontToken = tenant.shopifyStorefrontToken || undefined;
    this.storefrontVersion = String(tenant.shopifyStorefrontApiVersion ?? this.adminVersion);
    this.currency = tenant.currency || "GBP";
  }

  hasCheckout(): boolean { return Boolean(this.storefrontToken); }

  private async admin<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
      const r = await fetch(`https://${this.domain}/admin/api/${this.adminVersion}/graphql.json`, {
        method: "POST",
        headers: { "X-Shopify-Access-Token": this.adminToken, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query, variables }),
        signal: ctrl.signal,
      });
      const payload = await r.json().catch(() => ({})) as GqlResponse<T>;
      if (!r.ok || payload.errors?.length) throw new Error(`Shopify Admin API ${r.status}: ${payload.errors?.[0]?.message ?? "request failed"}`);
      if (!payload.data) throw new Error("Shopify Admin API returned no data");
      return payload.data;
    } finally { clearTimeout(timer); }
  }

  private async storefront<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    if (!this.storefrontToken) throw new Error("Shopify Storefront API token is not configured");
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
      const r = await fetch(`https://${this.domain}/api/${this.storefrontVersion}/graphql.json`, {
        method: "POST",
        headers: { "X-Shopify-Storefront-Access-Token": this.storefrontToken, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query, variables }),
        signal: ctrl.signal,
      });
      const payload = await r.json().catch(() => ({})) as GqlResponse<T>;
      if (!r.ok || payload.errors?.length) throw new Error(`Shopify Storefront API ${r.status}: ${payload.errors?.[0]?.message ?? "request failed"}`);
      if (!payload.data) throw new Error("Shopify Storefront API returned no data");
      return payload.data;
    } finally { clearTimeout(timer); }
  }

  private toProduct(node: any): Product {
    const variants = (node?.variants?.nodes ?? []).map((v: any): ProductVariant => ({
      id: numericId(v.id),
      name: String(v.title ?? "Variant"),
      price: money(v.price),
      inStock: v.availableForSale !== false && Number(v.inventoryQuantity ?? 0) !== 0,
      attributes: Object.fromEntries((v.selectedOptions ?? []).map((o: any) => [String(o.name ?? "option").toLowerCase().replace(/\s+/g, "_"), String(o.value ?? "")])),
    }));
    const first = variants[0];
    const quantities = (node?.variants?.nodes ?? []).map((v: any) => Number(v.inventoryQuantity ?? 0)).filter(Number.isFinite);
    return {
      id: numericId(node?.id),
      name: String(node?.title ?? "Product"),
      price: first?.price ?? money(node?.priceRangeV2?.minVariantPrice?.amount),
      currency: String(node?.priceRangeV2?.minVariantPrice?.currencyCode ?? this.currency),
      description: String(node?.description ?? ""),
      category: String(node?.productType ?? "") || undefined,
      url: node?.onlineStoreUrl ? String(node.onlineStoreUrl) : `https://${this.domain}/products/${node?.handle ?? ""}`,
      imageUrl: node?.featuredMedia?.preview?.image?.url ? String(node.featuredMedia.preview.image.url) : node?.featuredImage?.url ? String(node.featuredImage.url) : undefined,
      inStock: variants.length ? variants.some((v: ProductVariant) => v.inStock) : undefined,
      stockQuantity: quantities.length ? quantities.reduce((a: number, b: number) => a + Math.max(0, b), 0) : undefined,
      variants,
    };
  }

  private productFields(): string { return `
    id title handle description productType onlineStoreUrl
    priceRangeV2 { minVariantPrice { amount currencyCode } }
    featuredMedia { preview { image { url } } }
    variants(first: 50) { nodes { id title price inventoryQuantity availableForSale selectedOptions { name value } } }
  `; }

  async searchProducts(input: ProductSearchInput): Promise<Product[]> {
    const terms: string[] = [];
    if (input.query?.trim()) terms.push(input.query.trim());
    if (input.category?.trim()) terms.push(`product_type:'${input.category.replace(/'/g, "\\'")}'`);
    const data = await this.admin<any>(`query SearchProducts($q:String!){ products(first:25, query:$q, sortKey:RELEVANCE){ nodes { ${this.productFields()} } } }`, { q: terms.join(" ") });
    return (data.products?.nodes ?? []).map((n: any) => this.toProduct(n)).filter((p: Product) => {
      if (input.minPrice != null && p.price < input.minPrice) return false;
      if (input.maxPrice != null && p.price > input.maxPrice) return false;
      if (input.attributes && Object.keys(input.attributes).length) {
        const hay = JSON.stringify(p.variants ?? []).toLowerCase();
        if (!Object.values(input.attributes).every(v => hay.includes(String(v).toLowerCase()))) return false;
      }
      return true;
    }).slice(0, 10);
  }

  async getProduct(id: string | number): Promise<Product | null> {
    try {
      const data = await this.admin<any>(`query Product($id:ID!){ product(id:$id){ ${this.productFields()} } }`, { id: gid("Product", id) });
      return data.product ? this.toProduct(data.product) : null;
    } catch { return null; }
  }

  async getVariants(productId: string | number): Promise<ProductVariant[]> {
    return (await this.getProduct(productId))?.variants ?? [];
  }

  async listProducts(): Promise<Product[]> {
    const out: Product[] = []; let cursor: string | null = null;
    for (let page = 0; page < 5 && out.length < 250; page++) {
      const data = await this.admin<any>(`query Products($after:String){ products(first:50, after:$after){ nodes { ${this.productFields()} } pageInfo { hasNextPage endCursor } } }`, { after: cursor });
      out.push(...(data.products?.nodes ?? []).map((n: any) => this.toProduct(n)));
      if (!data.products?.pageInfo?.hasNextPage) break;
      cursor = data.products.pageInfo.endCursor ?? null;
    }
    return out;
  }

  async trackOrder(input: { orderId?: string; email?: string }): Promise<Order[]> {
    const email = String(input.email ?? "").trim().toLowerCase();
    if (!email) return [];
    const q: string[] = [`email:${email}`];
    if (input.orderId?.trim()) {
      const raw = input.orderId.trim().replace(/^#/, "");
      q.push(/^\d+$/.test(raw) ? `name:#${raw}` : `name:${raw}`);
    }
    const data = await this.admin<any>(`query Orders($q:String!){ orders(first:10, query:$q, sortKey:CREATED_AT, reverse:true){ nodes { id name email createdAt displayFinancialStatus displayFulfillmentStatus totalPriceSet { shopMoney { amount currencyCode } } lineItems(first:100){ nodes { name quantity } } } } }`, { q: q.join(" AND ") });
    return (data.orders?.nodes ?? []).filter((o: any) => String(o.email ?? "").trim().toLowerCase() === email).map((o: any): Order => ({
      id: String(o.name ?? numericId(o.id)).replace(/^#/, ""),
      customerEmail: String(o.email ?? ""),
      status: orderStatus(o),
      total: money(o.totalPriceSet?.shopMoney?.amount),
      currency: String(o.totalPriceSet?.shopMoney?.currencyCode ?? this.currency),
      items: (o.lineItems?.nodes ?? []).map((x: any) => ({ name: String(x.name ?? "Item"), qty: Number(x.quantity ?? 1) })),
      date: String(o.createdAt ?? ""),
    }));
  }

  async inventory(): Promise<InventoryItem[]> {
    const products = await this.listProducts();
    return products.map((p): InventoryItem => ({ productId: p.id, name: p.name, stockQuantity: p.stockQuantity, inStock: p.inStock !== false, category: p.category }));
  }

  private async defaultVariantId(productId: string | number): Promise<string | null> {
    const data = await this.admin<any>(`query FirstVariant($id:ID!){ product(id:$id){ variants(first:1){ nodes { id } } } }`, { id: gid("Product", productId) });
    return data.product?.variants?.nodes?.[0]?.id ? String(data.product.variants.nodes[0].id) : null;
  }

  async buildCheckoutUrl(items: CartItem[], email?: string): Promise<string> {
    if (!this.storefrontToken) throw new Error("Shopify checkout requires a Storefront API token");
    const lines: Array<{ merchandiseId: string; quantity: number }> = [];
    for (const item of items) {
      const merchandiseId = item.variantId ? gid("ProductVariant", item.variantId) : await this.defaultVariantId(item.productId);
      if (!merchandiseId) throw new Error(`No purchasable variant found for ${item.productName}`);
      lines.push({ merchandiseId, quantity: Math.max(1, Math.min(99, Number(item.quantity || 1))) });
    }
    const data = await this.storefront<any>(`mutation CartCreate($input:CartInput!){ cartCreate(input:$input){ cart { checkoutUrl } userErrors { field message } } }`, { input: { lines, buyerIdentity: email ? { email } : undefined } });
    const errors = data.cartCreate?.userErrors ?? [];
    if (errors.length) throw new Error(String(errors[0].message ?? "Shopify cart could not be created"));
    const url = String(data.cartCreate?.cart?.checkoutUrl ?? "");
    if (!/^https:\/\//i.test(url)) throw new Error("Shopify did not return a checkout URL");
    return url;
  }
}
