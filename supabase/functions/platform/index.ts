import { DashboardError, resolveDashboardContext, requireDashboardRole } from "../_shared/dashboard.ts";
import { handleOptions, json } from "../_shared/cors.ts";
import { supabaseConfig } from "../_shared/env.ts";
import { audit } from "../_shared/audit.ts";

const RESOURCE: Record<string,{table:string, order?:string}> = {
  procedures:{table:"agent_procedures",order:"updated_at.desc"}, widgets:{table:"agent_widgets",order:"updated_at.desc"},
  contacts:{table:"customer_contacts",order:"updated_at.desc"}, inbox:{table:"omnichannel_threads",order:"last_message_at.desc"},
  tests:{table:"agent_test_scenarios",order:"updated_at.desc"}, insights:{table:"conversation_insights",order:"created_at.desc"},
  suggestions:{table:"backstage_suggestions",order:"created_at.desc"}, channels:{table:"channel_connections",order:"updated_at.desc"},
};
function db(){const {url,serviceRoleKey}=supabaseConfig();return {base:`${url}/rest/v1`,headers:{apikey:serviceRoleKey,Authorization:`Bearer ${serviceRoleKey}`,"Content-Type":"application/json"}}}
async function rows(table:string, tenantId:string, order?:string){const c=db();const q=new URLSearchParams({tenant_id:`eq.${tenantId}`,select:"*",limit:"250"});if(order)q.set("order",order);const r=await fetch(`${c.base}/${table}?${q}`,{headers:c.headers});if(!r.ok)throw new DashboardError("Platform data unavailable",502);return r.json();}
async function insert(table:string,body:Record<string,unknown>){const c=db();const r=await fetch(`${c.base}/${table}`,{method:"POST",headers:{...c.headers,Prefer:"return=representation"},body:JSON.stringify(body)});if(!r.ok){console.error(await r.text());throw new DashboardError("Could not save item",502)}return r.json();}
async function patch(table:string,id:string,tenantId:string,body:Record<string,unknown>){const c=db();const r=await fetch(`${c.base}/${table}?id=eq.${encodeURIComponent(id)}&tenant_id=eq.${tenantId}`,{method:"PATCH",headers:{...c.headers,Prefer:"return=representation"},body:JSON.stringify({...body,updated_at:new Date().toISOString()})});if(!r.ok){const detail=await r.text();console.error("platform patch failed",{table,id,status:r.status,detail});throw new DashboardError(r.status===404?"Item not found":"Could not update item",r.status===404?404:502)}return r.json();}
async function del(table:string,id:string,tenantId:string){const c=db();const r=await fetch(`${c.base}/${table}?id=eq.${encodeURIComponent(id)}&tenant_id=eq.${tenantId}`,{method:"DELETE",headers:c.headers});if(!r.ok)throw new DashboardError("Could not delete item",502);}

Deno.serve(async(req)=>{if(req.method==="OPTIONS")return handleOptions();try{const u=new URL(req.url),tenantId=u.searchParams.get("tenantId")||"",resource=u.searchParams.get("resource")||"";if(!tenantId)throw new DashboardError("tenantId is required",400);const ctx=await resolveDashboardContext(req,tenantId);const spec=RESOURCE[resource];if(!spec)throw new DashboardError("Unknown platform resource",400);
 if(req.method==="GET"){
   if(resource==="insights"){const data=await rows(spec.table,tenantId,spec.order);const all=data as any[];const topics=Object.entries(all.reduce((a:any,x:any)=>{a[x.topic]=(a[x.topic]||0)+1;return a},{})).sort((a:any,b:any)=>b[1]-a[1]).slice(0,12);const sentiment=all.reduce((a:any,x:any)=>{a[x.sentiment]=(a[x.sentiment]||0)+1;return a},{positive:0,neutral:0,negative:0});return json({items:all,summary:{topics,sentiment,total:all.length}})}
   return json({items:await rows(spec.table,tenantId,spec.order)});
 }
 requireDashboardRole(ctx, resource==="inbox"?"agent":"admin");const body=await req.json().catch(()=>({})) as Record<string,unknown>;const id=String(body.id||u.searchParams.get("id")||"");
 if(req.method==="POST"){const clean={...body};delete clean.id;if(resource==="tests"&&typeof clean.expected_behavior==="string"){clean.expected_contains=clean.expected_behavior.trim()?[clean.expected_behavior.trim()]:[];delete clean.expected_behavior;}const result=await insert(spec.table,{...clean,tenant_id:tenantId,created_at:new Date().toISOString(),updated_at:new Date().toISOString()});await audit(ctx,`platform.${resource}.create`,resource,String((result as any[])[0]?.id||""));return json({ok:true,item:(result as any[])[0]});}
 if(req.method==="PATCH"||req.method==="PUT"){if(!id)throw new DashboardError("id is required",400);const clean={...body};delete clean.id;if(resource==="tests"&&typeof clean.expected_behavior==="string"){clean.expected_contains=clean.expected_behavior.trim()?[clean.expected_behavior.trim()]:[];delete clean.expected_behavior;}const result=await patch(spec.table,id,tenantId,clean);await audit(ctx,`platform.${resource}.update`,resource,id);return json({ok:true,item:(result as any[])[0]});}
 if(req.method==="DELETE"){if(!id)throw new DashboardError("id is required",400);await del(spec.table,id,tenantId);await audit(ctx,`platform.${resource}.delete`,resource,id);return json({ok:true});}
 return json({error:"Method not allowed"},405);
}catch(e){console.error(e);if(e instanceof DashboardError)return json({error:e.message,code:e.code||`PLATFORM_${e.status}`},e.status);return json({error:"Internal error",code:"PLATFORM_500"},500)}});
