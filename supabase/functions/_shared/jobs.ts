import { supabaseConfig } from "./env.ts";
export async function enqueueJob(tenantId:string, kind:string, payload:Record<string,unknown>, opts:{maxAttempts?:number;runAfter?:string}={}):Promise<string>{
 const {url,serviceRoleKey}=supabaseConfig(); const id=crypto.randomUUID();
 const r=await fetch(`${url.replace(/\/+$/g,"")}/rest/v1/background_jobs`,{method:"POST",headers:{apikey:serviceRoleKey,Authorization:`Bearer ${serviceRoleKey}`,"Content-Type":"application/json",Prefer:"return=minimal"},body:JSON.stringify({id,tenant_id:tenantId,kind,payload,max_attempts:opts.maxAttempts??5,run_after:opts.runAfter??new Date().toISOString()})});
 if(!r.ok) throw new Error(`Failed to enqueue ${kind}: ${r.status}`); return id;
}
