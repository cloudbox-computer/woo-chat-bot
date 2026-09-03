import type { Tenant } from "../types.ts";
import { WooCommerceClient } from "../woo.ts";
import { SupabaseBusinessDataProvider, SupabaseCatalogueProvider, SupabaseOrdersProvider, type SupabaseCapabilityConfig } from "./supabase.ts";
import type { Capability, CapabilityRegistry, IntegrationRouter } from "./types.ts";
import { CapabilityUnavailableError } from "./types.ts";

class Router implements IntegrationRouter {
  constructor(public readonly tenant: Tenant, public readonly registry: CapabilityRegistry) {}
  has(capability: Capability): boolean { return this.registry.capabilities.has(capability); }
  requireCatalogue() {
    if (!this.registry.catalogue) throw new CapabilityUnavailableError("catalogue.read");
    return this.registry.catalogue;
  }
  requireOrders(write = false) {
    if (!this.registry.orders || !this.has(write ? "orders.write" : "orders.read")) throw new CapabilityUnavailableError(write ? "orders.write" : "orders.read");
    return this.registry.orders;
  }
  requireCheckout() {
    if (!this.registry.checkout) throw new CapabilityUnavailableError("checkout.create");
    return this.registry.checkout;
  }
  requireReporting(capability: "inventory.read" | "analytics.read") {
    if (!this.registry.reporting || !this.has(capability)) throw new CapabilityUnavailableError(capability);
    return this.registry.reporting;
  }
  requireBusinessData() {
    if (!this.registry.businessData) throw new CapabilityUnavailableError("business_data.read");
    return this.registry.businessData;
  }
}

export function createIntegrationRouter(tenant: Tenant): IntegrationRouter {
  const capabilities = new Set<Capability>([
    "knowledge.read", "cart.read", "cart.write", "support.read", "support.write",
  ]);
  if (tenant.storeUrl || tenant.wooUrl) capabilities.add("website.read");
  const registry: CapabilityRegistry = { capabilities };

  // Provider priority is explicit and deterministic. WooCommerce is the native
  // commerce adapter when connected. Supabase may implement the same business
  // capabilities only when a capability mapping is configured.
  if (tenant.wooUrl && tenant.wooKey && tenant.wooSecret) {
    const woo = new WooCommerceClient(tenant);
    registry.catalogue = {
      providerId: "woocommerce",
      searchProducts: (i) => woo.searchProducts(i),
      getProduct: (id) => woo.getProduct(id),
      getVariants: (id) => woo.getVariants(id),
      listProducts: () => woo.listAll(),
    };
    registry.orders = {
      providerId: "woocommerce",
      trackOrder: (i) => woo.trackOrder(i),
      cancelOrder: (i) => woo.cancelOrder(i),
      modifyOrder: (i) => woo.modifyOrder(i),
      refundOrder: (i) => woo.refundOrder(i),
    };
    registry.checkout = { providerId: "woocommerce", buildCheckoutUrl: (items, email) => woo.buildCheckoutUrl(items, email) };
    registry.reporting = {
      providerId: "woocommerce",
      salesSummary: (i) => woo.salesSummary(i),
      inventory: () => woo.inventory(),
      analytics: (i) => woo.analytics(i),
    };
    ["catalogue.read", "orders.read", "orders.write", "checkout.create", "inventory.read", "analytics.read"].forEach((c) => capabilities.add(c as Capability));
  }

  if (tenant.supabaseUrl && tenant.supabaseAnonKey) {
    if (tenant.supabaseQueryPolicy?.tables && Object.keys(tenant.supabaseQueryPolicy.tables).length) {
      registry.businessData = new SupabaseBusinessDataProvider(tenant);
      capabilities.add("business_data.read");
    }
    const config = (tenant.supabaseCapabilityConfig ?? {}) as SupabaseCapabilityConfig;
    // Do not silently guess a tenant schema. A configured mapping makes the
    // provider authoritative for that capability. Existing higher-priority
    // providers remain selected unless the tenant explicitly removes them.
    if (config.catalogue?.table && (!registry.catalogue || config.catalogue.preferred === true)) {
      registry.catalogue = new SupabaseCatalogueProvider(tenant, config.catalogue);
      capabilities.add("catalogue.read");
    }
    if (config.orders?.table && (!registry.orders || config.orders.preferred === true)) {
      registry.orders = new SupabaseOrdersProvider(tenant, config.orders);
      capabilities.add("orders.read");
      // Supabase order mapping is read-only unless a future adapter explicitly
      // implements write methods. Never inherit orders.write from another
      // provider when this read adapter is selected.
      if (config.orders.preferred === true) capabilities.delete("orders.write");
    }
  }

  // Never combine incompatible commerce providers implicitly. A cart built
  // from provider A must not be sent to provider B's checkout using unrelated
  // product identifiers. Tenants can switch the preferred catalogue provider,
  // but checkout is exposed only when it belongs to that same provider.
  if (registry.catalogue && registry.checkout && registry.catalogue.providerId !== registry.checkout.providerId) {
    registry.checkout = undefined;
    capabilities.delete("checkout.create");
  }
  if (registry.catalogue && registry.reporting && registry.catalogue.providerId !== registry.reporting.providerId) {
    capabilities.delete("inventory.read");
  }

  return new Router(tenant, registry);
}

export const TOOL_CAPABILITIES: Record<string, Capability[]> = {
  search_products: ["catalogue.read"],
  get_product: ["catalogue.read"],
  recommend_products: ["catalogue.read"],
  search_knowledge: ["knowledge.read"],
  search_website: ["website.read"],
  track_order: ["orders.read"],
  add_to_cart: ["catalogue.read", "cart.write"],
  view_cart: ["cart.read"],
  create_checkout: ["cart.read", "checkout.create"],
  create_ticket: ["support.write"],
  check_ticket_status: ["support.read"],
  cancel_order: ["orders.write"],
  modify_order: ["orders.write"],
  refund_order: ["orders.write"],
  sales_summary: ["analytics.read"],
  inventory: ["inventory.read"],
  analytics: ["analytics.read"],
  search_business_data: ["business_data.read"],
};

export function toolSupported(router: IntegrationRouter, toolName: string): boolean {
  const required = TOOL_CAPABILITIES[toolName] ?? [];
  return required.every((c) => router.has(c));
}
