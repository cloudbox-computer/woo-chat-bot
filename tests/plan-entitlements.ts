import { entitlementsForTenant, planAllows } from "../supabase/functions/_shared/entitlements.ts";

function assert(name: string, ok: boolean) {
  if (!ok) throw new Error(`FAIL ${name}`);
  console.log(`PASS ${name}`);
}

const starter = entitlementsForTenant({ plan: "starter", billingEnforced: true, subscriptionStatus: "active", maxAssistants: 1 });
assert("Starter has one assistant", starter.maxAssistants === 1);
assert("Starter does not have live integrations", starter.liveIntegrations === false);
assert("Starter does not have team access", starter.team === false);
assert("Starter does not have human takeover", starter.humanTakeover === false);
assert("Starter does not have Scale controls", !starter.auditLog && !starter.operations && !starter.enterpriseControls);

const growth = entitlementsForTenant({ plan: "growth", billingEnforced: true, subscriptionStatus: "active", maxAssistants: 3 });
assert("Growth has live integrations", growth.liveIntegrations === true);
assert("Growth has team access", growth.team === true);
assert("Growth has human takeover and full analytics", growth.humanTakeover && growth.fullAnalytics);
assert("Growth does not have Scale controls", !growth.auditLog && !growth.operations && !growth.enterpriseControls && !growth.advancedPermissions);

const scale = entitlementsForTenant({ plan: "scale", billingEnforced: true, subscriptionStatus: "active", maxAssistants: 10 });
assert("Scale has all premium controls", scale.auditLog && scale.operations && scale.enterpriseControls && scale.advancedPermissions);
assert("Scale has ten assistants", scale.maxAssistants === 10);

const legacy = entitlementsForTenant({ plan: "starter", billingEnforced: false, maxAssistants: 10 });
assert("Legacy tenants retain capabilities", legacy.legacy && legacy.liveIntegrations && legacy.enterpriseControls);

const cancelledScale = entitlementsForTenant({ plan: "scale", billingEnforced: true, subscriptionStatus: "canceled", maxAssistants: 10 });
assert("Canceled subscriptions lose premium features", !cancelledScale.subscriptionActive && !cancelledScale.liveIntegrations && !cancelledScale.enterpriseControls);

assert("Growth is minimum for team", !planAllows("starter", "team") && planAllows("growth", "team"));
assert("Scale is minimum for audit", !planAllows("growth", "auditLog") && planAllows("scale", "auditLog"));

console.log("Plan entitlement tests passed.");
