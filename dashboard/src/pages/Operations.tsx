import React from "react";
import { getOperations } from "../lib/api";

export default function OperationsPage({tenantId}:{tenantId:string}) {
  const [data,setData]=React.useState<{health:Array<Record<string,unknown>>;jobs:Array<Record<string,unknown>>;usage:Record<string,unknown>}|null>(null);
  const [error,setError]=React.useState<string|null>(null);
  React.useEffect(()=>{
    let cancelled=false;
    setData(null); setError(null);
    getOperations(tenantId).then((next)=>{if(!cancelled)setData(next)}).catch((e)=>{if(!cancelled)setError(e instanceof Error?e.message:"Failed to load operations")});
    return()=>{cancelled=true};
  },[tenantId]);
  return <div className="page">
    <div className="page-head"><div><h1>Operations</h1><p className="desc">Integration health, background jobs and workspace usage telemetry.</p></div></div>
    {error&&<div className="err">{error}</div>}
    <div className="grid cols-2 operations-grid">
      <div className="card"><div className="section-head"><div><h2>Integration health</h2><p>Latest provider connectivity checks.</p></div></div>{!data?.health.length?<div className="empty-state compact"><div className="empty-state-icon">↗</div><h3>No health checks yet</h3><p>Connection health appears after integrations are tested.</p></div>:<div className="status-list">{data.health.map((h,i)=><div className="status-row" key={i}><div><strong>{String(h.provider)}</strong><small>{h.checked_at?new Date(String(h.checked_at)).toLocaleString():"Not checked"}</small></div><span className={`status-dot ${String(h.status).toLowerCase()==="ok"||String(h.status).toLowerCase()==="healthy"?"healthy":"warning"}`}>{String(h.status)}</span></div>)}</div>}</div>
      <div className="card"><div className="section-head"><div><h2>Background jobs</h2><p>Queue activity and retry status.</p></div></div>{!data?.jobs.length?<div className="empty-state compact"><div className="empty-state-icon">✓</div><h3>Queue is clear</h3><p>There are no queued background jobs.</p></div>:<div className="status-list">{data.jobs.map((j,i)=><div className="status-row" key={i}><div><code className="code-pill">{String(j.kind)}</code><small>Attempts {String(j.attempts)}</small></div><span className="badge neutral">{String(j.status)}</span></div>)}</div>}</div>
    </div>
  </div>;
}
