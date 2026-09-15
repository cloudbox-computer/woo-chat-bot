import { DashboardError, resolveDashboardContext, requireDashboardRole } from "../_shared/dashboard.ts";
import { handleOptions, json } from "../_shared/cors.ts";
import { supabaseConfig } from "../_shared/env.ts";
import { audit } from "../_shared/audit.ts";
import { requirePlanFeature, type PlanFeature } from "../_shared/entitlements.ts";
import { runAgent } from "../_shared/agent.ts";

const RESOURCE: Record<string,{table:string, order?:string}> = {
  procedures:{table:"agent_procedures",order:"updated_at.desc"}, widgets:{table:"agent_widgets",order:"updated_at.desc"},
  contacts:{table:"customer_contacts",order:"updated_at.desc"}, inbox:{table:"omnichannel_threads",order:"last_message_at.desc"},
  tests:{table:"agent_test_scenarios",order:"updated_at.desc"}, insights:{table:"conversation_insights",order:"created_at.desc"},
  suggestions:{table:"backstage_suggestions",order:"created_at.desc"}, channels:{table:"channel_connections",order:"updated_at.desc"},
};

// Every Agent Platform resource is a paid capability. This mapping is enforced
// server-side for GET and mutations, so hiding a dashboard link is never the
// security boundary. Website chat itself remains available on Starter through
// the normal assistant/embed configuration; this Channels resource is for
// additional omnichannel deployments.
const RESOURCE_FEATURE: Record<string, PlanFeature> = {
  procedures: "workflows",
  widgets: "richChatExperiences",
  contacts: "contacts",
  inbox: "humanTakeover",
  tests: "testing",
  insights: "fullAnalytics",
  suggestions: "improvements",
  channels: "channels",
};
function db(){const {url,serviceRoleKey}=supabaseConfig();return {base:`${url}/rest/v1`,headers:{apikey:serviceRoleKey,Authorization:`Bearer ${serviceRoleKey}`,"Content-Type":"application/json"}}}
async function rows(table:string, tenantId:string, order?:string){const c=db();const q=new URLSearchParams({tenant_id:`eq.${tenantId}`,select:"*",limit:"250"});if(order)q.set("order",order);const r=await fetch(`${c.base}/${table}?${q}`,{headers:c.headers});if(!r.ok)throw new DashboardError("Platform data unavailable",502);return r.json();}
async function insert(table:string,body:Record<string,unknown>){const c=db();const r=await fetch(`${c.base}/${table}`,{method:"POST",headers:{...c.headers,Prefer:"return=representation"},body:JSON.stringify(body)});if(!r.ok){console.error(await r.text());throw new DashboardError("Could not save item",502)}return r.json();}
async function patch(table:string,id:string,tenantId:string,body:Record<string,unknown>){const c=db();const r=await fetch(`${c.base}/${table}?id=eq.${encodeURIComponent(id)}&tenant_id=eq.${tenantId}`,{method:"PATCH",headers:{...c.headers,Prefer:"return=representation"},body:JSON.stringify({...body,updated_at:new Date().toISOString()})});if(!r.ok){const detail=await r.text();console.error("platform patch failed",{table,id,status:r.status,detail});throw new DashboardError(r.status===404?"Item not found":"Could not update item",r.status===404?404:502)}return r.json();}
async function del(table:string,id:string,tenantId:string){const c=db();const r=await fetch(`${c.base}/${table}?id=eq.${encodeURIComponent(id)}&tenant_id=eq.${tenantId}`,{method:"DELETE",headers:c.headers});if(!r.ok)throw new DashboardError("Could not delete item",502);}


