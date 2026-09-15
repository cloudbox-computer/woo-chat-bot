import React from "react";
import {
  createAssistant,
  deleteAssistant,
  getConfig,
  updateConfig,
  type ChatbotInfo,
  type ConfigData,
} from "../lib/api";
import { Card, Field, Spinner, ErrorBox, Badge, toast } from "../components/ui";

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String).filter(Boolean) : [];
}

export default function ChatbotPage({ tenantId, config, onConfigChange, onUpgrade, onNavigate }: {
  tenantId: string;
  config: ConfigData | null;
  onConfigChange: (c: ConfigData) => void;
  onUpgrade?: () => void;
  onNavigate?: (page: string) => void;
}) {
  const [data, setData] = React.useState<ConfigData | null>(config);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<"settings" | "install">("settings");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [newName, setNewName] = React.useState("");

  const [name, setName] = React.useState("");
  const [welcome, setWelcome] = React.useState("");
  const [assistantHeader, setAssistantHeader] = React.useState("");
  const [tone, setTone] = React.useState("");
  const [allowedTopicsText, setAllowedTopicsText] = React.useState("");
  const [refusalMessage, setRefusalMessage] = React.useState("");
  const [quickActionsText, setQuickActionsText] = React.useState("");
  const [securityLevel, setSecurityLevel] = React.useState<"standard" | "strict" | "extra-strict">("strict");
  const [brandColour, setBrandColour] = React.useState("");

  async function refresh(preferId?: string) {
    const fresh = await getConfig(tenantId);
    setData(fresh);
    onConfigChange(fresh);
    const nextId = preferId && fresh.chatbots.some((b) => b.id === preferId)
      ? preferId
      : fresh.chatbots.some((b) => b.id === selectedId)
        ? selectedId
        : fresh.chatbots[0]?.id ?? null;
    setSelectedId(nextId);
    return fresh;
  }

  React.useEffect(() => {
    setData(config);
    setError(null);
    setSelectedId(config?.chatbots?.[0]?.id ?? null);
    if (!config) refresh().catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [tenantId]);

  React.useEffect(() => {
    if (config) setData(config);
  }, [config]);

  const bot = data?.chatbots.find((b) => b.id === selectedId) ?? data?.chatbots[0] ?? null;

  React.useEffect(() => {
    if (!data || !bot) return;
    const cfg = bot.config ?? {};
    setName(bot.name);
    setWelcome(typeof cfg.welcome === "string" ? cfg.welcome : data.tenant.welcomeMessage ?? "");
    setAssistantHeader(typeof cfg.assistantHeaderMessage === "string" ? cfg.assistantHeaderMessage : data.tenant.assistantHeaderMessage ?? "");
    setTone(typeof cfg.tone === "string" ? cfg.tone : data.tenant.tone ?? "");
    setAllowedTopicsText((strings(cfg.allowedTopics).length ? strings(cfg.allowedTopics) : data.tenant.allowedTopics).join("\n"));
    setRefusalMessage(typeof cfg.refusalMessage === "string" ? cfg.refusalMessage : data.tenant.refusalMessage ?? "");
    const level = cfg.securityLevel;
    setSecurityLevel(level === "standard" || level === "extra-strict" ? level : data.tenant.securityLevel ?? "strict");
    setBrandColour(typeof cfg.brandColour === "string" ? cfg.brandColour : data.tenant.brandColour ?? "");
    const actions = Array.isArray(cfg.quickActions) ? cfg.quickActions : [];
    setQuickActionsText(actions.map((item) => {
      if (typeof item === "string") return item;
      if (!item || typeof item !== "object") return "";
      const row = item as Record<string, unknown>;
      const label = typeof row.label === "string" ? row.label : "";
      const prompt = typeof row.prompt === "string" ? row.prompt : label;
      return label && prompt !== label ? `${label} | ${prompt}` : label;
    }).filter(Boolean).join("\n"));
  }, [bot?.id, data?.tenant.id]);

  if (error) return <ErrorBox message={error} />;
  if (!data) return <Spinner />;

  const activeCount = data.chatbots.filter((b) => b.active).length;
  const max = data.entitlements.maxAssistants;

  async function save() {
    if (!bot) return;
    setBusy(true);
    try {
      const quickActions = quickActionsText.split(/\r?\n/).map((line) => {
        const [rawLabel, ...rest] = line.split("|");
        const label = rawLabel.trim();
        const prompt = rest.join("|").trim() || label;
        return { label, prompt };
      }).filter((x) => x.label).slice(0, 8);
      await updateConfig(tenantId, {
        chatbotId: bot.id,
        chatbotName: name,
        chatbot: {
          welcome,
          assistantHeaderMessage: assistantHeader,
          tone,
          allowedTopics: allowedTopicsText.split(/\r?\n/).map((x) => x.trim()).filter(Boolean),
          refusalMessage,
          securityLevel,
          brandColour,
          quickActions,
        },
      });
      await refresh(bot.id);
      toast("ok", "Assistant saved");
    } catch (e) {
      toast("err", e instanceof Error ? e.message : "Save failed");
    } finally { setBusy(false); }
  }

  async function toggleActive() {
    if (!bot) return;
    if (!bot.active && activeCount >= max) {
      toast("err", `Your ${data.entitlements.plan} plan allows ${max} active AI assistant${max === 1 ? "" : "s"}. Pause another assistant or upgrade.`);
      return;
    }
    setBusy(true);
    try {
      await updateConfig(tenantId, { chatbotId: bot.id, botActive: !bot.active });
      await refresh(bot.id);
      toast("ok", bot.active ? "Assistant paused" : "Assistant activated");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Update failed";
      toast("err", message);
    } finally { setBusy(false); }
  }

  async function addAssistant() {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const created = await createAssistant(tenantId, newName.trim());
      setCreating(false);
      setNewName("");
      await refresh(created.item.id);
      toast("ok", "AI assistant created");
    } catch (e) {
      toast("err", e instanceof Error ? e.message : "Could not create assistant");
    } finally { setBusy(false); }
  }

  async function removeAssistant() {
    if (!bot || !confirm(`Delete ${bot.name}? Its conversations and knowledge will also be removed.`)) return;
    setBusy(true);
    try {
      await deleteAssistant(tenantId, bot.id);
      await refresh();
      toast("ok", "Assistant deleted");
    } catch (e) {
      toast("err", e instanceof Error ? e.message : "Delete failed");
    } finally { setBusy(false); }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Assistants</h1>
          <p className="desc">Choose what your assistant knows, what it can do and where customers can reach it.</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Badge tone={activeCount < max ? "on" : "off"}>{activeCount} of {max} active</Badge>
          <button className="btn" onClick={() => activeCount < max ? setCreating(true) : onUpgrade?.()}>
            {activeCount < max ? "+ Create AI Assistant" : "Upgrade for more"}
          </button>
        </div>
      </div>

      <div className="assistant-journey" aria-label="Assistant setup">
        <button className="journey-step active" onClick={()=>setTab("settings")}><span>1</span><div><b>Behaviour</b><small>Name, tone & boundaries</small></div></button>
        <button className="journey-step" onClick={()=>onNavigate?.("procedures")}><span>2</span><div><b>Workflows</b><small>Teach repeatable jobs</small></div></button>
        <button className="journey-step" onClick={()=>onNavigate?.("widgets")}><span>3</span><div><b>Chat experience</b><small>Cards, forms & booking</small></div></button>
        <button className="journey-step" onClick={()=>onNavigate?.("testing")}><span>4</span><div><b>Test</b><small>Check before customers do</small></div></button>
        <button className="journey-step" onClick={()=>onNavigate?.("channels")}><span>5</span><div><b>Deploy</b><small>Website & other channels</small></div></button>
      </div>

      {creating && (
        <Card style={{ marginBottom: 18 }}>
          <Field label="Assistant name" hint="For example: Sales Assistant, Payroll Assistant, Support Assistant.">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
          </Field>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" disabled={busy || !newName.trim()} onClick={addAssistant}>Create assistant</button>
            <button className="btn secondary" onClick={() => setCreating(false)}>Cancel</button>
          </div>
        </Card>
      )}

      <div className="assistant-layout">
        <Card className="assistant-list-card">
          <div className="assistant-list-title">Assistants</div>
          <div className="assistant-list">
            {data.chatbots.map((item) => (
              <button key={item.id} className={`assistant-row ${item.id === bot?.id ? "active" : ""}`} onClick={() => setSelectedId(item.id)}>
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.publicId ?? item.id}</small>
                </span>
                <Badge tone={item.active ? "on" : "off"}>{item.active ? "Live" : "Paused"}</Badge>
              </button>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 12 }}>
            Your {data.entitlements.plan} plan allows {max} active AI assistant{max === 1 ? "" : "s"} in this workspace.
          </div>
        </Card>

        <div>
          {bot ? <>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <button className={`btn ${tab === "settings" ? "" : "secondary"} sm`} onClick={() => setTab("settings")}>Settings</button>
              <button className={`btn ${tab === "install" ? "" : "secondary"} sm`} onClick={() => setTab("install")}>Website install</button>
            </div>

            {tab === "settings" && <Card>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 18 }}>
                <div><h3 style={{ margin: 0 }}>{bot.name}</h3><div className="muted" style={{ fontSize: 12 }}>{bot.publicId}</div></div>
                <Badge tone={bot.active ? "on" : "off"}>{bot.active ? "Live" : "Paused"}</Badge>
              </div>
              <Field label="Assistant name"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Field label="Assistant header message"><textarea value={assistantHeader} onChange={(e) => setAssistantHeader(e.target.value)} /></Field>
              <Field label="Welcome message"><textarea value={welcome} onChange={(e) => setWelcome(e.target.value)} /></Field>
              <Field label="How should it sound?"><input value={tone} onChange={(e) => setTone(e.target.value)} /></Field>
              <Field label="What can it help with?" hint="One topic per line, for example: delivery, returns, products, appointments.">
                <textarea value={allowedTopicsText} onChange={(e) => setAllowedTopicsText(e.target.value)} />
              </Field>
              <Field label="When it cannot help"><textarea value={refusalMessage} onChange={(e) => setRefusalMessage(e.target.value)} /></Field>
              <Field label="Chat colour" hint="Choose the colour customers see in chat."><input value={brandColour} onChange={(e) => setBrandColour(e.target.value)} placeholder="#7c3aed" /></Field>
              <Field label="How tightly should it stay on topic?">
                <select value={securityLevel} onChange={(e) => setSecurityLevel(e.target.value as typeof securityLevel)}>
                  <option value="standard">Standard</option><option value="strict">Strict</option><option value="extra-strict">Extra strict</option>
                </select>
              </Field>
              <Field label="Conversation starters" hint="One per line, for example: Track my order or Book an appointment.">
                <textarea value={quickActionsText} onChange={(e) => setQuickActionsText(e.target.value)} />
              </Field>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="btn" disabled={busy} onClick={save}>Save changes</button>
                <button className="btn secondary" disabled={busy} onClick={toggleActive}>{bot.active ? "Pause assistant" : "Activate assistant"}</button>
                {data.chatbots.length > 1 && <button className="btn secondary danger-soft" disabled={busy} onClick={removeAssistant}>Delete assistant</button>}
              </div>
            </Card>}

            {tab === "install" && <Card>
              <h3 style={{ margin: "0 0 8px" }}>Install {bot.name}</h3>
              <p className="muted">This embed code is unique to this assistant. Other assistants in the workspace have different public IDs and snippets.</p>
              <div className="codeblock">{bot.embedScript ?? data.embedScript}</div>
            </Card>}
          </> : <Card>No assistants yet.</Card>}
        </div>
      </div>
    </>
  );
}
