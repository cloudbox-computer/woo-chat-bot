import React from "react";
import { createSecurityIncident, getEnterprise, listSecurityIncidents, submitGdpr, updateEnterprise, updateSecurityIncident, type EnterpriseSettings, type SecurityIncidentItem } from "../lib/api";
import { Card, Field, Badge, toast } from "../components/ui";
import MfaGate from "../components/MfaGate";
import { supabase } from "../lib/supabase";

function lines(value?:string[]){return (value??[]).join("\n")}
function parseLines(value:string){return value.split(/\n|,/).map(v=>v.trim()).filter(Boolean)}

export default function EnterprisePage({tenantId}:{tenantId:string}) {
  const[s,setS]=React.useState<EnterpriseSettings>({});
  const[origins,setOrigins]=React.useState("");
  const[ipRules,setIpRules]=React.useState("");
  const[email,setEmail]=React.useState("");
  const[loading,setLoading]=React.useState(true);
  const[saving,setSaving]=React.useState(false);
  const[error,setError]=React.useState<string|null>(null);
  const[incidents,setIncidents]=React.useState<SecurityIncidentItem[]>([]);
  const[incidentTitle,setIncidentTitle]=React.useState("");
  const[incidentDescription,setIncidentDescription]=React.useState("");
  const[incidentSeverity,setIncidentSeverity]=React.useState<SecurityIncidentItem["severity"]>("warning");

  const load=React.useCallback(async()=>{setLoading(true);try{const [r,ir]=await Promise.all([getEnterprise(tenantId),listSecurityIncidents(tenantId)]);setS(r.settings);setIncidents(ir.items);setOrigins(lines(r.settings.allowed_origins));setIpRules(lines(r.settings.ip_allowlist));setError(null)}catch(e){setError(e instanceof Error?e.message:"Failed to load enterprise controls")}finally{setLoading(false)}},[tenantId]);
  React.useEffect(()=>{void load()},[load]);

  async function save(extra:Record<string,unknown>={}){
    setSaving(true);setError(null);
    try{
      await updateEnterprise(tenantId,{
        allowedOrigins:parseLines(origins),retentionDays:s.retention_days,monthlyRequestLimit:s.monthly_request_limit,monthlyTokenLimit:s.monthly_token_limit,dataRegion:s.data_region,featureFlags:s.feature_flags||{},
        zeroDataRetention:s.zero_data_retention===true,storeConversations:s.store_conversations!==false,piiRedactionEnabled:s.pii_redaction_enabled!==false,modelTrainingOptOut:s.model_training_opt_out!==false,
        ipAllowlist:parseLines(ipRules),incidentContactEmail:s.incident_contact_email??"",securityContactEmail:s.security_contact_email??"",...extra,
      });
      toast("ok","Enterprise controls saved");await load();
    }catch(e){setError(e instanceof Error?e.message:"Save failed");}
    finally{setSaving(false)}
  }
  async function setMfaRequired(value:boolean){setSaving(true);try{await updateEnterprise(tenantId,{mfaRequired:value});toast("ok",value?"Workspace MFA requirement enabled":"Workspace MFA requirement disabled");await load()}catch(e){setError(e instanceof Error?e.message:"MFA update failed")}finally{setSaving(false)}}
  async function setHipaaMode(value:boolean){setSaving(true);try{await updateEnterprise(tenantId,{hipaaMode:value});toast("ok",value?"HIPAA mode enabled":"HIPAA mode disabled");await load()}catch(e){setError(e instanceof Error?e.message:"HIPAA update failed")}finally{setSaving(false)}}
  async function requestBaa(){setSaving(true);try{await updateEnterprise(tenantId,{requestHipaaBaa:true});toast("ok","BAA request recorded");await load()}catch(e){setError(e instanceof Error?e.message:"Could not request BAA")}finally{setSaving(false)}}
  async function revokeOtherSessions(){setSaving(true);try{const {error}=await supabase.auth.signOut({scope:"others"});if(error)throw error;toast("ok","Other sessions revoked")}catch(e){setError(e instanceof Error?e.message:"Could not revoke sessions")}finally{setSaving(false)}}
  async function reportIncident(){if(!incidentTitle.trim())return;setSaving(true);try{await createSecurityIncident(tenantId,{title:incidentTitle.trim(),description:incidentDescription.trim(),severity:incidentSeverity});setIncidentTitle("");setIncidentDescription("");toast("ok","Security incident recorded");await load()}catch(e){setError(e instanceof Error?e.message:"Could not record incident")}finally{setSaving(false)}}
  async function setIncidentStatus(id:string,status:SecurityIncidentItem["status"]){setSaving(true);try{await updateSecurityIncident(tenantId,id,{status});await load();toast("ok","Incident status updated")}catch(e){setError(e instanceof Error?e.message:"Could not update incident")}finally{setSaving(false)}}

  if(loading)return <div className="page"><div className="muted">Loading enterprise controls…</div></div>;
  return <div className="page enterprise-page">
    <div className="page-head"><div><h1>Security & compliance</h1><p className="desc">Technical controls for privacy, retention, access and regulated-workload readiness.</p></div><Badge tone="warn">Controls ≠ certification</Badge></div>
    {error&&<div className="err">{error}</div>}
    <div className="info-banner compliance-note"><strong>Compliance status:</strong> these controls support GDPR/SOC 2/HIPAA programmes, but they do not by themselves make ZoChat SOC 2 certified or HIPAA compliant. SOC 2 requires an independent audit; HIPAA mode is blocked until a BAA is recorded as signed.</div>

    <div className="enterprise-grid">
      <Card><h2>Data retention</h2><p className="desc">Control what ZoChat keeps in its own conversation store.</p>
        <Field label="Retention period (days)"><input className="input" type="number" min={1} max={3650} value={s.retention_days??365} disabled={s.zero_data_retention===true} onChange={e=>setS(v=>({...v,retention_days:Number(e.target.value)}))}/></Field>
        <label className="check-row"><input type="checkbox" checked={s.store_conversations!==false&&!s.zero_data_retention} disabled={s.zero_data_retention===true} onChange={e=>setS(v=>({...v,store_conversations:e.target.checked}))}/><span><strong>Store conversations</strong><small>Disable to keep chat responses transient.</small></span></label>
        <label className="check-row"><input type="checkbox" checked={s.zero_data_retention===true} onChange={e=>setS(v=>({...v,zero_data_retention:e.target.checked,store_conversations:e.target.checked?false:v.store_conversations}))}/><span><strong>Zero Data Retention mode</strong><small>New chat transcripts and customer-session state are not stored; maintenance removes existing conversation data.</small></span></label>
        <label className="check-row"><input type="checkbox" checked={s.pii_redaction_enabled!==false} onChange={e=>setS(v=>({...v,pii_redaction_enabled:e.target.checked}))}/><span><strong>PII redaction for stored messages</strong><small>Redacts common personal identifiers before persistence.</small></span></label>
        <label className="check-row"><input type="checkbox" checked={s.model_training_opt_out!==false} onChange={e=>setS(v=>({...v,model_training_opt_out:e.target.checked}))}/><span><strong>Model training opt-out policy</strong><small>Records the workspace requirement; your selected AI provider contract must also support it.</small></span></label>
      </Card>

      <Card><h2>Network & widget access</h2><p className="desc">Restrict where the dashboard and public widget can be used.</p>
        <Field label="Allowed widget origins" hint="One HTTPS origin per line, e.g. https://example.com"><textarea className="input" rows={5} value={origins} onChange={e=>setOrigins(e.target.value)} placeholder="https://example.com"/></Field>
        <Field label="Dashboard IP allowlist" hint="Exact IPv4/IPv6 addresses or IPv4 CIDR ranges. Your current IP must be included before the list can be enabled."><textarea className="input" rows={5} value={ipRules} onChange={e=>setIpRules(e.target.value)} placeholder="203.0.113.10\n203.0.113.0/24"/></Field>
      </Card>

      <Card><h2>MFA & sessions</h2><p className="desc">Workspace-wide MFA enforcement requires the owner enabling it to already have an AAL2 session.</p>
        <MfaGate compact onVerified={()=>toast("ok","MFA verified for this session")}/>
        <label className="check-row"><input type="checkbox" checked={s.mfa_required===true} disabled={saving} onChange={e=>void setMfaRequired(e.target.checked)}/><span><strong>Require MFA for workspace dashboard access</strong><small>Members who sign in at AAL1 are stopped at an MFA gate before tenant data loads.</small></span></label>
        <button className="btn secondary" disabled={saving} onClick={revokeOtherSessions}>Revoke my other sessions</button>
      </Card>

      <Card><div className="source-title-row"><h2>HIPAA mode</h2><Badge tone={s.hipaa_mode?"ok":s.baa_status==="signed"?"warn":"neutral"}>{s.hipaa_mode?"Enabled":`BAA: ${s.baa_status??"none"}`}</Badge></div>
        <p className="desc">HIPAA mode forces ZDR, disables ZoChat conversation persistence and arbitrary external actions, enables redaction, and requires a signed BAA record.</p>
        {s.baa_status==="none"&&<button className="btn secondary" disabled={saving} onClick={requestBaa}>Request BAA review</button>}
        {s.baa_status==="requested"&&<div className="info-banner">BAA review requested. A platform administrator must mark it signed after the contractual process is complete.</div>}
        <label className="check-row"><input type="checkbox" checked={s.hipaa_mode===true} disabled={saving||s.baa_status!=="signed"} onChange={e=>void setHipaaMode(e.target.checked)}/><span><strong>Enable HIPAA mode</strong><small>{s.baa_status==="signed"?"Signed BAA recorded.":"Available only after the BAA is signed."}</small></span></label>
      </Card>

      <Card><h2>Security contacts</h2>
        <Field label="Security contact email"><input className="input" type="email" value={s.security_contact_email??""} onChange={e=>setS(v=>({...v,security_contact_email:e.target.value}))} placeholder="security@example.com"/></Field>
        <Field label="Incident contact email"><input className="input" type="email" value={s.incident_contact_email??""} onChange={e=>setS(v=>({...v,incident_contact_email:e.target.value}))} placeholder="incidents@example.com"/></Field>
        <Field label="Data region" hint="Policy metadata only. Actual residency depends on the deployed Supabase/hosting region."><input className="input" value={s.data_region??""} onChange={e=>setS(v=>({...v,data_region:e.target.value}))} placeholder="e.g. eu-west"/></Field>
      </Card>

      <Card><h2>Usage controls</h2>
        <Field label="Monthly request limit"><input className="input" type="number" disabled={s.billing_enforced===true} value={s.monthly_request_limit??100000} onChange={e=>setS(v=>({...v,monthly_request_limit:Number(e.target.value)}))}/></Field>
        <Field label="Monthly token limit"><input className="input" type="number" disabled={s.billing_enforced===true} value={s.monthly_token_limit??10000000} onChange={e=>setS(v=>({...v,monthly_token_limit:Number(e.target.value)}))}/></Field>
        {s.billing_enforced===true&&<p className="muted">Usage limits are managed by the active Stripe plan.</p>}
      </Card>
    </div>
    <div className="sticky-save"><button className="btn primary" disabled={saving} onClick={()=>void save()}>{saving?"Saving…":"Save security controls"}</button></div>


    <Card className="incident-card"><h2>Security incident register</h2><p className="desc">Record, triage and resolve suspected security or privacy incidents. Every change is also written to the audit log.</p><div className="form-grid-2"><Field label="Incident title"><input className="input" value={incidentTitle} onChange={e=>setIncidentTitle(e.target.value)} placeholder="e.g. Suspicious account access"/></Field><Field label="Severity"><select className="input" value={incidentSeverity} onChange={e=>setIncidentSeverity(e.target.value as SecurityIncidentItem["severity"])}><option value="info">Info</option><option value="warning">Warning</option><option value="critical">Critical</option></select></Field></div><Field label="Description"><textarea className="input" rows={4} value={incidentDescription} onChange={e=>setIncidentDescription(e.target.value)} placeholder="What happened, systems affected and actions already taken"/></Field><button className="btn primary" disabled={saving||!incidentTitle.trim()} onClick={()=>void reportIncident()}>Record incident</button>{incidents.length>0&&<div className="incident-list">{incidents.map(i=><div className="incident-row" key={i.id}><div><div className="source-title-row"><strong>{i.title}</strong><Badge tone={i.severity==="critical"?"danger":i.severity==="warning"?"warn":"neutral"}>{i.severity}</Badge><Badge tone={i.status==="resolved"?"ok":"neutral"}>{i.status}</Badge></div><p className="muted">{i.description||"No description"} · {new Date(i.created_at).toLocaleString()}</p></div><select className="input incident-status" value={i.status} disabled={saving} onChange={e=>void setIncidentStatus(i.id,e.target.value as SecurityIncidentItem["status"])}><option value="open">Open</option><option value="investigating">Investigating</option><option value="contained">Contained</option><option value="resolved">Resolved</option></select></div>)}</div>}</Card>

    <Card className="gdpr-card"><h2>GDPR data-subject request</h2><p className="desc">Export or erase matching customer data by email. Operations are server-side, tenant-scoped and audited.</p><div className="inline-form"><input className="input" type="email" placeholder="customer@example.com" value={email} onChange={e=>setEmail(e.target.value)}/><button className="btn secondary" disabled={saving||!email.trim()} onClick={async()=>{try{const r=await submitGdpr(tenantId,email,"export");const blob=new Blob([JSON.stringify(r.data??{},null,2)],{type:"application/json"});const href=URL.createObjectURL(blob);const a=document.createElement("a");a.href=href;a.download=`zochat-dsr-${r.requestId}.json`;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(href);toast("ok",`Export ${r.requestId} downloaded`)}catch(e){setError(e instanceof Error?e.message:"Export failed")}}}>Export</button><button className="btn secondary danger-btn" disabled={saving||!email.trim()} onClick={async()=>{if(confirm("Permanently erase matching customer data?")){try{const r=await submitGdpr(tenantId,email,"erase");toast("ok",`Erase request ${r.requestId} completed`)}catch(e){setError(e instanceof Error?e.message:"Erase failed")}}}}>Erase</button></div></Card>
  </div>;
}
