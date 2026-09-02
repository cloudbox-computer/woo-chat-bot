import React from "react";
import { getOverview, getTranscript, sendAgentMessage, setConversationMode, type ConfigData, type OverviewData } from "../lib/api";
import { Card, Spinner, ErrorBox, Badge } from "../components/ui";

export default function Overview({ tenantId, config }: { tenantId: string; config: ConfigData | null }) {
  const [data, setData] = React.useState<OverviewData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [transcript, setTranscript] = React.useState<{conversation:Record<string,unknown>;messages:Array<Record<string,unknown>>}|null>(null);
  const [agentText,setAgentText]=React.useState("");

  React.useEffect(() => {
    setData(null);
    setError(null);
    getOverview(tenantId).then(setData).catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [tenantId]);

  if (error) return <ErrorBox message={error} />;

  const stats = data
    ? [
        { label: "Conversations", value: data.conversations, tone: "text" },
        { label: "Support tickets", value: data.tickets, tone: "text" },
        { label: "Open tickets", value: data.openTickets, tone: "amber" },
        { label: "Chat requests", value: data.usage, tone: "text" },
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

      {stats && (
        <div className="grid cols-4" style={{ marginBottom: 24 }}>
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
        <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>Recent conversations</h3>
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
                <tr key={c.id} style={{cursor:"pointer"}} onClick={() => getTranscript(tenantId,c.id).then(setTranscript)}>
                  <td>{c.title}</td>
                  <td>
                    {c.customerEmail ?? <span className="muted">—</span>}
                    {c.emailConsent ? (
                      <span
                        className="muted"
                        style={{ display: "block", fontSize: 11 }}
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
          <div style={{ marginTop: 12 }}>
            <Badge tone="in_progress">{data.openTickets} open ticket(s) need attention</Badge>
          </div>
        )}
      </Card>

      {transcript && (
        <div className="modal-overlay" onClick={() => setTranscript(null)}>
          <div className="modal" style={{maxWidth:760,maxHeight:"80vh",overflow:"auto"}} onClick={(e)=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",gap:12}}><h2>Conversation transcript</h2><button className="btn ghost" onClick={()=>setTranscript(null)}>Close</button></div>
            <div className="muted" style={{marginBottom:12}}>{String(transcript.conversation.title ?? "Conversation")} · mode: <b>{String(transcript.conversation.control_mode ?? "ai")}</b></div>
            <div style={{display:"flex",gap:8,marginBottom:12}}>
              <button className="btn secondary" onClick={async()=>{await setConversationMode(tenantId,String(transcript.conversation.id),"human");setTranscript(await getTranscript(tenantId,String(transcript.conversation.id)))}}>Take over</button>
              <button className="btn ghost" onClick={async()=>{await setConversationMode(tenantId,String(transcript.conversation.id),"ai");setTranscript(await getTranscript(tenantId,String(transcript.conversation.id)))}}>Return to AI</button>
            </div>
            {transcript.messages.map((m)=><div key={String(m.id)} style={{padding:"10px 12px",border:"1px solid var(--border)",borderRadius:10,marginBottom:8}}>
              <div style={{fontSize:11,fontWeight:700,textTransform:"uppercase"}}>{String(m.source ?? m.role)}</div><div style={{whiteSpace:"pre-wrap"}}>{String(m.content)}</div><div className="muted" style={{fontSize:11,marginTop:6}}>{new Date(String(m.created_at)).toLocaleString()}</div>
            </div>)}
            {String(transcript.conversation.control_mode ?? "ai") === "human" && <div style={{display:"flex",gap:8,marginTop:12}}><input className="input" placeholder="Reply as agent…" value={agentText} onChange={e=>setAgentText(e.target.value)} onKeyDown={async e=>{if(e.key==="Enter"&&agentText.trim()){await sendAgentMessage(tenantId,String(transcript.conversation.id),agentText.trim());setAgentText("");setTranscript(await getTranscript(tenantId,String(transcript.conversation.id)))}}}/><button className="btn primary" onClick={async()=>{if(!agentText.trim())return;await sendAgentMessage(tenantId,String(transcript.conversation.id),agentText.trim());setAgentText("");setTranscript(await getTranscript(tenantId,String(transcript.conversation.id)))}}>Send</button></div>}
          </div>
        </div>
      )}
    </>
  );
}
