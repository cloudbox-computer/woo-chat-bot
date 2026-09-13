import React from "react";
import { getAudit, type AuditItem } from "../lib/api";

export default function AuditPage({ tenantId }: { tenantId: string }) {
  const [items, setItems] = React.useState<AuditItem[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setItems([]);
    setError(null);
    getAudit(tenantId)
      .then((r) => { if (!cancelled) setItems(r.items); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load audit log"); });
    return () => { cancelled = true; };
  }, [tenantId]);

  return <div className="page">
    <div className="page-head"><div><h1>Audit log</h1><p className="desc">Security and administrative changes for this workspace.</p></div></div>
    {error && <div className="err">{error}</div>}
    <div className="card table-card">
      {items.length === 0 ? <div className="empty-state compact"><div className="empty-state-icon">⌁</div><h3>No audit events yet</h3><p>Security and administrative changes will appear here.</p></div> : <table><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Resource</th></tr></thead><tbody>{items.map(i=><tr key={i.id}><td className="table-nowrap muted">{new Date(i.created_at).toLocaleString()}</td><td>{i.actor_email||"system"}</td><td><code className="code-pill">{i.action}</code></td><td>{i.resource_type}{i.resource_id?` · ${i.resource_id}`:""}</td></tr>)}</tbody></table>}
    </div>
  </div>;
}
