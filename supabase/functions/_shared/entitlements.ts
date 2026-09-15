import { DashboardError } from "./dashboard.ts";
import type { Tenant } from "./types.ts";

export type PaidPlanKey = "starter" | "growth" | "scale";
export type PlanFeature =
  | "liveIntegrations"
  | "businessData"
  | "customerSafeActions"
  | "restrictedActionPermissions"
  | "customActions"
  | "team"
  | "humanTakeover"
  | "auditLog"
  | "operations"
  | "enterpriseControls"
  | "advancedPermissions"
  | "fullAnalytics"
  | "workflows"
  | "richChatExperiences"
  | "contacts"
  | "testing"
  | "channels"
  | "improvements";

export interface PlanEntitlements {
  plan: PaidPlanKey | "legacy" | "unsubscribed";
  legacy: boolean;
  subscriptionActive: boolean;
  liveIntegrations: boolean;
  businessData: boolean;
  customerSafeActions: boolean;
  restrictedActionPermissions: boolean;
  customActions: boolean;
  team: boolean;
  humanTakeover: boolean;
  auditLog: boolean;
  operations: boolean;
  enterpriseControls: boolean;
  advancedPermissions: boolean;
  fullAnalytics: boolean;
  workflows: boolean;
  richChatExperiences: boolean;
  contacts: boolean;
  testing: boolean;
  channels: boolean;
  improvements: boolean;
  maxAssistants: number;
  minimumUpgradeFor: Partial<Record<PlanFeature, PaidPlanKey>>;
}

const MINIMUM_PLAN: Record<PlanFeature, PaidPlanKey> = {
  liveIntegrations: "growth",
  businessData: "growth",
  customerSafeActions: "growth",
  restrictedActionPermissions: "growth",
  customActions: "scale",
  team: "growth",
  humanTakeover: "growth",
  fullAnalytics: "growth",
  workflows: "growth",
  richChatExperiences: "growth",
  contacts: "growth",
  testing: "growth",
  channels: "growth",
  improvements: "growth",
  auditLog: "scale",
  operations: "scale",
  enterpriseControls: "scale",
  advancedPermissions: "scale",
};

const PLAN_RANK: Record<PaidPlanKey, number> = { starter: 0, growth: 1, scale: 2 };
const MAX_ASSISTANTS: Record<PaidPlanKey, number> = { starter: 1, growth: 3, scale: 10 };

export function normalisePaidPlan(value: unknown): PaidPlanKey | null {
  const plan = String(value ?? "").toLowerCase();
  return plan === "starter" || plan === "growth" || plan === "scale" ? plan : null;
}

export function planAllows(plan: PaidPlanKey, feature: PlanFeature): boolean {
  return PLAN_RANK[plan] >= PLAN_RANK[MINIMUM_PLAN[feature]];
}

