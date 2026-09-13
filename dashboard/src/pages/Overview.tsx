import React from "react";
import { getOverview, getTranscript, sendAgentMessage, setConversationMode, getBilling, getIntegrations, type BillingState, type IntegrationItem, type ConfigData, type OverviewData } from "../lib/api";
import { Card, Spinner, ErrorBox, Badge } from "../components/ui";

export default function Overview({ tenantId, config, onNavigate }: { tenantId: string; config: ConfigData | null; onNavigate?: (page: "chatbot"|"integrations"|"billing") => void }) {
  const [data, setData] = React.useState<OverviewData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [transcript, setTranscript] = React.useState<{conversation:Record<string,unknown>;messages:Array<Record<string,unknown>>}|null>(null);
  const [agentText,setAgentText]=React.useState("");
  const [billing,setBilling]=React.useState<BillingState|null>(null);
  const [integrations,setIntegrations]=React.useState<IntegrationItem[]>([]);

  React.useEffect(() => {
    setData(null);
    setError(null);
    getOverview(tenantId).then(setData).catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
    getBilling(tenantId).then((r)=>setBilling(r.billing)).catch(()=>setBilling(null));
    getIntegrations(tenantId).then((r)=>setIntegrations(r.items)).catch(()=>setIntegrations([]));
  }, [tenantId]);

  if (error) return <ErrorBox message={error} />;

  const stats = data
    ? [
        { label: "Conversations", value: data.conversations, tone: "text" },
        { label: "Support tickets", value: data.tickets, tone: "text" },
        { label: "Open tickets", value: data.openTickets, tone: "amber" },
        { label: "Chat requests", value: data.usage, tone: "text" },
        ...(config?.entitlements.fullAnalytics ? [{ label: "Feedback received", value: data.feedback ?? 0, tone: "text" }] : []),
      ]
    : null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p className="desc">{config?.tenant ? `Welcome back, ${config.tenant.name}.` : "Your assistant at a glance."}</p>
        </div>
      </div>

      {!data && !error && <Spinner />}

      {config?.tenant && (
        <Card className="overview-setup-card">
          <div className="overview-setup-head">
            <div><h3>Finish setup</h3><p className="muted">Your workspace is ready. Complete these steps to start serving customers.</p></div>
            {billing && <Badge tone={billing.status === "active" || billing.status === "trialing" ? "resolved" : "in_progress"}>{billing.status === "trialing" ? "14-day trial active" : billing.status === "active" ? `${billing.plan} plan active` : "Billing needs attention"}</Badge>}
          </div>
          <div className="setup-grid">
            <button className="setup-step done" type="button" onClick={()=>onNavigate?.("chatbot")}><span>✓</span><div><b>Business & assistant</b><small>Configured</small></div></button>
            <button className={`setup-step ${integrations.some(i=>i.active&&i.configured)?"done":""}`} type="button" onClick={()=>onNavigate?.("integrations")}><span>{integrations.some(i=>i.active&&i.configured)?"✓":"2"}</span><div><b>Connect integrations</b><small>{config?.entitlements.liveIntegrations ? (integrations.some(i=>i.active&&i.configured)?`${integrations.filter(i=>i.active&&i.configured).length} connected`:"Optional — connect your systems") : "Growth unlocks WooCommerce & Supabase"}</small></div></button>
            <button className={`setup-step ${billing && ["active","trialing"].includes(billing.status)?"done":""}`} type="button" onClick={()=>onNavigate?.("billing")}><span>{billing && ["active","trialing"].includes(billing.status)?"✓":"3"}</span><div><b>Plan & billing</b><small>{billing?.status === "trialing"?"Free trial active":billing?.status === "active"?`${billing.plan} active`:"Complete subscription"}</small></div></button>
            <button className="setup-step" type="button" onClick={()=>onNavigate?.("chatbot")}><span>4</span><div><b>Install website widget</b><small>Copy your unique embed snippet</small></div></button>
          </div>
          {billing && <div className="usage-strip"><div><small>PLAN</small><b>{billing.plan === "unsubscribed"?"—":billing.plan}</b></div><div><small>CONVERSATIONS THIS MONTH</small><b>{billing.conversationsUsed.toLocaleString()} / {billing.conversationLimit.toLocaleString()}</b></div><div><small>INTEGRATIONS</small><b>{integrations.filter(i=>i.active&&i.configured).length} connected</b></div></div>}
        </Card>
      )}

      {stats && (
        <div className="grid cols-4 overview-stats">
          {stats.map((s) => (
            <Card key={s.label}>
              <div className="stat">
                <div className="value" style={s.tone === "amber" ? { color: "var(--amber)" } : undefined}>
                  {s.value}
                </div>
                <div className="label">{s.label}</div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <div className="section-head compact"><div><h2>Recent conversations</h2><p>Latest customer conversations across your widget.</p></div></div>
        {data && data.recentConversations.length === 0 && (
          <div className="empty">No conversations yet. Install the widget and your customers will appear here.</div>
        )}
        {data && data.recentConversations.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Customer</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {data.recentConversations.map((c) => (
                <tr key={c.id} className="clickable-row" onClick={() => getTranscript(tenantId,c.id).then(setTranscript)}>
                  <td>{c.title}</td>
                  <td>
                    {c.customerEmail ?? <span className="muted">—</span>}
                    {c.emailConsent ? (
                      <span
                        className="consent-note"
                        title="Customer consented to store their email (GDPR)"
                      >
                        consent ✓
                      </span>
                    ) : null}
                  </td>
                  <td className="muted">{c.createdAt ? new Date(c.createdAt).toLocaleString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data && data.openTickets > 0 && (
          <div className="card-footer-note">
            <Badge tone="in_progress">{data.openTickets} open ticket(s) need attention</Badge>
          </div>
        )}
      </Card>

      {transcript && (
        <div className="modal-overlay" onClick={() => setTranscript(null)}>
          <div className="modal transcript-modal" onClick={(e)=>e.stopPropagation()}>
            <div className="modal-head"><div><h2>Conversation transcript</h2><p>Review the conversation or take over from the AI.</p></div><button className="icon-button" aria-label="Close transcript" onClick={()=>setTranscript(null)}>×</button></div>
            <div className="transcript-meta">{String(transcript.conversation.title ?? "Conversation")} · mode: <b>{String(transcript.conversation.control_mode ?? "ai")}</b></div>
            {config?.entitlements.humanTakeover ? <div className="transcript-actions">
              <button className="btn secondary" onClick={async()=>{await setConversationMode(tenantId,String(transcript.conversation.id),"human");setTranscript(await getTranscript(tenantId,String(transcript.conversation.id)))}}>Take over</button>
              <button className="btn ghost" onClick={async()=>{await setConversationMode(tenantId,String(transcript.conversation.id),"ai");setTranscript(await getTranscript(tenantId,String(transcript.conversation.id)))}}>Return to AI</button>
            </div> : <div className="info-banner">Human takeover is available on Growth and Scale.</div>}
            {transcript.messages.map((m)=><div key={String(m.id)} className={`transcript-message ${String(m.source ?? m.role)}`}>
              <div className="transcript-message-role">{String(m.source ?? m.role)}</div><div className="transcript-message-body">{String(m.content)}</div><div className="transcript-message-time">{new Date(String(m.created_at)).toLocaleString()}</div>
            </div>)}
            {config?.entitlements.humanTakeover && String(transcript.conversation.control_mode ?? "ai") === "human" && <div className="transcript-reply"><input className="input" placeholder="Reply as agent…" value={agentText} onChange={e=>setAgentText(e.target.value)} onKeyDown={async e=>{if(e.key==="Enter"&&agentText.trim()){await sendAgentMessage(tenantId,String(transcript.conversation.id),agentText.trim());setAgentText("");setTranscript(await getTranscript(tenantId,String(transcript.conversation.id)))}}}/><button className="btn primary" onClick={async()=>{if(!agentText.trim())return;await sendAgentMessage(tenantId,String(transcript.conversation.id),agentText.trim());setAgentText("");setTranscript(await getTranscript(tenantId,String(transcript.conversation.id)))}}>Send</button></div>}
          </div>
        </div>
      )}
    </>
  );
}
