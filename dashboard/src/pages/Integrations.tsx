import React from "react";
import { getIntegrations, testIntegration, updateIntegration, type IntegrationItem } from "../lib/api";
import { Card, Field, Spinner, ErrorBox, Badge, toast } from "../components/ui";

export default function IntegrationsPage({ tenantId }: { tenantId: string }) {
  const [items, setItems] = React.useState<IntegrationItem[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [showWoo, setShowWoo] = React.useState(false);
  const [showSupa, setShowSupa] = React.useState(false);
  const [showResend, setShowResend] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const [url, setUrl] = React.useState("");
  const [key, setKey] = React.useState("");
  const [secret, setSecret] = React.useState("");
  const [webhookSecret,setWebhookSecret]=React.useState("");
  const [supaUrl, setSupaUrl] = React.useState("");
  const [supaKey, setSupaKey] = React.useState("");
  const [resendKey, setResendKey] = React.useState("");
  const [resendFromEmail, setResendFromEmail] = React.useState("");
  const [resendFromName, setResendFromName] = React.useState("");

  async function load() {
    try {
      const res = await getIntegrations(tenantId);
      setItems(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load integrations");
    }
  }

  React.useEffect(() => {
    setItems(null);
    setError(null);
    setShowWoo(false);
    setShowSupa(false);
    setShowResend(false);
    setUrl("");
    setKey("");
    setSecret("");
    setWebhookSecret("");
    setSupaUrl("");
    setSupaKey("");
    setResendKey("");
    setResendFromEmail("");
    setResendFromName("");
    load();
  }, [tenantId]);

  async function saveWoo() {
    if (!url.trim() && !woo?.url) { toast("err", "Store URL is required"); return; }
    setBusy(true);
    try {
      await updateIntegration(tenantId, {
        provider: "woocommerce",
        credentials: { url: url.trim() || woo?.url || undefined, consumer_key: key.trim() || undefined, consumer_secret: secret.trim() || undefined, webhook_secret: webhookSecret.trim() || undefined },
      });
      setShowWoo(false);
      setUrl("");
      setKey("");
      setSecret("");
      toast("ok", "WooCommerce connected");
      await load();
    } catch (e) {
      toast("err", e instanceof Error ? e.message : "Failed to connect");
    } finally {
      setBusy(false);
    }
  }

  async function saveSupa() {
    if (!supaUrl.trim()) {
      toast("err", "Supabase project URL is required");
      return;
    }
    setBusy(true);
    try {
      await updateIntegration(tenantId, {
        provider: "supabase",
        credentials: { url: supaUrl.trim(), anon_key: supaKey.trim() },
      });
      setShowSupa(false);
      setSupaUrl("");
      setSupaKey("");
      toast("ok", "Supabase connected");
      await load();
    } catch (e) {
      toast("err", e instanceof Error ? e.message : "Failed to connect");
    } finally {
      setBusy(false);
    }
  }


  async function runTest(provider: "woocommerce" | "supabase" | "resend") {
    setBusy(true);
    try { const r = await testIntegration(tenantId, provider); toast(r.ok ? "ok" : "err", `${r.message} (${r.latencyMs}ms)`); }
    catch (e) { toast("err", e instanceof Error ? e.message : "Health check failed"); }
    finally { setBusy(false); }
  }

  async function saveResend() {
    if (!resendFromEmail.trim()) {
      toast("err", "From email is required");
      return;
    }
    const existing = items?.find((i) => i.provider === "resend");
    if (!existing?.hasApiKey && !resendKey.trim()) {
      toast("err", "Resend API key is required");
      return;
    }
    setBusy(true);
    try {
      await updateIntegration(tenantId, {
        provider: "resend",
        credentials: {
          api_key: resendKey.trim() || undefined,
          from_email: resendFromEmail.trim(),
          from_name: resendFromName.trim() || undefined,
        },
      });
      setShowResend(false);
      setResendKey("");
      toast("ok", "Resend email delivery configured");
      await load();
    } catch (e) {
      toast("err", e instanceof Error ? e.message : "Failed to save Resend settings");
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorBox message={error} />;
  if (items === null) return <Spinner />;

  const woo = items.find((i) => i.provider === "woocommerce");
  const supa = items.find((i) => i.provider === "supabase");
  const resend = items.find((i) => i.provider === "resend");

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Integrations</h1>
          <p className="desc">Connect your store so the assistant can look up real data.</p>
        </div>
      </div>

      {/* WooCommerce */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div>
            <div style={{ fontWeight: 600 }}>WooCommerce</div>
            <div className="muted" style={{ fontSize: 13 }}>
              Products, orders, cart &amp; stock lookups
            </div>
          </div>
          {woo ? (
            <Badge tone={woo.configured ? "on" : "off"}>{woo.configured ? `Connected · ${woo.url}` : "Not configured"}</Badge>
          ) : (
            <Badge tone="off">Not configured</Badge>
          )}
        </div>

        {!showWoo ? (
          <div style={{ marginTop: 8 }}>
            <button className="btn secondary" onClick={() => setShowWoo(true)}>
              {woo?.configured ? "Update credentials" : "Connect store"}
            </button>
            {woo?.configured && <button className="btn ghost" disabled={busy} onClick={() => runTest("woocommerce")}>Test connection</button>}
          </div>
        ) : (
          <div style={{ marginTop: 8 }}>
            <Field label="Store URL">
              <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://yourstore.com" />
            </Field>
            <Field label="Consumer key">
              <input type="text" value={key} onChange={(e) => setKey(e.target.value)} placeholder={woo?.configured ? "Saved — leave blank to keep" : "ck_…"} />
            </Field>
            <Field label="Consumer secret">
              <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={woo?.configured ? "Saved — leave blank to keep" : "cs_…"} />
            </Field>
            <Field label="Webhook signing secret (recommended)">
              <input type="password" value={webhookSecret} onChange={(e)=>setWebhookSecret(e.target.value)} placeholder="Use the same secret in WooCommerce webhooks" />
            </Field>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn" disabled={busy} onClick={saveWoo}>Save</button>
              <button className="btn ghost" onClick={() => setShowWoo(false)}>Cancel</button>
            </div>
          </div>
        )}
      </Card>

      {/* Supabase */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div>
            <div style={{ fontWeight: 600 }}>Supabase</div>
            <div className="muted" style={{ fontSize: 13 }}>
              Connect your own database — the assistant can query your tables to answer customer questions about orders, bookings, subscriptions, etc.
            </div>
          </div>
          {supa ? (
            <Badge tone={supa.configured ? "on" : "off"}>{supa.configured ? `Connected · ${supa.url}` : "Not configured"}</Badge>
          ) : (
            <Badge tone="off">Not configured</Badge>
          )}
        </div>

        {!showSupa ? (
          <div style={{ marginTop: 8 }}>
            <button className="btn secondary" onClick={() => setShowSupa(true)}>
              {supa?.configured ? "Update connection" : "Connect Supabase"}
            </button>
            {supa?.configured && <button className="btn ghost" disabled={busy} onClick={() => runTest("supabase")}>Test connection</button>}
          </div>
        ) : (
          <div style={{ marginTop: 8 }}>
            <Field label="Project URL">
              <input type="url" value={supaUrl} onChange={(e) => setSupaUrl(e.target.value)} placeholder="https://your-project.supabase.co" />
            </Field>
            <Field label="Anon Key">
              <input type="password" value={supaKey} onChange={(e) => setSupaKey(e.target.value)} placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." />
            </Field>
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
              Find these in Supabase Dashboard → Settings → API. The anon key is required for the assistant to query your tables.
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn" disabled={busy} onClick={saveSupa}>Save</button>
              <button className="btn ghost" onClick={() => setShowSupa(false)}>Cancel</button>
            </div>
          </div>
        )}
      </Card>

      {/* Resend */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div>
            <div style={{ fontWeight: 600 }}>Resend</div>
            <div className="muted" style={{ fontSize: 13 }}>
              Send support-ticket notifications from your organisation's own email domain.
            </div>
          </div>
          {resend ? (
            <Badge tone={resend.configured ? "on" : "off"}>
              {resend.configured ? `Connected · ${resend.fromEmail ?? "sender configured"}` : "Not configured"}
            </Badge>
          ) : (
            <Badge tone="off">Not configured</Badge>
          )}
        </div>

        {!showResend ? (
          <div style={{ marginTop: 8 }}>
            <button
              className="btn secondary"
              onClick={() => {
                setResendFromEmail(resend?.fromEmail ?? "");
                setResendFromName(resend?.fromName ?? "");
                setResendKey("");
                setShowResend(true);
              }}
            >
              {resend?.configured ? "Update Resend" : "Connect Resend"}
            </button>
            {resend?.configured && <button className="btn ghost" disabled={busy} onClick={() => runTest("resend")}>Test connection</button>}
          </div>
        ) : (
          <div style={{ marginTop: 8 }}>
            <Field label="Resend API key">
              <input
                type="password"
                value={resendKey}
                onChange={(e) => setResendKey(e.target.value)}
                placeholder={resend?.hasApiKey ? "Saved — leave blank to keep current key" : "re_…"}
                autoComplete="new-password"
              />
            </Field>
            <Field label="From email">
              <input
                type="email"
                value={resendFromEmail}
                onChange={(e) => setResendFromEmail(e.target.value)}
                placeholder="support@yourdomain.com"
              />
            </Field>
            <Field label="From name (optional)">
              <input
                type="text"
                value={resendFromName}
                onChange={(e) => setResendFromName(e.target.value)}
                placeholder="Your Company Support"
              />
            </Field>
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
              The From email must use a domain verified in this tenant's Resend account. The API key is stored server-side and is never returned to the dashboard.
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn" disabled={busy} onClick={saveResend}>Save</button>
              <button className="btn ghost" onClick={() => setShowResend(false)}>Cancel</button>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
