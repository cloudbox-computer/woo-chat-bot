import React from "react";
import { Routes } from "react-router-dom";
import { supabase } from "./lib/supabase";
import { getConfig, ApiError, type TenantSummary, listTenants } from './lib/api';
import AuthPage from "./pages/Auth";
import Landing from "./pages/Landing";
import Onboarding from "./pages/Onboarding";
import DashboardShell from "./pages/Dashboard";
import { ToastHost } from "./components/ui";
import MfaGate from "./components/MfaGate";

type SessionState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "checking-tenant" }
  | { status: "mfa" }
  | { status: "blocked"; message: string }
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

      const validTenantIds = new Set(tenantsRes.tenants.map((tenant) => tenant.id));

      // Deep links from ticket emails may specify the tenant. Only honour it
      // after proving the signed-in user actually belongs to that tenant.
      const linkedTenantId = (() => {
        try { return new URLSearchParams(window.location.search).get("tenant"); }
        catch { return null; }
      })();

      let currentTenantId =
        forceTenantId ||
        (linkedTenantId && validTenantIds.has(linkedTenantId) ? linkedTenantId : null) ||
        selectedTenantIdRef.current;

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
      if (err instanceof ApiError && err.code === "MFA_REQUIRED") {
        resolvedRef.current = false;
        setState({ status: "mfa" });
      } else if (err instanceof ApiError && err.code === "IP_NOT_ALLOWED") {
        setState({ status: "blocked", message: err.message || "This network is not allowed to access the workspace." });
      } else if (err instanceof ApiError && err.status === 403) {
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
    const params = new URLSearchParams(window.location.search);
    const wantsLogin = window.location.pathname === "/login" || params.get("login") === "1" || params.has("ticket");
    const openLogin = (plan?: "starter" | "growth" | "scale") => {
      const next = new URL(window.location.href);
      // Keep authentication on the SPA root. Direct /login navigation can 404 on
      // static Vercel deployments before React gets a chance to render.
      next.pathname = "/";
      next.searchParams.set("login", "1");
      if (plan) { next.searchParams.set("page", "billing"); next.searchParams.set("plan", plan); }
      window.history.pushState({}, "", next.pathname + next.search);
      window.dispatchEvent(new PopStateEvent("popstate"));
      window.location.reload();
    };
    return (<>{wantsLogin ? <AuthPage /> : <Landing onLogin={() => openLogin()} onChoosePlan={openLogin} />}<ToastHost /></>);
  }
  function handleOnboardingComplete(tenantId: string) {
    const url = new URL(window.location.href);
    url.pathname = "/";
    url.search = new URLSearchParams({ tenant: tenantId, welcome: "1", billing: "success" }).toString();
    window.history.replaceState({}, "", `${url.pathname}?${url.search}`);
    setSelectedTenantId(tenantId);
    selectedTenantIdRef.current = tenantId;
    saveSelectedTenantId(tenantId);
    resolvedRef.current = false;
    void refresh(tenantId);
  }



  if (state.status === "blocked") {
    return <><div className="auth-wrap"><div className="auth-card"><h1>Access blocked</h1><p className="sub">{state.message}</p><p className="muted">Connect from an approved network or ask the workspace owner to update the dashboard IP allowlist.</p><button className="btn secondary" style={{width:"100%"}} onClick={async()=>{await supabase.auth.signOut();}}>Sign out</button></div></div><ToastHost /></>;
  }

  if (state.status === "mfa") {
    return <><MfaGate required onVerified={()=>{resolvedRef.current=false;void refresh(selectedTenantIdRef.current??undefined)}}/><ToastHost /></>;
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