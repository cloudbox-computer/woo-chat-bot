import React from "react";
import { Routes } from "react-router-dom";
import { supabase } from "./lib/supabase";
import { getConfig, ApiError, type TenantSummary, listTenants } from './lib/api';
import AuthPage from "./pages/Auth";
import Onboarding from "./pages/Onboarding";
import DashboardShell from "./pages/Dashboard";
import { ToastHost } from "./components/ui";

type SessionState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "checking-tenant" }
  | { status: "onboarding" }
  | { status: "dashboard" };

const SELECTED_TENANT_KEY = 'zochat_selected_tenant';

function getSelectedTenantId(): string | null {
  try { return localStorage.getItem(SELECTED_TENANT_KEY); } catch { return null; }
}

function saveSelectedTenantId(tenantId: string | null) {
  try {
    if (tenantId) localStorage.setItem(SELECTED_TENANT_KEY, tenantId);
    else localStorage.removeItem(SELECTED_TENANT_KEY);
  } catch { /* ignore */ }
}

export default function App() {
  const [state, setState] = React.useState<SessionState>({ status: "loading" });
  const [tenants, setTenants] = React.useState<TenantSummary[]>([]);
  const [selectedTenantId, setSelectedTenantId] = React.useState<string | null>(getSelectedTenantId());
  const resolvedRef = React.useRef(false);
  const selectedTenantIdRef = React.useRef(selectedTenantId);

  React.useEffect(() => { selectedTenantIdRef.current = selectedTenantId; }, [selectedTenantId]);

  const refresh = React.useCallback(async (forceTenantId?: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      resolvedRef.current = false;
      setState({ status: "signed-out" });
      return;
    }
    if (resolvedRef.current) return;
    setState({ status: "checking-tenant" });
    try {
      const tenantsRes = await listTenants();
      setTenants(tenantsRes.tenants);

      let currentTenantId = forceTenantId || selectedTenantIdRef.current;
      const validTenantIds = new Set(tenantsRes.tenants.map((tenant) => tenant.id));

      // localStorage is shared by browser profile, not by Supabase user. Never
      // trust a persisted tenant id unless it belongs to the current account.
      if (currentTenantId && !validTenantIds.has(currentTenantId)) {
        currentTenantId = tenantsRes.tenants[0]?.id ?? null;
      }
      if (!currentTenantId && tenantsRes.tenants.length > 0) {
        currentTenantId = tenantsRes.tenants[0].id;
      }

      setSelectedTenantId(currentTenantId);
      selectedTenantIdRef.current = currentTenantId;
      saveSelectedTenantId(currentTenantId);

      if (currentTenantId) {
        const configData = await getConfig(currentTenantId);
        // If onboarding not complete, route to onboarding wizard
        if (!configData.tenant.onboardingComplete) {
          resolvedRef.current = true;
          setState({ status: "onboarding" });
          return;
        }
      }

      resolvedRef.current = true;
      setState({ status: "dashboard" });
    } catch (err) {
      resolvedRef.current = true;
      if (err instanceof ApiError && err.status === 403) {
        // A stale/foreign selected tenant must never become the active dashboard
        // context. Clear it so the next refresh resolves from real memberships.
        setSelectedTenantId(null);
        selectedTenantIdRef.current = null;
        saveSelectedTenantId(null);
        setState({ status: tenants.length ? "dashboard" : "onboarding" });
      } else if (err instanceof ApiError && (err.status === 404 || err.status === 400)) {
        setState({ status: "onboarding" });
      } else {
        setState({ status: "dashboard" });
      }
    }
  }, []);

  React.useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        resolvedRef.current = false;
        setState({ status: "signed-out" });
      } else {
        refresh();
      }
    });
    refresh();
    return () => subscription.unsubscribe();
  }, [refresh]);

  if (state.status === "loading" || state.status === "checking-tenant") {
    return <div className="auth-wrap"><div className="muted">Loading…</div></div>;
  }
  if (state.status === "signed-out") {
    return (<><AuthPage /><ToastHost /></>);
  }
  function handleOnboardingComplete(tenantId: string) {
    setSelectedTenantId(tenantId);
    selectedTenantIdRef.current = tenantId;
    saveSelectedTenantId(tenantId);
    resolvedRef.current = false;
    void refresh(tenantId);
  }

  if (state.status === "onboarding") {
    return (<><Onboarding tenantId={selectedTenantId} onComplete={handleOnboardingComplete} /><ToastHost /></>);
  }


  function handleTenantSelect(tenantId: string | null) {
    setSelectedTenantId(tenantId);
    saveSelectedTenantId(tenantId);
  }

  function handleTenantCreated(newTenantId?: string) {
    setSelectedTenantId(newTenantId || null);
    saveSelectedTenantId(newTenantId || null);
    resolvedRef.current = false;
    refresh(newTenantId);
  }

  return (
    <>
      <DashboardShell tenants={tenants} selectedTenantId={selectedTenantId} onTenantSelect={handleTenantSelect} onTenantCreated={handleTenantCreated} />
      <ToastHost />
    </>
  );
}

export function AppRoutes() {
  return <Routes>{/* shell renders its own inner nav */}</Routes>;
}