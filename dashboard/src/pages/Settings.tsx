import React from "react";
import { getConfig, updateConfig, type ConfigData } from "../lib/api";
import { Card, Field, Spinner, ErrorBox, Badge, toast } from "../components/ui";

export default function SettingsPage({
  tenantId,
  config,
  onConfigChange,
}: {
  tenantId: string;
  config: ConfigData | null;
  onConfigChange: (c: ConfigData) => void;
}) {
  const [data, setData] = React.useState<ConfigData | null>(config);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const [supportEmail, setSupportEmail] = React.useState("");
  const [ticketPrefix, setTicketPrefix] = React.useState("");
  const [defaultPriority, setDefaultPriority] = React.useState("normal");
  const [categories, setCategories] = React.useState("");
  const [brandColour, setBrandColour] = React.useState("#7c3aed");

  React.useEffect(() => {
    setData(config);
    setError(null);
    if (!config) {
      getConfig(tenantId).then(setData).catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
    }
  }, [tenantId, config]);

  React.useEffect(() => {
    if (data?.tenant) {
      setSupportEmail(data.tenant.supportEmail ?? "");
      setTicketPrefix(data.tenant.ticketPrefix ?? "");
      setDefaultPriority(data.tenant.defaultTicketPriority ?? "normal");
      const cats = Array.isArray(data.tenant.autoTicketCategories)
        ? (data.tenant.autoTicketCategories as string[])
        : [];
      setCategories(cats.join(", "));
      setBrandColour(data.tenant.brandColour ?? "#7c3aed");
    }
  }, [data]);

  if (error) return <ErrorBox message={error} />;
  if (!data) return <Spinner />;

  async function save() {
    setBusy(true);
    try {
      await updateConfig(tenantId, {
        supportEmail,
        ticketPrefix,
        defaultTicketPriority: defaultPriority,
        autoTicketCategories: categories.split(",").map((s) => s.trim()).filter(Boolean),
        brandColour,
      });
      const fresh = await getConfig(tenantId);
      setData(fresh);
      onConfigChange(fresh);
      toast("ok", "Settings saved");
    } catch (e) {
      toast("err", e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="desc">Support, branding and tenant details.</p>
        </div>
      </div>

      <Card>
        <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>Support & tickets</h3>
        <Field label="Support email" hint="Tickets created by customers are emailed here.">
          <input type="email" value={supportEmail} onChange={(e) => setSupportEmail(e.target.value)} placeholder="support@yourstore.com" />
        </Field>
        <Field label="Ticket reference prefix" hint="1-4 letters/numbers, e.g. IP → IP-2026-000001.">
          <input type="text" value={ticketPrefix} onChange={(e) => setTicketPrefix(e.target.value.toUpperCase())} maxLength={4} placeholder="IP" />
        </Field>
        <Field label="Default ticket priority">
          <select value={defaultPriority} onChange={(e) => setDefaultPriority(e.target.value)}>
            <option value="low">low</option>
            <option value="normal">normal</option>
            <option value="high">high</option>
            <option value="urgent">urgent</option>
          </select>
        </Field>
        <Field label="Auto-ticket categories" hint="Comma-separated — the assistant categorises tickets into these.">
          <input type="text" value={categories} onChange={(e) => setCategories(e.target.value)} placeholder="damaged, refund, order query" />
        </Field>
        <Field label="Brand colour">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(brandColour) ? brandColour : "#7c3aed"}
              onChange={(e) => setBrandColour(e.target.value)}
            />
            <input type="text" value={brandColour} onChange={(e) => setBrandColour(e.target.value)} style={{ width: 120 }} />
          </div>
        </Field>
        <button className="btn" disabled={busy} onClick={save}>Save changes</button>
      </Card>

      <Card style={{ marginTop: 16 }}>
        <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>Onboarding</h3>
        <p className="muted" style={{ margin: 0 }}>
          Onboarding status:{" "}
          <Badge tone={data.tenant.onboardingComplete ? "on" : "off"}>
            {data.tenant.onboardingComplete ? "Complete" : "Incomplete"}
          </Badge>
        </p>
      </Card>
    </>
  );
}
