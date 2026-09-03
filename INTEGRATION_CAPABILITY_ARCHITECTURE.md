# Provider-neutral integration capability architecture

The AI layer never chooses an integration vendor. It sees stable business-capability tools such as `search_products`, `track_order`, `create_checkout`, `search_business_data`, `search_knowledge`, and `create_ticket`.

Every tool call is checked twice before it is exposed or executed:

1. **Chatbot permission** — read/cart/support/sensitive/admin.
2. **Capability availability** — the tenant has a platform or connected integration capable of fulfilling that operation.

The server-side integration router maps capabilities to adapters. Today WooCommerce can provide catalogue, order, checkout, inventory and analytics capabilities. A connected Supabase project can provide customer business-data resources and can also provide catalogue/order capabilities when an explicit mapping is configured. Future Shopify, Xero, HubSpot, Salesforce or custom API adapters implement the same interfaces without changing the AI tool contract.

## No provider leakage

The system prompt explicitly tells the model that tools represent business capabilities, not vendors. Tool names and descriptions do not expose WooCommerce/Supabase-specific operations. `query_supabase_table` has been removed from the model tool surface and replaced by `search_business_data`.

## Fail-closed behaviour

There is no production mock-catalogue fallback. If no authoritative catalogue integration is connected, `search_products`, `get_product` and `recommend_products` are not exposed to the model. The public `/products` endpoint returns a capability-unavailable response rather than demo products.

## Supabase capability mapping

Supabase schemas are not guessed. An owner may configure mappings in Dashboard → Integrations. Example:

```json
{
  "catalogue": {
    "table": "products",
    "fields": {
      "id": "id",
      "name": "title",
      "price": "price",
      "currency": "currency",
      "description": "description",
      "category": "category",
      "url": "url",
      "image_url": "image_url",
      "in_stock": "in_stock",
      "stock_quantity": "stock_quantity"
    }
  },
  "orders": {
    "table": "orders",
    "identityColumn": "customer_email",
    "fields": {
      "id": "id",
      "customer_email": "customer_email",
      "status": "status",
      "total": "total",
      "currency": "currency",
      "items": "items",
      "date": "created_at"
    }
  }
}
```

Customer-specific arbitrary business resources use a separate allowlist policy:

```json
{
  "tables": {
    "bookings": {
      "table": "customer_bookings",
      "columns": ["id", "email", "date", "status"],
      "identityColumn": "email",
      "orderColumns": ["date"],
      "maxRows": 20
    }
  }
}
```

The AI sees only the logical resource key `bookings`; it never receives the physical table name or integration credentials.
