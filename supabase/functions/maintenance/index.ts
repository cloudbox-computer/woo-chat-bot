import { json, handleOptions } from "../_shared/cors.ts";
import { env, supabaseConfig } from "../_shared/env.ts";
function authorised(req:Request){const s=env("WORKER_SECRET")??"";return !!s && req.headers.get("x-worker-secret")===s}
Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return handleOptions();
  if(!authorised(req))return json({error:"Unauthorised"},401);
  const{url,serviceRoleKey}=supabaseConfig();const root=url.replace(/\/+$/g,"");const h={apikey:serviceRoleKey,Authorization:`Bearer ${serviceRoleKey}`,"Content-Type":"application/json"};
  const tr=await fetch(`${root}/rest/v1/tenants?select=id,retention_days,zero_data_retention,store_conversations`,{headers:h});if(!tr.ok)return json({error:"Failed to load tenants"},502);
  const tenants=await tr.json() as Array<Record<string,unknown>>;let deleted=0;
  for(const t of tenants){
    const tid=String(t.id); const zdr=t.zero_data_retention===true||t.store_conversations===false; const days=Math.max(1,Number(t.retention_days??365));const cutoff=zdr?new Date(Date.now()+60_000).toISOString():new Date(Date.now()-days*86400000).toISOString();
    const br=await fetch(`${root}/rest/v1/chatbots?tenant_id=eq.${tid}&select=id`,{headers:h});const bots=await br.json() as Array<Record<string,unknown>>;
    for(const b of bots){const r=await fetch(`${root}/rest/v1/conversations?chatbot_id=eq.${encodeURIComponent(String(b.id))}&updated_at=lt.${encodeURIComponent(cutoff)}`,{method:"DELETE",headers:{...h,Prefer:"return=representation"}});if(r.ok){const rows=await r.json() as unknown[];deleted+=rows.length}}
  }
  await fetch(`${root}/rest/v1/idempotency_keys?expires_at=lt.${encodeURIComponent(new Date().toISOString())}`,{method:"DELETE",headers:{...h,Prefer:"return=minimal"}});
  const due=await fetch(`${root}/rest/v1/rpc/enqueue_due_source_syncs`,{method:"POST",headers:h,body:JSON.stringify({p_limit:100})});
  const queued=due.ok?Number(await due.json()):0;
  return json({ok:true,deletedConversations:deleted,queuedSourceSyncs:queued});
});