async function one(table:string, params:Record<string,string>){const c=db();const q=new URLSearchParams({...params,select:"*",limit:"1"});const r=await fetch(`${c.base}/${table}?${q}`,{headers:c.headers});if(!r.ok)throw new DashboardError("Platform data unavailable",502);const a=await r.json() as any[];return a[0]||null;}
function expectedScore(expected:string[], reply:string){
 const clean=(x:string)=>x.toLowerCase().replace(/[^a-z0-9£$% ]/g," ").replace(/\s+/g," ").trim(); const r=clean(reply);
 if(!expected.length)return {passed:true,score:1,checks:[]};
 const stop=new Set(["the","a","an","and","or","to","of","for","it","is","be","should","would","could","customer","zochat","please"]);
 const checks=expected.map(e=>{const exact=r.includes(clean(e));const words=clean(e).split(" ").filter(w=>w.length>2&&!stop.has(w));const hits=words.filter(w=>r.includes(w)).length;const ratio=words.length?hits/words.length:0;return {expected:e,matched:exact||ratio>=0.6,score:exact?1:ratio};});
 const score=checks.reduce((n,c)=>n+c.score,0)/checks.length;return {passed:checks.every(c=>c.matched),score,checks};
}

async function inboxItems(tenantId:string){
 const c=db(); const bots=await rows("chatbots",tenantId); const ids=(bots as any[]).map(x=>String(x.id)); if(!ids.length)return [];
 const q=new URLSearchParams({select:"id,chatbot_id,customer_email,title,control_mode,created_at,updated_at",chatbot_id:`in.(${ids.join(",")})`,order:"updated_at.desc",limit:"250"}); const cr=await fetch(`${c.base}/conversations?${q}`,{headers:c.headers}); if(!cr.ok)throw new DashboardError("Inbox unavailable",502); const conv=await cr.json() as any[];
 const threads=await rows("omnichannel_threads",tenantId,"last_message_at.desc") as any[]; const tm=new Map(threads.filter(t=>t.conversation_id).map(t=>[String(t.conversation_id),t]));
 if(!conv.length)return []; const mids=conv.map(x=>x.id); const mq=new URLSearchParams({select:"conversation_id,role,source,content,created_at",conversation_id:`in.(${mids.join(",")})`,order:"created_at.desc",limit:"1000"}); const mr=await fetch(`${c.base}/messages?${mq}`,{headers:c.headers}); const msgs=mr.ok?await mr.json() as any[]:[]; const last=new Map<string,any>(); for(const m of msgs)if(!last.has(String(m.conversation_id)))last.set(String(m.conversation_id),m);
 return conv.map(v=>{const t=tm.get(String(v.id));const human=v.control_mode==="human";return {id:v.id,conversation_id:v.id,subject:v.title||v.customer_email||"Customer conversation",customer_email:v.customer_email,channel:t?.channel||"website",status:t?.status||"open",queue:human?"mine":t?"needs_attention":"ai_handling",priority:t?.priority||"normal",ai_summary:t?.ai_summary||null,last_message:last.get(String(v.id))?.content||"",last_message_at:last.get(String(v.id))?.created_at||v.updated_at,control_mode:v.control_mode||"ai",escalation_reason:t?.ai_summary||null};});
}

async function runTestScenario(tenantId:string,id:string){
 const scenario=await one("agent_test_scenarios",{id:`eq.${id}`,tenant_id:`eq.${tenantId}`}); if(!scenario)throw new DashboardError("Test not found",404);
 let chatbotId=scenario.chatbot_id; if(!chatbotId){const bot=await one("chatbots",{tenant_id:`eq.${tenantId}`,active:"eq.true"})||await one("chatbots",{tenant_id:`eq.${tenantId}`}); chatbotId=bot?.id;}
 if(!chatbotId)throw new DashboardError("Create an assistant before running tests",409);
 const result=await runAgent({requestId:`test-${crypto.randomUUID()}`,chatbotId:String(chatbotId),message:String(scenario.input||""),testMode:true});
 const expected=Array.isArray(scenario.expected_contains)?scenario.expected_contains.map(String):[]; const forbidden=Array.isArray(scenario.forbidden_contains)?scenario.forbidden_contains.map(String):[]; const ev=expectedScore(expected,result.reply||""); const forbiddenHits=forbidden.filter((x:string)=>(result.reply||"").toLowerCase().includes(x.toLowerCase())); const passed=ev.passed&&!forbiddenHits.length;
 const run=await insert("agent_test_runs",{tenant_id:tenantId,scenario_id:id,passed,response:result.reply||"",trace:{score:ev.score,checks:ev.checks,forbiddenHits,chatbotId},created_at:new Date().toISOString()});
 return {passed,response:result.reply||"",score:ev.score,checks:ev.checks,forbiddenHits,run:(run as any[])[0]};
}

