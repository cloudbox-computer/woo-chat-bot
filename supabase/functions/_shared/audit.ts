import { supabaseConfig } from "./env.ts";
import type { DashboardContext } from "./dashboard.ts";

export async function audit(ctx: DashboardContext, action: string, resourceType: string, resourceId?: string, metadata: Record<string, unknown> = {}): Promise<void> {
  try {
    const { url, serviceRoleKey } = supabaseConfig();
    await fetch(`${url.replace(/\/+$/g, "")}/rest/v1/audit_logs`, {
      method: "POST",
      headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ tenant_id: ctx.tenantId, actor_user_id: ctx.user.id, actor_email: ctx.user.email ?? null, action, resource_type: resourceType, resource_id: resourceId ?? null, metadata }),
    });
  } catch (err) {
    console.error("audit write failed", err);
  }
}
