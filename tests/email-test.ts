// Verify the deployed sendTicketEmail path against real Resend.
// Run:  $env:RESEND_API_KEY="re_..."; $env:RESEND_FROM="onboarding@resend.dev"; node_modules\.bin\deno.exe run --allow-all tests/email-test.ts
import { sendTicketEmail } from "../supabase/functions/_shared/email.ts";
import { IVY_PEARLS_TENANT } from "../supabase/functions/_shared/mock-data.ts";

// Match the production DB state: ivy-pearls support_email is the user's Gmail.
const tenant = { ...IVY_PEARLS_TENANT, supportEmail: "saqjewelleryshop@gmail.com" };

const ticket = {
  id: crypto.randomUUID(),
  tenantId: tenant.id,
  reference: "IP-2026-000002",
  customerName: "Test Customer",
  customerEmail: "saqjewelleryshop@gmail.com",
  subject: "Email test ticket",
  description: "Testing that ticket emails are delivered to the support inbox.",
  category: "damaged_item",
  priority: "normal",
  status: "open",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const result = await sendTicketEmail(tenant, ticket);
console.log(JSON.stringify(result, null, 2));
Deno.exit(result.sent ? 0 : 1);
