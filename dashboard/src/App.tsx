import React from "react";
import { Routes } from "react-router-dom";
import { supabase } from "./lib/supabase";
import { getConfig, ApiError } from "./lib/api";
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

export default function App() {
  const [state, setState] = React.useState<SessionState>({ status: "loading" });

  React.useEffect(() => {
    let alive = true;
    // Resolves the "onboarding vs dashboard" question exactly once per session.
    // Without this, every TOKEN_REFRESHED auth event bounces the state back to
    // "checking-tenant" -> getConfig() -> 404 -> onboarding, which REMOUNTS the
    // wizard and wipes the tenant's in-progress entries.
    let resolved = false;

    async function refresh() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!alive) return;
      if (!session) {
        resolved = false;
        setState({ status: "signed-out" });
        return;
      }
      if (resolved) return; // already know — don't bounce the UI
      setState({ status: "checking-tenant" });
      try {
        await getConfig();
        if (alive) {
          resolved = true;
          setState({ status: "dashboard" });
        }
      } catch (err) {
        if (alive) {
          if (err instanceof ApiError && (err.status === 404 || err.status === 400)) {
            resolved = true;
            setState({ status: "onboarding" });
          } else {
            // A real server error; keep the session but don't bounce to wizard.
            resolved = true;
            setState({ status: "dashboard" });
          }
        }
      }
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!alive) return;
      if (!session) {
        resolved = false;
        setState({ status: "signed-out" });
      } else {
        refresh();
      }
    });

    refresh();
    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, []);

  if (state.status === "loading" || state.status === "checking-tenant") {
    return <div className="auth-wrap"><div className="muted">Loading…</div></div>;
  }
  if (state.status === "signed-out") {
    return (
      <>
        <AuthPage />
        <ToastHost />
      </>
    );
  }
  if (state.status === "onboarding") {
    return (
      <>
        <Onboarding />
        <ToastHost />
      </>
    );
  }

  return (
    <>
      <DashboardShell />
      <ToastHost />
    </>
  );
}

// The Routes are used by the dashboard shell; keep an explicit route table so
// deep links work even though the shell is a single mounted page.
export function AppRoutes() {
  return <Routes>{/* shell renders its own inner nav */}</Routes>;
}
