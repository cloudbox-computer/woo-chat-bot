import React from "react";
import { getIntegrations, updateIntegration, type IntegrationItem } from "../lib/api";
import { Card, Field, Spinner, ErrorBox, Badge, toast } from "../components/ui";

export default function IntegrationsPage() {
  const [items, setItems] = React.useState<IntegrationItem[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [showWoo, setShowWoo] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const [url, setUrl] = React.useState("");
  const [key, setKey] = React.useState("");
  const [secret, setSecret] = React.useState("");

  async function load() {
    try {
      const res = await getIntegrations();
      setItems(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load integrations");
    }
  }

  React.useEffect(() => {
    load();
  }, []);

  async function saveWoo() {
    if (!url.trim() || !key.trim() || !secret.trim()) {
      toast("err", "URL, consumer key and secret are required");
      return;
    }
    setBusy(true);
    try {
      await updateIntegration({
        provider: "woocommerce",
        credentials: { url: url.trim(), consumer_key: key.trim(), consumer_secret: secret.trim() },
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

  if (error) return <ErrorBox message={error} />;
  if (items === null) return <Spinner />;

  const woo = items.find((i) => i.provider === "woocommerce");

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Integrations</h1>
          <p className="desc">Connect your store so the assistant can look up real data.</p>
        </div>
      </div>

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
          </div>
        ) : (
          <div style={{ marginTop: 8 }}>
            <Field label="Store URL">
              <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://yourstore.com" />
            </Field>
            <Field label="Consumer key">
              <input type="text" value={key} onChange={(e) => setKey(e.target.value)} placeholder="ck_…" />
            </Field>
            <Field label="Consumer secret">
              <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="cs_…" />
            </Field>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn" disabled={busy} onClick={saveWoo}>Save</button>
              <button className="btn ghost" onClick={() => setShowWoo(false)}>Cancel</button>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
