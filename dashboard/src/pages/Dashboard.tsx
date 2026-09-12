import React from "react";
import { supabase } from "../lib/supabase";
import { getConfig, type ConfigData, type TenantSummary, type PlanEntitlements, createTenant, listTenants } from "../lib/api";
import Overview from "./Overview";
import ChatbotPage from "./Chatbot";
import KnowledgePage from "./Knowledge";
import TicketsPage from "./Tickets";
import IntegrationsPage from "./Integrations";
import SettingsPage from "./Settings";
import TeamPage from "./Team";
import AuditPage from "./Audit";
import EnterprisePage from "./Enterprise";
import OperationsPage from "./Operations";
import BillingPage from "./Billing";

type Page = "overview" | "chatbot" | "knowledge" | "tickets" | "integrations" | "team" | "audit" | "operations" | "enterprise" | "billing" | "settings";

const NAV: Array<{ id: Page; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "chatbot", label: "AI Assistants" },
  { id: "knowledge", label: "Knowledge" },
  { id: "tickets", label: "Tickets" },
  { id: "integrations", label: "Integrations" },
  { id: "team", label: "Team" },
  { id: "audit", label: "Audit Log" },
  { id: "operations", label: "Operations" },
  { id: "enterprise", label: "Enterprise" },
  { id: "billing", label: "Billing" },
  { id: "settings", label: "Settings" },
];
const PAGE_FEATURE: Partial<Record<Page, keyof PlanEntitlements>> = {
  team: "team",
  audit: "auditLog",
  operations: "operations",
  enterprise: "enterpriseControls",
};

function pageAllowed(page: Page, entitlements?: PlanEntitlements | null): boolean {
  const feature = PAGE_FEATURE[page];
  if (!feature) return true;
  return entitlements?.[feature] === true;
}

function requiredPlanForPage(page: Page, entitlements?: PlanEntitlements | null): string {
  const feature = PAGE_FEATURE[page];
  if (!feature) return "a higher";
  const plan = entitlements?.minimumUpgradeFor?.[feature];
  return plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : "a higher";
}


interface DashboardShellProps {
  tenants: TenantSummary[];
  selectedTenantId: string | null;
  onTenantSelect: (id: string | null) => void;
  onTenantCreated?: (tenantId: string) => void;
}

function pageFromUrl(): Page {
  try {
    const value = new URLSearchParams(window.location.search).get("page");
    return NAV.some((item) => item.id === value) ? (value as Page) : "overview";
  } catch {
    return "overview";
  }
}

function ticketFromUrl(): string | null {
  try { return new URLSearchParams(window.location.search).get("ticket"); }
  catch { return null; }
}