export function entitlementsForTenant(tenant: Pick<Tenant, "plan" | "billingEnforced" | "subscriptionStatus" | "maxAssistants">): PlanEntitlements {
  // Existing pre-billing tenants retain all capabilities so this migration never
  // breaks live customers. Every Stripe-managed tenant is gated by its paid plan.
  if (tenant.billingEnforced !== true) {
    return {
      plan: "legacy",
      legacy: true,
      subscriptionActive: true,
      liveIntegrations: true,
      businessData: true,
      customerSafeActions: true,
      restrictedActionPermissions: true,
      customActions: true,
      team: true,
      humanTakeover: true,
      auditLog: true,
      operations: true,
      enterpriseControls: true,
      advancedPermissions: true,
      fullAnalytics: true,
      workflows: true,
      richChatExperiences: true,
      contacts: true,
      testing: true,
      channels: true,
      improvements: true,
      maxAssistants: Math.max(1, Number(tenant.maxAssistants ?? 10) || 10),
      minimumUpgradeFor: { ...MINIMUM_PLAN },
    };
  }

  const plan = normalisePaidPlan(tenant.plan);
  if (!plan) {
    // Fail closed for a billing-managed tenant whose Stripe plan has not yet
    // been resolved. Core/billing pages still work; premium capabilities do not.
    return {
      plan: "unsubscribed",
      legacy: false,
      subscriptionActive: false,
      liveIntegrations: false,
      businessData: false,
      customerSafeActions: false,
      restrictedActionPermissions: false,
      customActions: false,
      team: false,
      humanTakeover: false,
      auditLog: false,
      operations: false,
      enterpriseControls: false,
      advancedPermissions: false,
      fullAnalytics: false,
      workflows: false,
      richChatExperiences: false,
      contacts: false,
      testing: false,
      channels: false,
      improvements: false,
      maxAssistants: 1,
      minimumUpgradeFor: { ...MINIMUM_PLAN },
    };
  }

  const subscriptionActive = ["active", "trialing"].includes(String(tenant.subscriptionStatus ?? "").toLowerCase());
  return {
    plan,
    legacy: false,
    subscriptionActive,
    liveIntegrations: subscriptionActive && planAllows(plan, "liveIntegrations"),
    businessData: subscriptionActive && planAllows(plan, "businessData"),
    customerSafeActions: subscriptionActive && planAllows(plan, "customerSafeActions"),
    restrictedActionPermissions: subscriptionActive && planAllows(plan, "restrictedActionPermissions"),
    customActions: subscriptionActive && planAllows(plan, "customActions"),
    team: subscriptionActive && planAllows(plan, "team"),
    humanTakeover: subscriptionActive && planAllows(plan, "humanTakeover"),
    auditLog: subscriptionActive && planAllows(plan, "auditLog"),
    operations: subscriptionActive && planAllows(plan, "operations"),
    enterpriseControls: subscriptionActive && planAllows(plan, "enterpriseControls"),
    advancedPermissions: subscriptionActive && planAllows(plan, "advancedPermissions"),
    fullAnalytics: subscriptionActive && planAllows(plan, "fullAnalytics"),
    workflows: subscriptionActive && planAllows(plan, "workflows"),
    richChatExperiences: subscriptionActive && planAllows(plan, "richChatExperiences"),
    contacts: subscriptionActive && planAllows(plan, "contacts"),
    testing: subscriptionActive && planAllows(plan, "testing"),
    channels: subscriptionActive && planAllows(plan, "channels"),
    improvements: subscriptionActive && planAllows(plan, "improvements"),
    // Never trust a stale/raised tenant column to grant more assistants than the Stripe plan.
    maxAssistants: Math.min(MAX_ASSISTANTS[plan], Math.max(1, Number(tenant.maxAssistants ?? MAX_ASSISTANTS[plan]) || MAX_ASSISTANTS[plan])),
    minimumUpgradeFor: { ...MINIMUM_PLAN },
  };
}

export function requirePlanFeature(
  tenant: Pick<Tenant, "plan" | "billingEnforced" | "subscriptionStatus" | "maxAssistants">,
  feature: PlanFeature,
): void {
  const entitlements = entitlementsForTenant(tenant);
  if (entitlements[feature] === true) return;
  if (tenant.billingEnforced === true && !entitlements.subscriptionActive) {
    throw new DashboardError(
      "An active subscription or trial is required for this feature. Open Billing to continue.",
      402,
      "SUBSCRIPTION_REQUIRED",
    );
  }
  const required = MINIMUM_PLAN[feature];
  const label = required.charAt(0).toUpperCase() + required.slice(1);
  throw new DashboardError(
    `This feature requires the ${label} plan. Upgrade your workspace to continue.`,
    403,
    "PLAN_UPGRADE_REQUIRED",
  );
}

export function planFeatureLabel(feature: PlanFeature): string {
  const names: Record<PlanFeature, string> = {
    liveIntegrations: "Live integrations",
    businessData: "Business-data tools",
    customerSafeActions: "Customer-safe actions",
    restrictedActionPermissions: "Per-assistant restricted action permissions",
    customActions: "Custom actions",
    team: "Team access",
    humanTakeover: "Human takeover",
    auditLog: "Audit log",
    operations: "Operations",
    enterpriseControls: "Enterprise controls",
    advancedPermissions: "Advanced permissions",
    fullAnalytics: "Full analytics",
    workflows: "Workflows",
    richChatExperiences: "Rich chat experiences",
    contacts: "Customer contacts",
    testing: "Assistant testing",
    channels: "Omnichannel deployment",
    improvements: "AI improvement suggestions",
  };
  return names[feature];
}
