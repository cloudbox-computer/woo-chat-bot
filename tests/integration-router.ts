import { createIntegrationRouter, toolSupported } from "../supabase/functions/_shared/integrations/router.ts";
import type { Tenant } from "../supabase/functions/_shared/types.ts";

function tenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: "t_test",
    slug: "test",
    name: "Test Business",
    currency: "GBP",
    welcomeMessage: "Hello",
    ...overrides,
  };
}

function assert(name: string, ok: boolean) {
  if (!ok) throw new Error(`FAIL ${name}`);
  console.log(`PASS ${name}`);
}

{
  const r = createIntegrationRouter(tenant());
  assert("unconnected tenant has no catalogue", !r.has("catalogue.read"));
  assert("unconnected tenant cannot expose search_products", !toolSupported(r, "search_products"));
  assert("platform knowledge capability remains available", toolSupported(r, "search_knowledge"));
}

{
  const r = createIntegrationRouter(tenant({
    wooUrl: "https://example.com",
    wooKey: "ck_test",
    wooSecret: "cs_test",
  }));
  assert("WooCommerce adapter advertises generic catalogue capability", r.has("catalogue.read"));
  assert("WooCommerce adapter advertises generic order capability", r.has("orders.read"));
  assert("provider-neutral product tool is enabled", toolSupported(r, "search_products"));
  assert("provider-neutral order tool is enabled", toolSupported(r, "track_order"));
}

{
  const r = createIntegrationRouter(tenant({
    supabaseUrl: "https://example.supabase.co",
    supabaseAnonKey: "anon-test",
    supabaseCapabilityConfig: {
      catalogue: { table: "products", fields: { id: "id", name: "title", price: "price" } },
      orders: { table: "orders", identityColumn: "email" },
    },
    supabaseQueryPolicy: {
      tables: {
        bookings: {
          table: "customer_bookings",
          columns: ["id", "email", "date", "status"],
          identityColumn: "email",
          orderColumns: ["date"],
        },
      },
    },
  }));
  assert("Supabase can implement generic catalogue capability", r.has("catalogue.read"));
  assert("Supabase can implement generic order capability", r.has("orders.read"));
  assert("Supabase customer resources expose generic business-data capability", r.has("business_data.read"));
  assert("AI sees search_business_data, not provider-specific database tool", toolSupported(r, "search_business_data"));
}

console.log("Integration router tests passed.");
