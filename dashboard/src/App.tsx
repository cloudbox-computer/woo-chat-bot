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
      if (tenantsRes.tenants.length > 0 && !currentTenantId) {
        currentTenantId = tenantsRes.tenants[0].id;
        setSelectedTenantId(currentTenantId);
        saveSelectedTenantId(currentTenantId);
      } else if (currentTenantId) {
        saveSelectedTenantId(currentTenantId);
      }

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
      if (err instanceof ApiError && (err.status === 404 || err.status === 400)) {
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
  if (state.status === "onboarding") {
    return (<><Onboarding /><ToastHost /></>);
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