import React from "react";
import { createBillingCheckout, getBilling, openBillingPortal, type BillingPlanKey, type BillingState, type BillingPlanSummary } from "../lib/api";

function statusLabel(status: string, enforced: boolean) {
  if (!enforced) return "Legacy access";
  if (status === "active") return "Active";
  if (status === "trialing") return "Trial";
  if (status === "past_due") return "Payment overdue";
  if (status === "canceled") return "Cancelled";
  return "Subscription required";
}

export default function BillingPage({ tenantId }: { tenantId: string }) {
  const [billing,setBilling] = React.useState<BillingState|null>(null);
  const [plans,setPlans] = React.useState<BillingPlanSummary[]>([]);
  const [canManage,setCanManage] = React.useState(false);
  const [busy,setBusy] = React.useState<string|null>(null);
  const [error,setError] = React.useState<string|null>(null);
  const [notice,setNotice] = React.useState<string|null>(null);
  const requestedPlan = (()=>{ try { const p=new URLSearchParams(window.location.search).get("plan"); return p==="starter"||p==="growth"||p==="scale" ? p : null; } catch { return null; } })();

  const load = React.useCallback(async()=>{
    try {
      setError(null);
      const data = await getBilling(tenantId);
      setBilling(data.billing); setPlans(data.plans); setCanManage(data.canManage);
    } catch(e) { setError(e instanceof Error ? e.message : "Could not load billing"); }
  },[tenantId]);

  React.useEffect(()=>{ void load(); },[load]);
  React.useEffect(()=>{
    const p = new URLSearchParams(window.location.search);
    if (p.get("billing") === "success") setNotice("Payment completed. Stripe is confirming your subscription; this page will update automatically.");
    if (p.get("billing") === "cancelled") setNotice("Checkout was cancelled. No payment was taken.");
    if (!p.get("billing") && requestedPlan) setNotice(`You selected the ${requestedPlan.charAt(0).toUpperCase()+requestedPlan.slice(1)} plan. Review it below and continue to secure Stripe Checkout.`);
    if (p.get("billing") === "success") {
      const timer = window.setInterval(()=>void load(),2500);
      const stop = window.setTimeout(()=>window.clearInterval(timer),15000);
      return ()=>{window.clearInterval(timer);window.clearTimeout(stop);};
    }
  },[load]);

  async function checkout(plan: BillingPlanKey) {
    try { setBusy(plan); setError(null); const r=await createBillingCheckout(tenantId,plan); window.location.assign(r.url); }
    catch(e){ setError(e instanceof Error?e.message:"Could not start checkout"); setBusy(null); }
  }
  async function portal() {
    try { setBusy("portal"); setError(null); const r=await openBillingPortal(tenantId); window.location.assign(r.url); }
    catch(e){ setError(e instanceof Error?e.message:"Could not open billing portal"); setBusy(null); }
  }

  const active = billing && ["active","trialing"].includes(billing.status);
  const used = billing?.conversationsUsed ?? 0;
  const limit = billing?.conversationLimit ?? 0;
  const pct = limit ? Math.min(100,Math.round((used/limit)*100)) : 0;

  return <div className="page billing-page">
    <div className="billing-head"><div><h1>Plan & billing</h1><p className="desc">See what your plan includes, how much you have used and manage your subscription.</p></div>{billing?.hasCustomer&&canManage&&<button className="btn ghost" onClick={portal} disabled={!!busy}>{busy==="portal"?"Opening…":"Manage billing in Stripe"}</button>}</div>
    {notice&&<div className="ok">{notice}</div>}{error&&<div className="err">{error}</div>}
    {billing&&<div className="billing-summary card"><div><span className="billing-label">CURRENT PLAN</span><strong>{billing.plan === "unsubscribed" ? "No paid plan" : billing.plan.charAt(0).toUpperCase()+billing.plan.slice(1)}</strong><span className={`billing-status status-${billing.status}`}>{statusLabel(billing.status,billing.billingEnforced)}</span></div><div><span className="billing-label">CONVERSATIONS THIS MONTH</span><strong>{used.toLocaleString()} / {limit.toLocaleString()}</strong><div className="billing-meter"><i style={{width:`${pct}%`}}/></div></div><div><span className="billing-label">RENEWS / ENDS</span><strong>{billing.currentPeriodEnd ? new Date(billing.currentPeriodEnd).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}) : "—"}</strong><span className="muted">{billing.cancelAtPeriodEnd?"Cancels at period end":"Monthly billing"}</span></div></div>}

    <div className="billing-plan-grid">{plans.map(plan=>{
      const current = billing?.plan===plan.key && active;
      return <article className={`billing-plan card ${(requestedPlan?plan.key===requestedPlan:plan.key==="growth")?"featured":""}`} key={plan.key}>
        {plan.key==="growth"&&<span className="billing-badge">MOST POPULAR</span>}<h2>{plan.name}</h2><div className="billing-price"><b>£{plan.monthlyPriceGbp}</b><span>/ month<br/><small>ex VAT</small></span></div><ul><li>✓ {plan.maxAssistants} AI assistant{plan.maxAssistants!==1?"s":""}</li><li>✓ {plan.conversationLimit.toLocaleString()} conversations / month</li><li>✓ Website, knowledge & support tickets</li>{plan.key!=="starter"&&<><li>✓ Live integrations & customer actions</li><li>✓ Workflows, rich chat experiences & controlled actions</li><li>✓ Team access, customer inbox & human takeover</li><li>✓ Customer insights & analytics</li></>}{plan.key==="scale"&&<><li>✓ Custom integrations & advanced permissions</li><li>✓ Audit, operations & enterprise controls</li></>}</ul>{canManage ? current ? <button className="btn ghost" disabled>Current plan</button> : active ? <button className="btn primary" onClick={portal} disabled={!!busy}>Change plan in Stripe</button> : <button className="btn primary" onClick={()=>checkout(plan.key)} disabled={!!busy}>{busy===plan.key?"Opening checkout…":`Start ${plan.name} trial`}</button> : <button className="btn ghost" disabled>Owner/admin required</button>}</article>
    })}</div>
    <p className="muted billing-footnote">New subscriptions include a 14-day free trial. Payments and card details are handled by Stripe. ZoChat does not store your card number. Plan access is updated from signed Stripe webhooks.</p>
  </div>;
}
