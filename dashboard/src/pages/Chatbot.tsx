import React from "react";
import { getConfig, updateConfig, type ConfigData } from "../lib/api";
import { Card, Field, Spinner, ErrorBox, Badge, toast } from "../components/ui";

export default function ChatbotPage({
  tenantId,
  config,
  onConfigChange,
}: {
  tenantId: string;
  config: ConfigData | null;
  onConfigChange: (c: ConfigData) => void;
}) {
  const [tab, setTab] = React.useState<"settings" | "install">("settings");
  const [data, setData] = React.useState<ConfigData | null>(config);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const [name, setName] = React.useState("");
  const [welcome, setWelcome] = React.useState("");
  const [assistantHeader, setAssistantHeader] = React.useState("");
  const [tone, setTone] = React.useState("");
  const [active, setActive] = React.useState(true);

  React.useEffect(() => {
    setData(config);
    setError(null);
    if (!config) {
      getConfig(tenantId).then(setData).catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
    }
  }, [tenantId, config]);

  // Sync local form state when config loads / changes.
  React.useEffect(() => {
    if (data?.tenant) {
      setName(data.tenant.name);
      setWelcome(data.tenant.welcomeMessage ?? "");
      setAssistantHeader(data.tenant.assistantHeaderMessage ?? "");
      setTone(data.tenant.tone ?? "");
    }
    if (data?.chatbots?.[0]) setActive(data.chatbots[0].active !== false);
  }, [data]);

  if (error) return <ErrorBox message={error} />;
  if (!data) return <Spinner />;
  const current = data;

  async function save() {
    setBusy(true);
    try {
      const bot = current.chatbots[0];
      const patch: Record<string, unknown> = {
        name,
        welcomeMessage: welcome,
        assistantHeaderMessage: assistantHeader,
        tone,
      };
      if (bot) {
        patch.chatbot = { ...(bot.config ?? {}), welcome, tone };
      }
      await updateConfig(tenantId, patch);
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

  async function toggleActive() {
    setBusy(true);
    try {
      const bot = current.chatbots[0];
      if (bot) {
        await updateConfig(tenantId, { botActive: !active });
        const fresh = await getConfig(tenantId);
        setData(fresh);
        onConfigChange(fresh);
        toast("ok", active ? "Assistant paused" : "Assistant is live");
      }
    } catch (e) {
      toast("err", e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  const bot = data.chatbots[0];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Chatbot</h1>
          <p className="desc">Configure your assistant's identity and behaviour.</p>
        </div>
        {bot && (
          <Badge tone={bot.active !== false ? "on" : "off"}>{bot.active !== false ? "Live" : "Paused"}</Badge>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <button className={`btn ${tab === "settings" ? "" : "secondary"} sm`} onClick={() => setTab("settings")}>
          Settings
        </button>
        <button className={`btn ${tab === "install" ? "" : "secondary"} sm`} onClick={() => setTab("install")}>
          Install
        </button>
      </div>

      {tab === "settings" && (
        <Card>
          <Field label="Assistant name">
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Assistant header message" hint="Shown under the chatbot title in the widget header (separate from the welcome message in the chat body).">
            <textarea value={assistantHeader} onChange={(e) => setAssistantHeader(e.target.value)} />
          </Field>
          <Field label="Welcome message" hint="Shown as the first message in the chat body when a customer opens the widget.">
            <textarea value={welcome} onChange={(e) => setWelcome(e.target.value)} />
          </Field>
          <Field label="Personality / tone">
            <input type="text" value={tone} onChange={(e) => setTone(e.target.value)} placeholder="friendly, professional…" />
          </Field>
          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
            <button className="btn" disabled={busy} onClick={save}>Save changes</button>
            <button className="btn secondary" disabled={busy} onClick={toggleActive}>
              {active !== false ? "Pause assistant" : "Activate assistant"}
            </button>
          </div>
        </Card>
      )}

      {tab === "install" && (
        <Card>
          <h3 style={{ margin: "0 0 6px", fontSize: 15 }}>Embed on your website</h3>
          <p className="muted" style={{ margin: "0 0 12px" }}>
            Paste this before the closing <code>&lt;/body&gt;</code> tag on every page where the assistant should
            appear.
          </p>
          <div className="codeblock">{data.embedScript}</div>
          <p className="muted" style={{ marginTop: 12 }}>
            The widget loads your store's products, knowledge and policies automatically. The snippet uses an opaque public chatbot ID and does not expose your internal tenant name or Supabase project URL.
            No other configuration needed.
          </p>
        </Card>
      )}
    </>
  );
}