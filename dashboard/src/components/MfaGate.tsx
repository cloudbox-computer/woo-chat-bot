import React from "react";
import { supabase } from "../lib/supabase";

type Factor = { id: string; friendly_name?: string; status?: string; factor_type?: string };

export default function MfaGate({ required = false, onVerified, compact = false }:{required?:boolean;onVerified?:()=>void;compact?:boolean}) {
  const [factors,setFactors]=React.useState<Factor[]>([]);
  const [selected,setSelected]=React.useState("");
  const [code,setCode]=React.useState("");
  const [enrolment,setEnrolment]=React.useState<{id:string;qr:string;secret:string}|null>(null);
  const [busy,setBusy]=React.useState(false);
  const [message,setMessage]=React.useState("");
  const [error,setError]=React.useState("");

  const load=React.useCallback(async()=>{
    const {data,error}=await supabase.auth.mfa.listFactors();
    if(error){setError(error.message);return;}
    const all=[...(data?.totp??[])].filter(Boolean) as Factor[];
    const verified=all.filter(f=>f.status==="verified");
    setFactors(verified); setSelected(v=>v||verified[0]?.id||"");
  },[]);
  React.useEffect(()=>{void load()},[load]);

  async function verifyFactor(factorId=selected){
    if(!factorId||!/^\d{6,8}$/.test(code.trim())){setError("Enter the code from your authenticator app.");return;}
    setBusy(true);setError("");setMessage("");
    try{
      const {error}=await supabase.auth.mfa.challengeAndVerify({factorId,code:code.trim()});
      if(error)throw error;
      setCode("");setMessage("Multi-factor authentication verified.");
      await supabase.auth.refreshSession();
      onVerified?.();
    }catch(e){setError(e instanceof Error?e.message:"Verification failed");}
    finally{setBusy(false)}
  }

  async function startEnroll(){
    setBusy(true);setError("");setMessage("");
    try{
      const {data,error}=await supabase.auth.mfa.enroll({factorType:"totp",friendlyName:"ZoChat authenticator"});
      if(error)throw error;
      if(!data?.id||!data.totp)throw new Error("Could not start MFA enrolment");
      setEnrolment({id:data.id,qr:data.totp.qr_code,secret:data.totp.secret});
      setSelected(data.id);
    }catch(e){setError(e instanceof Error?e.message:"Could not start MFA enrolment");}
    finally{setBusy(false)}
  }

  async function cancelEnroll(){
    if(enrolment?.id)await supabase.auth.mfa.unenroll({factorId:enrolment.id}).catch(()=>undefined);
    setEnrolment(null);setCode("");void load();
  }

  const content=<>
    <div className="mfa-copy">
      <strong>{required?"Multi-factor authentication required":"Authenticator app (TOTP)"}</strong>
      <p className="muted">Use a verified authenticator factor to protect this account. Recovery and device access remain managed by Supabase Auth.</p>
    </div>
    {error&&<div className="err">{error}</div>}{message&&<div className="ok">{message}</div>}
    {enrolment ? <div className="mfa-enrol">
      <p>Scan this QR code with your authenticator app, then enter the six-digit code.</p>
      <img className="mfa-qr" src={enrolment.qr} alt="Authenticator QR code" />
      <details><summary>Can't scan the QR code?</summary><code className="mfa-secret">{enrolment.secret}</code></details>
      <div className="mfa-code-row"><input className="input" inputMode="numeric" autoComplete="one-time-code" placeholder="123456" value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,"").slice(0,8))}/><button className="btn primary" disabled={busy} onClick={()=>verifyFactor(enrolment.id)}>Verify</button><button className="btn secondary" disabled={busy} onClick={cancelEnroll}>Cancel</button></div>
    </div> : factors.length ? <div className="mfa-code-row">
      {factors.length>1&&<select className="input" value={selected} onChange={e=>setSelected(e.target.value)}>{factors.map(f=><option key={f.id} value={f.id}>{f.friendly_name||"Authenticator"}</option>)}</select>}
      <input className="input" inputMode="numeric" autoComplete="one-time-code" placeholder="Authentication code" value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,"").slice(0,8))}/>
      <button className="btn primary" disabled={busy} onClick={()=>verifyFactor()}>Verify</button>
    </div> : <button className="btn primary" disabled={busy} onClick={startEnroll}>Set up authenticator</button>}
  </>;
  return compact?<div className="mfa-compact">{content}</div>:<div className="auth-wrap"><div className="auth-card mfa-gate"><h1>Secure your ZoChat account</h1>{content}<button className="btn ghost" onClick={()=>supabase.auth.signOut()}>Sign out</button></div></div>;
}
