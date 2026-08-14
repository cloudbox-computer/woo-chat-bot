import React from "react";
import { supabase } from "../lib/supabase";
import { getConfig, type ConfigData, type TenantSummary } from "../lib/api";
import Overview from "./Overview";
import ChatbotPage from "./Chatbot";
import KnowledgePage from "./Knowledge";
import TicketsPage from "./Tickets";
import IntegrationsPage from "./Integrations";
import SettingsPage from "./Settings";

type Page = "overview" | "chatbot" | "knowledge" | "tickets" | "integrations" | "settings";

const NAV: Array<{ id: Page; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "chatbot", label: "Chatbot" },
  { id: "knowledge", label: "Knowledge" },
  { id: "tickets", label: "Tickets" },
  { id: "integrations", label: "Integrations" },
  { id: "settings", label: "Settings" },
];

interface DashboardShellProps {
  tenants: TenantSummary[];
  selectedTenantId: string | null;
  onTenantSelect: (id: string | null) => void;
}

export default function DashboardShell({ tenants, selectedTenantId, onTenantSelect }: DashboardShellProps) {
  const [page, setPage] = React.useState<Page>("overview");
  const [config, setConfig] = React.useState<ConfigData | null>(null);
  const [showTenantMenu, setShowTenantMenu] = React.useState(false);

  React.useEffect(() => {
    // Reload config when tenant changes
    getConfig(selectedTenantId || undefined).then(setConfig).catch(() => setConfig(null));
  }, [selectedTenantId]);

  async function signOut() {
    await supabase.auth.signOut();
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
        <button className="btn ghost signout" onClick={signOut}>Sign out</button>
      </aside>

      <main className="main">
        {page === "overview" && <Overview config={config} />}
        {page === "chatbot" && <ChatbotPage config={config} onConfigChange={setConfig} />}
        {page === "knowledge" && <KnowledgePage />}
        {page === "tickets" && <TicketsPage />}
        {page === "integrations" && <IntegrationsPage />}
        {page === "settings" && <SettingsPage config={config} onConfigChange={setConfig} />}
      </main>
    </div>
  );
}