export default function DashboardShell({ tenants, selectedTenantId, onTenantSelect, onTenantCreated }: DashboardShellProps) {
  const [page, setPage] = React.useState<Page>(pageFromUrl);
  const [linkedTicketId, setLinkedTicketId] = React.useState<string | null>(ticketFromUrl);
  const [config, setConfig] = React.useState<ConfigData | null>(null);
  const [showTenantMenu, setShowTenantMenu] = React.useState(false);
  const [showCreateModal, setShowCreateModal] = React.useState(false);
  const [newTenantName, setNewTenantName] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const onPopState = () => {
      setPage(pageFromUrl());
      setLinkedTicketId(ticketFromUrl());
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function navigateToPage(nextPage: Page) {
    setPage(nextPage);
    setLinkedTicketId(null);
    const url = new URL(window.location.href);
    if (nextPage === "overview") url.searchParams.delete("page");
    else url.searchParams.set("page", nextPage);
    url.searchParams.delete("ticket");
    window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  React.useEffect(() => {
    // Reload the shell config whenever the active tenant changes. Clear the
    // previous tenant first so stale data is never rendered during the fetch.
    let cancelled = false;
    setConfig(null);
    if (!selectedTenantId) return () => { cancelled = true; };
    getConfig(selectedTenantId)
      .then((next) => { if (!cancelled) setConfig(next); })
      .catch(() => { if (!cancelled) setConfig(null); });
    return () => { cancelled = true; };
  }, [selectedTenantId]);

  async function signOut() {
    await supabase.auth.signOut();
  }

  async function handleCreateTenant() {
    if (!newTenantName.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const result = await createTenant(newTenantName.trim());
      if (result.ok) {
        // Close modal
        setShowCreateModal(false);
        setNewTenantName("");
        // Fetch updated tenant list to find the newly created tenant
        const tenantsRes = await listTenants();
        const newTenant = tenantsRes.tenants.find(t => t.slug === result.slug || t.name === newTenantName.trim());
        const tenantId = newTenant?.id ?? result.tenantId;
        // A new workspace has its own onboarding + subscription. Strip any
        // Stripe success/cancel state belonging to the previous workspace.
        const nextUrl = new URL(window.location.href);
        ["onboarding_checkout", "billing", "plan", "session_id", "welcome", "page", "ticket"].forEach((key) => nextUrl.searchParams.delete(key));
        nextUrl.searchParams.set("tenant", tenantId);
        window.history.replaceState({}, "", `${nextUrl.pathname}${nextUrl.search}`);
        // Notify parent to switch to onboarding
        onTenantCreated?.(tenantId);
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create tenant");
    } finally {
      setCreating(false);
    }
  }

  const tenant = config?.tenant;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="logo">◈</span> Assistant HQ
        </div>

        {/* Tenant Switcher */}
        <div className="tenant-switcher" style={{ position: 'relative', marginBottom: 12 }}>
          <button
            className="btn ghost tenant-switch-btn"
            onClick={() => setShowTenantMenu(!showTenantMenu)}
            title="Switch tenant"
          >
            <span className="tenant-icon">◈</span>
            <span className="tenant-name">{tenant?.name || 'Select Tenant'}</span>
            <span className={`chevron ${showTenantMenu ? 'open' : ''}`}>▼</span>
          </button>
          {showTenantMenu && (
            <div className="tenant-dropdown">
              {tenants.map((t) => (
                <button
                  key={t.id}
                  className={`tenant-option ${selectedTenantId === t.id ? 'active' : ''}`}
                  onClick={() => {
                    // Clear the current tenant immediately; the newly selected
                    // tenant is then fetched by id. Never flash the old tenant.
                    setConfig(null);
                    onTenantSelect(t.id);
                    setShowTenantMenu(false);
                  }}
                >
                  <span>{t.name}</span>
                  <span className="muted" style={{ fontSize: 11 }}>{t.slug}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="sidebar-nav-scroll">
          <div className="nav-label">Manage</div>
          {NAV.filter((n) => pageAllowed(n.id, config?.entitlements)).map((n) => (
            <button
              key={n.id}
              className={`nav-item ${page === n.id ? "active" : ""}`}
              onClick={() => navigateToPage(n.id)}
            >
              {n.label}
            </button>
          ))}
        </div>

        <div className="sidebar-footer">
          {tenant && (
            <div className="tenant-chip">
              <div className="tname">{tenant.name}</div>
              <div className="tslug">{tenant.slug}</div>
            </div>
          )}
          <button 
            className="btn ghost create-tenant-btn" 
            onClick={() => setShowCreateModal(true)}
            title="Create new workspace"
          >
            + New Workspace
          </button>
          <button className="btn ghost signout" onClick={signOut}>Sign out</button>
        </div>

        {/* Create Tenant Modal */}
        {showCreateModal && (
          <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h2 style={{ margin: '0 0 16px' }}>Create New Workspace</h2>
              <p className="desc" style={{ margin: '0 0 16px' }}>Create a separate business workspace. Each workspace has its own subscription and assistant allowance.</p>
              <input
                type="text"
                placeholder="e.g., Acme Ltd"
                value={newTenantName}
                onChange={(e) => setNewTenantName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreateTenant(); }}
                className="input"
                autoFocus
              />
              {createError && <div className="err" style={{ marginTop: 8 }}>{createError}</div>}
              <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
                <button className="btn ghost" onClick={() => setShowCreateModal(false)}>Cancel</button>
                <button className="btn primary" onClick={handleCreateTenant} disabled={creating || !newTenantName.trim()}>
                  {creating ? 'Creating...' : 'Create Workspace'}
                </button>
              </div>
            </div>
          </div>
        )}
      </aside>

      <main className="main">
        {selectedTenantId && (
          <React.Fragment key={selectedTenantId}>
            {!pageAllowed(page, config?.entitlements) ? (
              <div className="page"><div className="card"><h1>Upgrade required</h1><p className="desc">This feature is available on the {requiredPlanForPage(page, config?.entitlements)} plan.</p><button className="btn primary" onClick={()=>navigateToPage("billing")}>View plans</button></div></div>
            ) : (<>
              {page === "overview" && <Overview tenantId={selectedTenantId} config={config} onNavigate={(next)=>navigateToPage(next)} />}
              {page === "chatbot" && <ChatbotPage tenantId={selectedTenantId} config={config} onConfigChange={setConfig} onUpgrade={()=>navigateToPage("billing")} />}
              {page === "knowledge" && <KnowledgePage tenantId={selectedTenantId} />}
              {page === "tickets" && <TicketsPage tenantId={selectedTenantId} selectedTicketId={linkedTicketId} />}
              {page === "integrations" && <IntegrationsPage tenantId={selectedTenantId} entitlements={config?.entitlements ?? null} onUpgrade={()=>navigateToPage("billing")} />}
              {page === "team" && <TeamPage tenantId={selectedTenantId} entitlements={config?.entitlements ?? null} />}
              {page === "audit" && <AuditPage tenantId={selectedTenantId} />}
              {page === "operations" && <OperationsPage tenantId={selectedTenantId} />}
              {page === "enterprise" && <EnterprisePage tenantId={selectedTenantId} />}
              {page === "billing" && <BillingPage tenantId={selectedTenantId} />}
              {page === "settings" && <SettingsPage tenantId={selectedTenantId} config={config} onConfigChange={setConfig} />}
            </>)}
          </React.Fragment>
        )}
      </main>
    </div>
  );
}
