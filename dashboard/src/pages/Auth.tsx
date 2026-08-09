import React from "react";
import { supabase } from "../lib/supabase";

// Login / Signup — Supabase Auth (convo3.md §Auth).
export default function AuthPage() {
  const [mode, setMode] = React.useState<"login" | "signup">("login");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        // Session change triggers the app-level redirect.
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setConfirming(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  if (confirming) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <h1>Check your inbox</h1>
          <p className="sub">
            We sent a confirmation link to <strong>{email}</strong>. Click it to activate your account,
            then sign in.
          </p>
          <button className="btn secondary" style={{ width: "100%" }} onClick={() => setMode("login")}>
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <h1>{mode === "login" ? "Welcome back" : "Create your account"}</h1>
        <p className="sub">
          {mode === "login"
            ? "Sign in to manage your AI assistant."
            : "One account to set up and manage your store's chatbot."}
        </p>
        {error ? <div className="err">{error}</div> : null}
        <div className="field">
          <label>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@yourstore.com"
            required
            autoComplete="email"
          />
        </div>
        <div className="field">
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            minLength={6}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />
        </div>
        <button className="btn" style={{ width: "100%" }} disabled={busy}>
          {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
        </button>
        <p className="muted" style={{ textAlign: "center", marginTop: 16, fontSize: 13 }}>
          {mode === "login" ? "Don't have an account? " : "Already have an account? "}
          <button
            className="ghost"
            style={{ background: "none", border: "none", color: "var(--accent-2)", cursor: "pointer", fontWeight: 600 }}
            onClick={() => {
              setMode(mode === "login" ? "signup" : "login");
              setError(null);
            }}
          >
            {mode === "login" ? "Sign up" : "Sign in"}
          </button>
        </p>
      </form>
    </div>
  );
}