Deno.serve(async(req)=>{if(req.method==="OPTIONS")return handleOptions();try{const u=new URL(req.url),tenantId=u.searchParams.get("tenantId")||"",resource=u.searchParams.get("resource")||"";if(!tenantId)throw new DashboardError("tenantId is required",400);const ctx=await resolveDashboardContext(req,tenantId);const spec=RESOURCE[resource];if(!spec)throw new DashboardError("Unknown platform resource",400);
 const feature=RESOURCE_FEATURE[resource];if(feature)requirePlanFeature(ctx.tenant,feature);
 if(req.method==="GET"){
   if(resource==="inbox")return json({items:await inboxItems(tenantId)});
   if(resource==="insights"){const data=await rows(spec.table,tenantId,spec.order);const all=data as any[];const topics=Object.entries(all.reduce((a:any,x:any)=>{a[x.topic]=(a[x.topic]||0)+1;return a},{})).sort((a:any,b:any)=>b[1]-a[1]).slice(0,12);const sentiment=all.reduce((a:any,x:any)=>{a[x.sentiment]=(a[x.sentiment]||0)+1;return a},{positive:0,neutral:0,negative:0});return json({items:all,summary:{topics,sentiment,total:all.length}})}
   return json({items:await rows(spec.table,tenantId,spec.order)});
 }
 requireDashboardRole(ctx, resource==="inbox"?"agent":"admin");const body=await req.json().catch(()=>({})) as Record<string,unknown>;const id=String(body.id||u.searchParams.get("id")||"");
 if(resource==="tests"&&req.method==="POST"&&body.operation==="run"){if(!id)throw new DashboardError("id is required",400);const result=await runTestScenario(tenantId,id);await audit(ctx,"platform.tests.run","test",id);return json({ok:true,...result});}
 if(req.method==="POST"){const clean={...body};delete clean.id;if(resource==="tests"&&typeof clean.expected_behavior==="string"){clean.expected_contains=clean.expected_behavior.trim()?[clean.expected_behavior.trim()]:[];delete clean.expected_behavior;}const result=await insert(spec.table,{...clean,tenant_id:tenantId,created_at:new Date().toISOString(),updated_at:new Date().toISOString()});await audit(ctx,`platform.${resource}.create`,resource,String((result as any[])[0]?.id||""));return json({ok:true,item:(result as any[])[0]});}
 if(req.method==="PATCH"||req.method==="PUT"){if(!id)throw new DashboardError("id is required",400);const clean={...body};delete clean.id;if(resource==="tests"&&typeof clean.expected_behavior==="string"){clean.expected_contains=clean.expected_behavior.trim()?[clean.expected_behavior.trim()]:[];delete clean.expected_behavior;}const result=await patch(spec.table,id,tenantId,clean);await audit(ctx,`platform.${resource}.update`,resource,id);return json({ok:true,item:(result as any[])[0]});}
 if(req.method==="DELETE"){if(!id)throw new DashboardError("id is required",400);await del(spec.table,id,tenantId);await audit(ctx,`platform.${resource}.delete`,resource,id);return json({ok:true});}
 return json({error:"Method not allowed"},405);
}catch(e){console.error(e);if(e instanceof DashboardError)return json({error:e.message,code:e.code||`PLATFORM_${e.status}`},e.status);return json({error:"Internal error",code:"PLATFORM_500"},500)}});
