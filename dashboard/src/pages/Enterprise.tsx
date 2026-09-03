import React from "react";
import { getEnterprise, submitGdpr, updateEnterprise, type EnterpriseSettings } from "../lib/api";

export default function EnterprisePage({tenantId}:{tenantId:string}) {
  const[s,setS]=React.useState<EnterpriseSettings>({});
  const[origins,setOrigins]=React.useState("");
  const[email,setEmail]=React.useState("");
  const[msg,setMsg]=React.useState("");
  const[error,setError]=React.useState<string|null>(null);
  React.useEffect(()=>{
    let cancelled=false;
    setS({}); setOrigins(""); setMsg(""); setError(null);
    getEnterprise(tenantId).then(r=>{if(!cancelled){setS(r.settings);setOrigins((r.settings.allowed_origins||[]).join("\n"))}}).catch(e=>{if(!cancelled)setError(e instanceof Error?e.message:"Failed to load enterprise controls")});
    return()=>{cancelled=true};
  },[tenantId]);
  async function save(){try{setError(null);await updateEnterprise(tenantId,{allowedOrigins:origins.split(/\n|,/).map(x=>x.trim()).filter(Boolean),retentionDays:s.retention_days,monthlyRequestLimit:s.monthly_request_limit,monthlyTokenLimit:s.monthly_token_limit,dataRegion:s.data_region,featureFlags:s.feature_flags||{}});setMsg("Saved")}catch(e){setError(e instanceof Error?e.message:"Save failed")}}
  return <div className="page"><h1>Enterprise controls</h1><p className="desc">Origin restrictions, retention, quotas and data-subject administration.</p>{error&&<div className="err">{error}</div>}{msg&&<div className="ok">{msg}</div>}<div className="card"><label>Allowed widget origins (one per line)</label><textarea className="input" rows={5} value={origins} onChange={e=>setOrigins(e.target.value)} placeholder="https://example.com"/><label>Retention days</label><input className="input" type="number" value={s.retention_days??365} onChange={e=>setS({...s,retention_days:Number(e.target.value)})}/><label>Monthly request limit</label><input className="input" type="number" value={s.monthly_request_limit??100000} onChange={e=>setS({...s,monthly_request_limit:Number(e.target.value)})}/><label>Monthly token limit</label><input className="input" type="number" value={s.monthly_token_limit??10000000} onChange={e=>setS({...s,monthly_token_limit:Number(e.target.value)})}/><button className="btn primary" onClick={save}>Save enterprise controls</button></div><div className="card"><h2>GDPR data subject request</h2><input className="input" placeholder="customer@example.com" value={email} onChange={e=>setEmail(e.target.value)}/><div style={{display:"flex",gap:8,marginTop:8}}><button className="btn ghost" onClick={async()=>{try{setError(null);const r=await submitGdpr(tenantId,email,"export");setMsg(`Export request ${r.requestId} completed`)}catch(e){setError(e instanceof Error?e.message:"Export failed")}}}>Export</button><button className="btn ghost" onClick={async()=>{if(confirm("Erase matching personal data?")){try{setError(null);const r=await submitGdpr(tenantId,email,"erase");setMsg(`Erase request ${r.requestId} completed`)}catch(e){setError(e instanceof Error?e.message:"Erase failed")}}}}>Erase</button></div></div></div>;
}
