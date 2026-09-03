import type {
  AnalyticsReport,
  CartItem,
  InventoryItem,
  Order,
  OrderPatch,
  Product,
  ProductVariant,
  SalesSummary,
  Tenant,
} from "../types.ts";

export type Capability =
  | "catalogue.read"
  | "orders.read"
  | "orders.write"
  | "checkout.create"
  | "inventory.read"
  | "analytics.read"
  | "business_data.read"
  | "knowledge.read"
  | "website.read"
  | "cart.read"
  | "cart.write"
  | "support.read"
  | "support.write";

export interface ProductSearchInput {
  query?: string;
  maxPrice?: number;
  minPrice?: number;
  category?: string;
  attributes?: Record<string, string>;
}

export interface CatalogueProvider {
  readonly providerId: string;
  searchProducts(input: ProductSearchInput): Promise<Product[]>;
  getProduct(id: string | number): Promise<Product | null>;
  getVariants(productId: string | number): Promise<ProductVariant[]>;
  listProducts(): Promise<Product[]>;
}

export interface OrdersProvider {
  readonly providerId: string;
  trackOrder(input: { orderId?: string; email?: string }): Promise<Order[]>;
  cancelOrder?(input: { orderId: string; email?: string }): Promise<Order | null>;
  modifyOrder?(input: { orderId: string; email?: string; patch: OrderPatch }): Promise<Order | null>;
  refundOrder?(input: { orderId: string; email?: string; reason?: string }): Promise<Order | null>;
}

export interface CheckoutProvider {
  readonly providerId: string;
  buildCheckoutUrl(items: CartItem[], email?: string): Promise<string> | string;
}

export interface ReportingProvider {
  readonly providerId: string;
  salesSummary?(input: { days?: number }): Promise<SalesSummary>;
  inventory?(): Promise<InventoryItem[]>;
  analytics?(input: { days?: number }): Promise<AnalyticsReport>;
}

export interface BusinessDataInput {
  resource: string;
  filters?: Record<string, unknown>;
  fields?: string[];
  orderBy?: string;
  orderDirection?: "asc" | "desc";
  limit?: number;
  customerEmail?: string;
}

export interface BusinessDataResult {
  resource: string;
  fields: string[];
  rows: Record<string, unknown>[];
}

export interface BusinessDataProvider {
  readonly providerId: string;
  query(input: BusinessDataInput): Promise<BusinessDataResult>;
}

export interface CapabilityRegistry {
  capabilities: Set<Capability>;
  catalogue?: CatalogueProvider;
  orders?: OrdersProvider;
  checkout?: CheckoutProvider;
  reporting?: ReportingProvider;
  businessData?: BusinessDataProvider;
}

export class CapabilityUnavailableError extends Error {
  constructor(public readonly capability: Capability) {
    super(`Capability is not configured for this tenant: ${capability}`);
    this.name = "CapabilityUnavailableError";
  }
}

export interface IntegrationRouter {
  readonly tenant: Tenant;
  readonly registry: CapabilityRegistry;
  has(capability: Capability): boolean;
  requireCatalogue(): CatalogueProvider;
  requireOrders(write?: boolean): OrdersProvider;
  requireCheckout(): CheckoutProvider;
  requireReporting(capability: "inventory.read" | "analytics.read"): ReportingProvider;
  requireBusinessData(): BusinessDataProvider;
}
