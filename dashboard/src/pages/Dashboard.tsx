import React from "react";
import { supabase } from "../lib/supabase";
import { getConfig, type ConfigData, type TenantSummary, createTenant, listTenants } from "../lib/api";
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

type Page = "overview" | "chatbot" | "knowledge" | "tickets" | "integrations" | "team" | "audit" | "operations" | "enterprise" | "settings";

const NAV: Array<{ id: Page; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "chatbot", label: "Chatbot" },
  { id: "knowledge", label: "Knowledge" },
  { id: "tickets", label: "Tickets" },
  { id: "integrations", label: "Integrations" },
  { id: "team", label: "Team" },
  { id: "audit", label: "Audit Log" },
  { id: "operations", label: "Operations" },
  { id: "enterprise", label: "Enterprise" },
  { id: "settings", label: "Settings" },
];

interface DashboardShellProps {
  tenants: TenantSummary[];
  selectedTenantId: string | null;
  onTenantSelect: (id: string | null) => void;
  onTenantCreated?: (tenantId: string) => void;
}

export default function DashboardShell({ tenants, selectedTenantId, onTenantSelect, onTenantCreated }: DashboardShellProps) {
  const [page, setPage] = React.useState<Page>("overview");
  const [config, setConfig] = React.useState<ConfigData | null>(null);
  const [showTenantMenu, setShowTenantMenu] = React.useState(false);
  const [showCreateModal, setShowCreateModal] = React.useState(false);
  const [newTenantName, setNewTenantName] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);

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

        <div className="nav-label">Manage</div>
        {NAV.map((n) => (
          <button
            key={n.id}
            className={`nav-item ${page === n.id ? "active" : ""}`}
            onClick={() => setPage(n.id)}
          >
            {n.label}
          </button>
        ))}
        <div className="spacer" />
        {tenant && (
          <div className="tenant-chip">
            <div className="tname">{tenant.name}</div>
            <div className="tslug">{tenant.slug}</div>
          </div>
        )}
        <button 
          className="btn ghost create-tenant-btn" 
          onClick={() => setShowCreateModal(true)}
          title="Create new tenant"
        >
          + New Tenant
        </button>
        <button className="btn ghost signout" onClick={signOut}>Sign out</button>

        {/* Create Tenant Modal */}
        {showCreateModal && (
          <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h2 style={{ margin: '0 0 16px' }}>Create New Tenant</h2>
              <p className="desc" style={{ margin: '0 0 16px' }}>Enter a name for your new assistant instance.</p>
              <input
                type="text"
                placeholder="e.g., Acme Shoes Store"
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
                  {creating ? 'Creating...' : 'Create Tenant'}
                </button>
              </div>
            </div>
          </div>
        )}
      </aside>

      <main className="main">
        {selectedTenantId && (
          <React.Fragment key={selectedTenantId}>
            {page === "overview" && <Overview tenantId={selectedTenantId} config={config} />}
            {page === "chatbot" && <ChatbotPage tenantId={selectedTenantId} config={config} onConfigChange={setConfig} />}
            {page === "knowledge" && <KnowledgePage tenantId={selectedTenantId} />}
            {page === "tickets" && <TicketsPage tenantId={selectedTenantId} />}
            {page === "integrations" && <IntegrationsPage tenantId={selectedTenantId} />}
            {page === "team" && <TeamPage tenantId={selectedTenantId} />}
            {page === "audit" && <AuditPage tenantId={selectedTenantId} />}
            {page === "operations" && <OperationsPage tenantId={selectedTenantId} />}
            {page === "enterprise" && <EnterprisePage tenantId={selectedTenantId} />}
            {page === "settings" && <SettingsPage tenantId={selectedTenantId} config={config} onConfigChange={setConfig} />}
          </React.Fragment>
        )}
      </main>
    </div>
  );
}
