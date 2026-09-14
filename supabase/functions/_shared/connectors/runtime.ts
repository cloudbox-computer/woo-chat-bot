import type { ToolSpec } from "../ai.ts";
import type { WidgetInteraction } from "../types.ts";
import { supabaseConfig } from "../env.ts";
import { actionTemplateFor, decryptedCredentials, encryptCredentials, isBuiltInAction } from "./registry.ts";
import { ensureTenantDefaultConnectorActions } from "./default-actions.ts";

export interface RuntimeConnectorAction {
  id: string;
  tenant_id: string;
  provider: string;
  name: string;
  description: string;
  capability: string;
  method: "GET"|"POST"|"PUT"|"PATCH"|"DELETE";
  path_template: string;
  request_schema: Record<string,unknown>;
  response_mapping: Record<string,unknown>;
  require_confirmation: boolean;
  active: boolean;
}

function config(){const {url,serviceRoleKey}=supabaseConfig();return{base:`${url.replace(/\/+$/g,"")}/rest/v1`,h:{apikey:serviceRoleKey,Authorization:`Bearer ${serviceRoleKey}`}}}
async function getRows(path:string,qs:Record<string,string>):Promise<Record<string,unknown>[]>{const c=config();const r=await fetch(`${c.base}/${path}?${new URLSearchParams(qs)}`,{headers:c.h});if(!r.ok)throw new Error(`Connector database read failed (${r.status})`);return r.json()}
async function insertRun(row:Record<string,unknown>):Promise<void>{const c=config();try{await fetch(`${c.base}/connector_action_runs`,{method:"POST",headers:{...c.h,"Content-Type":"application/json",Prefer:"return=minimal"},body:JSON.stringify(row)})}catch{/* action telemetry must never break the customer request */}}

export interface RuntimeActionAccess {
  read: boolean;
  safeCustomerWrites: boolean;
  privilegedWrites: boolean;
  restrictedGrants: boolean;
}

const actionSeedCache = new Map<string, number>();
async function ensureActionCatalogueFresh(tenantId:string){
  const now=Date.now();
  if((actionSeedCache.get(tenantId)??0)>now-10*60_000)return;
  actionSeedCache.set(tenantId,now);
  try{await ensureTenantDefaultConnectorActions(tenantId)}catch(e){console.warn("connector:default-action-backfill-failed",{tenantId,error:e instanceof Error?e.message:String(e)})}
}

function isReadLike(action:RuntimeConnectorAction):boolean{
  return action.method==="GET" || action.capability.endsWith(".read") || action.capability==="knowledge.read";
}

function isCustomerSafeBuiltInWrite(action:RuntimeConnectorAction):boolean{
  if(isReadLike(action))return false;
  const t=actionTemplateFor(action.provider,action.name);
  return Boolean(t?.customerSafe && isBuiltInAction(action.provider,action.name,action.method,action.path_template));
}

export async function listRuntimeActions(tenantId:string,chatbotId:string,access:RuntimeActionAccess):Promise<RuntimeConnectorAction[]>{
  await ensureActionCatalogueFresh(tenantId);
  const rows=await getRows("connector_actions",{tenant_id:`eq.${tenantId}`,active:"eq.true",select:"id,tenant_id,provider,name,description,capability,method,path_template,request_schema,response_mapping,require_confirmation,active",order:"name.asc",limit:"200"});
  const actions=rows.map(r=>r as unknown as RuntimeConnectorAction);
  // Assignment is opt-in: no mapping rows means an action is available to all
  // assistants. Once an action has one or more mappings, only those assistants
  // receive it. This preserves existing tenants while enabling strict scoping.
  let scoped=actions;
  const restrictedWriteGrants=new Set<string>();
  if(actions.length){
    const ids=actions.map(a=>a.id).join(",");
    try{
      const mappings=await getRows("connector_action_chatbots",{tenant_id:`eq.${tenantId}`,action_id:`in.(${ids})`,select:"action_id,chatbot_id,allow_restricted_write",limit:"1000"});
      const anyByAction=new Set(mappings.map(m=>String(m.action_id)));
      const mineRows=mappings.filter(m=>String(m.chatbot_id)===chatbotId);
      const mine=new Set(mineRows.map(m=>String(m.action_id)));
      for(const m of mineRows){if(m.allow_restricted_write===true)restrictedWriteGrants.add(String(m.action_id))}
      scoped=actions.filter(a=>!anyByAction.has(a.id)||mine.has(a.id));
    }catch(e){
      // During a rolling deploy the migration may not exist yet. Fail open only
      // for legacy visibility. Restricted writes still fail closed because no
      // explicit grant is present.
      console.warn("connector:assistant-scope-read-failed",{tenantId,chatbotId,error:e instanceof Error?e.message:String(e)});
    }
  }
  return scoped.filter(action=>{
    if(isReadLike(action))return access.read;
    if(access.privilegedWrites)return true;
    if(access.safeCustomerWrites && isCustomerSafeBuiltInWrite(action))return true;
    // Restricted writes (email, SMS, publishing, automation, etc.) are available
    // to a normal customer-facing assistant only after an admin explicitly grants
    // this exact action to this exact assistant.
    return access.restrictedGrants && restrictedWriteGrants.has(action.id);
  });
}

function slug(v:string):string{return v.toLowerCase().replace(/[^a-z0-9_]+/g,"_").replace(/^_+|_+$/g,"").slice(0,48)||"action"}
function semanticToolBase(action:RuntimeConnectorAction):string{
  const template=actionTemplateFor(action.provider,action.name);
  if(template?.toolName)return slug(template.toolName);
  let n=action.name.toLowerCase();
  for(const word of ["salesforce","hubspot","intercom","freshdesk","help scout","gorgias","zoho desk","zendesk","calendly","slack","whatsapp","facebook messenger","instagram","twilio","wordpress","stripe","notion","google drive","dropbox","resend","zapier","make","n8n"]){n=n.replaceAll(word," ")}
  return slug(n);
}
export interface ConnectorToolBinding {toolName:string; action:RuntimeConnectorAction}
export function connectorActionTools(actions:RuntimeConnectorAction[]):{tools:ToolSpec[];bindings:Map<string,RuntimeConnectorAction>}{
  const tools:ToolSpec[]=[];const bindings=new Map<string,RuntimeConnectorAction>();const seen=new Map<string,number>();
  for(const action of actions){
    const base=semanticToolBase(action);const count=(seen.get(base)??0)+1;seen.set(base,count);const toolName=count===1?base:`${base}_${count}`;
    const parameters=(action.request_schema&&typeof action.request_schema==="object"?action.request_schema:{type:"object",properties:{}}) as Record<string,unknown>;
    const description=[action.description||action.capability,action.require_confirmation&& !isReadLike(action)?"The customer must explicitly confirm before the external change is committed.":"",`Capability: ${action.capability}.`].filter(Boolean).join(" ");
    tools.push({type:"function",function:{name:toolName,description,parameters}});
    bindings.set(toolName,action);
  }
  return{tools,bindings};
}

export function connectorCapabilitySummary(actions:RuntimeConnectorAction[]):string[]{
  const out:string[]=[];const seen=new Set<string>();
  for(const action of actions){
    const template=actionTemplateFor(action.provider,action.name);const label=template?.toolName?template.toolName.replaceAll("_"," "):action.name.replace(new RegExp(action.provider,"ig"),"").trim();
    const clean=label.replace(/\s+/g," ").trim();if(clean&&!seen.has(clean.toLowerCase())){seen.add(clean.toLowerCase());out.push(clean)}
  }
  return out.slice(0,30);
}

/** Legacy single-action tool retained only for internal compatibility. New model calls
 * receive one clean function per approved action through connectorActionTools(). */
export function connectorActionTool(actions:RuntimeConnectorAction[]):ToolSpec|null{
  if(!actions.length)return null;
  return {type:"function",function:{name:"run_connector_action",description:"Run a server-approved integration action by internal id.",parameters:{type:"object",properties:{actionId:{type:"string",enum:actions.map(a=>a.id)},input:{type:"object"}},required:["actionId","input"]}}};
}

export function runtimeActionIntentMatch(message:string,actions:RuntimeConnectorAction[]):boolean{
  const stop=new Set(["the","a","an","to","for","my","your","our","and","or","in","on","of","with","from","list","check","create","run"]);
  const tokens=(v:string)=>new Set(v.toLowerCase().replace(/[^a-z0-9]+/g," ").split(/\s+/).filter(x=>x.length>2&&!stop.has(x)));
  const mt=tokens(message);if(!mt.size)return false;
  for(const a of actions){const at=tokens(`${a.name} ${a.description} ${a.capability}`);let score=0;for(const t of mt)if(at.has(t))score++;if(score>=2)return true}
  return false;
}

function isPrivateHost(host:string):boolean{const h=host.toLowerCase().replace(/^\[|\]$/g,"");if(h==="localhost"||h.endsWith(".localhost")||h==="::1"||h==="0.0.0.0"||/^127\./.test(h)||/^10\./.test(h)||/^192\.168\./.test(h)||/^169\.254\./.test(h))return true;const m=h.match(/^172\.(\d+)\./);if(m&&Number(m[1])>=16&&Number(m[1])<=31)return true;return h.startsWith("fc")||h.startsWith("fd")||h.startsWith("fe80:")}
async function assertPublicHttps(raw:string):Promise<URL>{let u:URL;try{u=new URL(raw)}catch{throw new Error("Connector endpoint is invalid")}if(u.protocol!=="https:")throw new Error("Connector endpoints must use HTTPS");if(u.username||u.password||isPrivateHost(u.hostname))throw new Error("Private/internal connector endpoints are not allowed");try{const ips=await Deno.resolveDns(u.hostname,"A");if(ips.some(isPrivateHost))throw new Error("Connector endpoint resolves to a private/internal network")}catch(e){if(e instanceof Error&&e.message.includes("private/internal"))throw e}return u}
function basic(v:string){return `Basic ${btoa(v)}`}
function domain(v:string){return v.trim().replace(/^https?:\/\//i,"").replace(/\/$/,"")}
function providerEndpoint(provider:string,creds:Record<string,unknown>,path:string):{url:string;headers:Record<string,string>;formEncoded?:boolean;fixed?:boolean}{
  const headers:Record<string,string>={Accept:"application/json"};
  switch(provider){
    case"custom_api":{const base=String(creds.base_url??"").replace(/\/$/,"");const auth=String(creds.auth_type??"none");if(auth==="bearer")headers.Authorization=`Bearer ${String(creds.api_key??"")}`;if(auth==="api_key")headers[String(creds.header_name??"X-API-Key")]=String(creds.api_key??"");if(auth==="basic")headers.Authorization=basic(`${creds.username??""}:${creds.password??""}`);return{url:`${base}${path}`,headers}}
    case"woocommerce":{const base=String(creds.url??"").replace(/\/$/,"");headers.Authorization=basic(`${creds.consumer_key??""}:${creds.consumer_secret??""}`);return{url:`${base}/wp-json/wc/v3${path}`,headers}}
    case"shopify":{const d=domain(String(creds.store_domain??""));const v=String(creds.api_version??"2026-07");headers["X-Shopify-Access-Token"]=String(creds.access_token??"");return{url:`https://${d}/admin/api/${v}${path}`,headers}}
    case"stripe":headers.Authorization=`Bearer ${String(creds.secret_key??"")}`;return{url:`https://api.stripe.com${path}`,headers,formEncoded:true};
    case"hubspot":headers.Authorization=`Bearer ${String(creds.access_token??"")}`;return{url:`https://api.hubapi.com${path}`,headers};
    case"zendesk":{const base=String(creds.base_url??"").replace(/\/$/,"");headers.Authorization=creds.access_token?`Bearer ${String(creds.access_token)}`:basic(`${creds.email??""}/token:${creds.token??""}`);return{url:`${base}${path}`,headers}}
    case"slack":headers.Authorization=`Bearer ${String(creds.bot_token??"")}`;return{url:`https://slack.com${path}`,headers};
    case"whatsapp":{const v=String(creds.graph_version??"v24.0");headers.Authorization=`Bearer ${String(creds.access_token??"")}`;return{url:`https://graph.facebook.com/${v}${path}`,headers}}
    case"calendly":headers.Authorization=`Bearer ${String(creds.access_token??"")}`;return{url:`https://api.calendly.com${path}`,headers};
    case"notion":headers.Authorization=`Bearer ${String(creds.token??"")}`;headers["Notion-Version"]="2026-03-11";return{url:`https://api.notion.com${path}`,headers};
    case"google_drive":headers.Authorization=`Bearer ${String(creds.access_token??"")}`;return{url:`https://www.googleapis.com${path}`,headers};
    case"dropbox":headers.Authorization=`Bearer ${String(creds.access_token??"")}`;return{url:`https://api.dropboxapi.com${path}`,headers};
    case"salesforce":{const base=String(creds.instance_url??"").replace(/\/$/,"");headers.Authorization=`Bearer ${String(creds.access_token??"")}`;return{url:`${base}/services/data/latest${path}`,headers}}
    case"intercom":headers.Authorization=`Bearer ${String(creds.access_token??"")}`;headers["Intercom-Version"]=String(creds.api_version??"2.16");return{url:`https://api.intercom.io${path}`,headers};
    case"freshdesk":{const base=String(creds.base_url??"").replace(/\/$/,"");headers.Authorization=basic(`${String(creds.api_key??"")}:X`);return{url:`${base}/api/v2${path}`,headers}}
    case"helpscout":headers.Authorization=`Bearer ${String(creds.access_token??"")}`;return{url:`https://api.helpscout.net/v2${path}`,headers};
    case"gorgias":{const base=String(creds.base_url??"").replace(/\/$/,"");headers.Authorization=creds.access_token?`Bearer ${String(creds.access_token)}`:basic(`${String(creds.username??"")}:${String(creds.api_key??"")}`);return{url:`${base}/api${path}`,headers}}
    case"zoho_desk":{const base=String(creds.base_url??"https://desk.zoho.com").replace(/\/$/,"");headers.Authorization=`Zoho-oauthtoken ${String(creds.access_token??"")}`;headers.orgId=String(creds.org_id??"");return{url:`${base}/api/v1${path}`,headers}}
    case"messenger":{const v=String(creds.graph_version??"v24.0");headers.Authorization=`Bearer ${String(creds.page_access_token??"")}`;return{url:`https://graph.facebook.com/${v}${path}`,headers}}
    case"instagram":{const v=String(creds.graph_version??"v24.0");headers.Authorization=`Bearer ${String(creds.access_token??"")}`;return{url:`https://graph.facebook.com/${v}${path}`,headers}}
    case"twilio":{const sid=encodeURIComponent(String(creds.account_sid??""));headers.Authorization=basic(`${String(creds.account_sid??"")}:${String(creds.auth_token??"")}`);return{url:`https://api.twilio.com/2010-04-01/Accounts/${sid}${path}`,headers,formEncoded:true}}
    case"wordpress":{const base=String(creds.url??"").replace(/\/$/,"");headers.Authorization=basic(`${String(creds.username??"")}:${String(creds.app_password??"")}`);return{url:`${base}/wp-json/wp/v2${path}`,headers}}
    case"supabase":{const base=String(creds.url??"").replace(/\/$/,"");headers.apikey=String(creds.anon_key??"");headers.Authorization=`Bearer ${String(creds.anon_key??"")}`;return{url:`${base}/rest/v1${path}`,headers}}
    case"resend":headers.Authorization=`Bearer ${String(creds.api_key??"")}`;return{url:`https://api.resend.com${path}`,headers};
    case"zapier":case"make":case"n8n":{return{url:String(creds.webhook_url??""),headers,fixed:true}}
    case"webhook":{if(creds.authorization)headers.Authorization=String(creds.authorization);return{url:String(creds.url??""),headers,fixed:true}}
    default:throw new Error("This connector does not support runtime actions");
  }
}
function scalar(v:unknown):string{return typeof v==="string"?v:typeof v==="number"||typeof v==="boolean"?String(v):JSON.stringify(v)}
function fillPath(template:string,input:Record<string,unknown>,credentials:Record<string,unknown>={}):{path:string;rest:Record<string,unknown>}{
  if(template.length>2000||template.includes("\\")||template.includes("//")||/%2e/i.test(template))throw new Error("Unsafe action path");
  const rest={...input};const path=template.replace(/\{([A-Za-z0-9_]+)\}/g,(_m,k)=>{const source=k in rest?rest:credentials;if(!(k in source))throw new Error(`Missing action parameter: ${k}`);const v=encodeURIComponent(scalar(source[k]));if(source===rest)delete rest[k];return v});
  if(path.includes("..")||!path.startsWith("/")||path.length>2500)throw new Error("Unsafe action path");return{path,rest}
}
function isExplicitConfirmation(message:string):boolean{return /\b(yes|yeah|yep|confirm(?:ed)?|proceed|go ahead|do it|send it|book it|cancel it|refund it|approve)\b/i.test(message.trim())}
function safeResultText(raw:string):string{const text=raw.replace(/("?(?:access_?token|api_?key|secret|password)"?\s*[:=]\s*")([^"\s]+)(")/gi,"$1[REDACTED]$3");return text.length>20000?`${text.slice(0,20000)}\n[response truncated]`:text}


function validateInput(schema:Record<string,unknown>,input:Record<string,unknown>):string|null{
  const required=Array.isArray(schema.required)?schema.required.map(String):[];
  for(const key of required)if(!(key in input)||input[key]===null||input[key]==="")return `Missing action parameter: ${key}`;
  const props=(schema.properties&&typeof schema.properties==="object"&&!Array.isArray(schema.properties)?schema.properties:{}) as Record<string,unknown>;
  for(const [key,ruleRaw] of Object.entries(props)){
    if(!(key in input))continue;const rule=(ruleRaw&&typeof ruleRaw==="object"&&!Array.isArray(ruleRaw)?ruleRaw:{}) as Record<string,unknown>;const type=String(rule.type??"");const v=input[key];
    if(type==="string"&&typeof v!=="string")return `${key} must be a string`;
    if((type==="number"||type==="integer")&&typeof v!=="number")return `${key} must be a number`;
    if(type==="integer"&&typeof v==="number"&&!Number.isInteger(v))return `${key} must be an integer`;
    if(type==="boolean"&&typeof v!=="boolean")return `${key} must be true or false`;
    if(type==="array"&&!Array.isArray(v))return `${key} must be a list`;
    if(type==="object"&&(typeof v!=="object"||v===null||Array.isArray(v)))return `${key} must be an object`;
    if(Array.isArray(rule.enum)&&!rule.enum.some(x=>x===v))return `${key} has an unsupported value`;
  }
  return null;
}
function calendlyCustomerText(path:string,raw:string):string|null{
  try{
    const data=JSON.parse(raw) as any;
    if(path==="/event_types"&&Array.isArray(data?.collection)){
      const items=data.collection.filter((x:any)=>x?.active!==false).slice(0,12);
      if(!items.length)return "There are no active appointment types available to book right now.";
      return `Available appointment types:\n${items.map((x:any)=>`- ${String(x.name??"Meeting")}${x.duration?` (${x.duration} minutes)`:""}`).join("\n")}`;
    }
    if(path==="/event_type_available_times"&&Array.isArray(data?.collection)){
      const items=data.collection.filter((x:any)=>x?.status==="available").slice(0,10);
      if(!items.length)return "I couldn't find any available appointment times in that period.";
      return `Available appointment times:\n${items.map((x:any)=>`- ${String(x.start_time??"")}`).join("\n")}`;
    }
    if(path==="/invitees"&&data?.resource){const r=data.resource;return [`Your appointment is booked${r.name?` for ${r.name}`:""}.`,r.status?`Status: ${r.status}`:"",r.reschedule_url?`Reschedule: ${r.reschedule_url}`:"",r.cancel_url?`Cancel: ${r.cancel_url}`:""].filter(Boolean).join("\n")}
  }catch{/* fall back to generic mapping */}
  return null;
}

function mappedResponse(raw:string,mapping:Record<string,unknown>):string{
  if(!mapping||!Object.keys(mapping).length)return raw;
  try{
    let value:unknown=JSON.parse(raw);
    const path=typeof mapping.path==="string"?mapping.path.trim():"";
    if(path){for(const part of path.split(".").filter(Boolean)){if(value&&typeof value==="object"&&part in (value as Record<string,unknown>))value=(value as Record<string,unknown>)[part];else return raw;}}
    const fields=Array.isArray(mapping.fields)?mapping.fields.map(String):[];
    if(fields.length&&value&&typeof value==="object"&&!Array.isArray(value)){const picked:Record<string,unknown>={};for(const f of fields)if(f in (value as Record<string,unknown>))picked[f]=(value as Record<string,unknown>)[f];value=picked;}
    return JSON.stringify(value,null,2);
  }catch{return raw;}
}


async function refreshOAuthIfAvailable(provider:string,creds:Record<string,unknown>):Promise<Record<string,unknown>>{
  try{
    if(provider==="google_drive"&&creds.refresh_token&&creds.client_id&&creds.client_secret){
      const body=new URLSearchParams({client_id:String(creds.client_id),client_secret:String(creds.client_secret),refresh_token:String(creds.refresh_token),grant_type:"refresh_token"});
      const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body});
      if(r.ok){const d=await r.json().catch(()=>({})) as Record<string,unknown>;if(d.access_token)return{...creds,access_token:String(d.access_token)}}
    }
    if(provider==="hubspot"&&creds.refresh_token&&creds.client_id&&creds.client_secret){
      const body=new URLSearchParams({grant_type:"refresh_token",refresh_token:String(creds.refresh_token),client_id:String(creds.client_id),client_secret:String(creds.client_secret)});
      const r=await fetch("https://api.hubapi.com/oauth/v3/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body});
      if(r.ok){const d=await r.json().catch(()=>({})) as Record<string,unknown>;if(d.access_token)return{...creds,access_token:String(d.access_token),refresh_token:d.refresh_token?String(d.refresh_token):creds.refresh_token}}
    }
    if(provider==="calendly"&&creds.refresh_token&&creds.client_id&&creds.client_secret){
      const body=new URLSearchParams({grant_type:"refresh_token",refresh_token:String(creds.refresh_token),client_id:String(creds.client_id),client_secret:String(creds.client_secret)});
      const r=await fetch("https://auth.calendly.com/oauth/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body});
      if(r.ok){const d=await r.json().catch(()=>({})) as Record<string,unknown>;if(d.access_token)return{...creds,access_token:String(d.access_token),refresh_token:d.refresh_token?String(d.refresh_token):creds.refresh_token}}
    }
    if(provider==="slack"&&creds.refresh_token&&creds.client_id&&creds.client_secret){
      const body=new URLSearchParams({grant_type:"refresh_token",refresh_token:String(creds.refresh_token)});
      const r=await fetch("https://slack.com/api/oauth.v2.access",{method:"POST",headers:{Authorization:basic(`${String(creds.client_id)}:${String(creds.client_secret)}`),"Content-Type":"application/x-www-form-urlencoded"},body});
      if(r.ok){const d=await r.json().catch(()=>({})) as Record<string,unknown>;if(d.ok!==false&&d.access_token)return{...creds,bot_token:String(d.access_token),refresh_token:d.refresh_token?String(d.refresh_token):creds.refresh_token}}
    }
    if(provider==="salesforce"&&creds.refresh_token&&creds.client_id&&creds.client_secret){
      const base=String(creds.login_url??"https://login.salesforce.com").replace(/\/$/,"");
      const body=new URLSearchParams({grant_type:"refresh_token",refresh_token:String(creds.refresh_token),client_id:String(creds.client_id),client_secret:String(creds.client_secret)});
      const r=await fetch(`${base}/services/oauth2/token`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body});
      if(r.ok){const d=await r.json().catch(()=>({})) as Record<string,unknown>;if(d.access_token)return{...creds,access_token:String(d.access_token),instance_url:d.instance_url?String(d.instance_url):creds.instance_url}}
    }
    if(provider==="helpscout"&&creds.refresh_token&&creds.app_id&&creds.app_secret){
      const body=new URLSearchParams({grant_type:"refresh_token",refresh_token:String(creds.refresh_token),client_id:String(creds.app_id),client_secret:String(creds.app_secret)});
      const r=await fetch("https://api.helpscout.net/v2/oauth2/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body});
      if(r.ok){const d=await r.json().catch(()=>({})) as Record<string,unknown>;if(d.access_token)return{...creds,access_token:String(d.access_token),refresh_token:d.refresh_token?String(d.refresh_token):creds.refresh_token}}
    }
    if(provider==="zoho_desk"&&creds.refresh_token&&creds.client_id&&creds.client_secret){
      const base=String(creds.accounts_url??"https://accounts.zoho.com").replace(/\/$/,"");
      const body=new URLSearchParams({grant_type:"refresh_token",refresh_token:String(creds.refresh_token),client_id:String(creds.client_id),client_secret:String(creds.client_secret)});
      const r=await fetch(`${base}/oauth/v2/token`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body});
      if(r.ok){const d=await r.json().catch(()=>({})) as Record<string,unknown>;if(d.access_token)return{...creds,access_token:String(d.access_token)}}
    }
    if(provider==="dropbox"&&creds.refresh_token&&creds.app_key&&creds.app_secret){
      const body=new URLSearchParams({grant_type:"refresh_token",refresh_token:String(creds.refresh_token),client_id:String(creds.app_key),client_secret:String(creds.app_secret)});
      const r=await fetch("https://api.dropboxapi.com/oauth2/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body});
      if(r.ok){const d=await r.json().catch(()=>({})) as Record<string,unknown>;if(d.access_token)return{...creds,access_token:String(d.access_token)}}
    }
    if(provider==="notion"&&creds.refresh_token){
      const clientId=Deno.env.get("NOTION_OAUTH_CLIENT_ID")??"";const clientSecret=Deno.env.get("NOTION_OAUTH_CLIENT_SECRET")??"";
      if(clientId&&clientSecret){const r=await fetch("https://api.notion.com/v1/oauth/token",{method:"POST",headers:{Authorization:basic(`${clientId}:${clientSecret}`),"Content-Type":"application/json","Notion-Version":"2026-03-11"},body:JSON.stringify({grant_type:"refresh_token",refresh_token:String(creds.refresh_token)})});if(r.ok){const d=await r.json().catch(()=>({})) as Record<string,unknown>;if(d.access_token)return{...creds,token:String(d.access_token),refresh_token:d.refresh_token?String(d.refresh_token):creds.refresh_token}}}
    }
  }catch{/* keep the current token; the upstream request will surface an auth error if it is unusable */}
  return creds;
}


async function persistRefreshedCredentials(integrationId:string,provider:string,plain:Record<string,unknown>,stored:Record<string,unknown>):Promise<void>{
  const encrypted=await encryptCredentials(provider,plain,stored);const c=config();const r=await fetch(`${c.base}/integrations?id=eq.${encodeURIComponent(integrationId)}`,{method:"PATCH",headers:{...c.h,"Content-Type":"application/json",Prefer:"return=minimal"},body:JSON.stringify({credentials:encrypted})});if(!r.ok)throw new Error("Could not persist refreshed connector credentials");
}
async function readResponseLimited(r:Response,maxBytes=1_000_000):Promise<string>{
  if(!r.body)return"";const reader=r.body.getReader();const decoder=new TextDecoder();let total=0,out="";try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>maxBytes){await reader.cancel();throw new Error("Connector response exceeded the 1 MB safety limit")}out+=decoder.decode(value,{stream:true})}out+=decoder.decode();return out}finally{try{reader.releaseLock()}catch{/* noop */}}
}
function requestInitFor(action:RuntimeConnectorAction,ep:{headers:Record<string,string>;formEncoded?:boolean},rest:Record<string,unknown>):RequestInit{
  const headers={...ep.headers};const init:RequestInit={method:action.method,headers,redirect:"manual"};
  if(action.method!=="GET"&&action.method!=="DELETE"){if(ep.formEncoded){headers["Content-Type"]="application/x-www-form-urlencoded";init.body=new URLSearchParams(Object.fromEntries(Object.entries(rest).filter(([,v])=>v!=null).map(([k,v])=>[k,scalar(v)]))).toString()}else{headers["Content-Type"]="application/json";init.body=JSON.stringify(rest)}if(typeof init.body==="string"&&new TextEncoder().encode(init.body).byteLength>256_000)throw new Error("Connector request exceeds the 256 KB safety limit")}
  return init;
}


export async function executeConnectorAction(opts:{tenantId:string;actionId:string;input:Record<string,unknown>;confirmed:boolean;userMessage:string;conversationId?:string}):Promise<{ok:boolean;text:string;interaction?:WidgetInteraction}>{
  const rows=await getRows("connector_actions",{id:`eq.${opts.actionId}`,tenant_id:`eq.${opts.tenantId}`,active:"eq.true",select:"*",limit:"1"});const action=rows[0] as unknown as RuntimeConnectorAction|undefined;if(!action)return{ok:false,text:"That integration action is not available."};
  const started=Date.now();
  console.log("connector:action:start", { tenantId: opts.tenantId, conversationId: opts.conversationId, actionId: action.id, provider: action.provider, actionName: action.name, method: action.method });
  const log=async(ok:boolean,statusCode?:number,errorCode?:string)=>{
    const durationMs=Math.max(0,Date.now()-started);
    console.log("connector:action:done", { tenantId: opts.tenantId, conversationId: opts.conversationId, actionId: action.id, provider: action.provider, actionName: action.name, method: action.method, ok, statusCode: statusCode??null, durationMs, errorCode: errorCode??null });
    return insertRun({tenant_id:opts.tenantId,action_id:action.id,conversation_id:opts.conversationId||null,provider:action.provider,action_name:action.name,method:action.method,ok,status_code:statusCode??null,duration_ms:durationMs,error_code:errorCode??null,metadata:{capability:action.capability,confirmationRequired:action.require_confirmation,confirmed:opts.confirmed===true}});
  };
  const validationError=validateInput(action.request_schema??{},opts.input??{});
  if(validationError){
    await log(false,undefined,"INVALID_INPUT");
    return{ok:false,text:`I need a few details before I can ${action.name.toLowerCase()}.`,interaction:{type:"action_form",title:action.name,description:action.description||"Please complete the details below.",actionId:action.id,actionName:action.name,schema:action.request_schema??{},values:opts.input??{},submitLabel:action.require_confirmation?"Review details":"Continue",requireConfirmation:action.require_confirmation}};
  }
  if(action.method!=="GET"&&action.require_confirmation&&(!opts.confirmed||!isExplicitConfirmation(opts.userMessage))){
    await log(false,undefined,"CONFIRMATION_REQUIRED");
    return{ok:false,text:"Please review the details below and confirm when you're ready.",interaction:{type:"action_confirmation",title:`Confirm ${action.name}`,description:"Nothing will be sent until you confirm.",actionId:action.id,actionName:action.name,input:opts.input??{},confirmLabel:"Confirm"}};
  }
  const intRows=await getRows("integrations",{tenant_id:`eq.${opts.tenantId}`,provider:`eq.${action.provider}`,active:"eq.true",select:"id,credentials",limit:"1"});const integration=intRows[0];if(!integration){await log(false,undefined,"INTEGRATION_INACTIVE");return{ok:false,text:`The ${action.provider} connection is not active.`}}
  const stored=(integration.credentials??{}) as Record<string,unknown>;let creds=await decryptedCredentials(action.provider,stored);const {path,rest}=fillPath(action.path_template,opts.input??{},creds);
  // Calendly's event-types endpoint deliberately requires an explicit user or
  // organization URI. Non-technical users should never have to discover or
  // paste that URI into an action. Resolve it from the authenticated account.
  if(action.provider==="calendly"&&action.method==="GET"&&path==="/event_types"&&!rest.user&&!rest.organization){
    const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),8_000);
    try{
      const me=await fetch("https://api.calendly.com/users/me",{headers:{Authorization:`Bearer ${String(creds.access_token??"")}`,Accept:"application/json"},signal:ctrl.signal});
      if(me.ok){const data=await me.json().catch(()=>({})) as {resource?:{uri?:string;current_organization?:string}};if(data.resource?.uri)rest.user=data.resource.uri;else if(data.resource?.current_organization)rest.organization=data.resource.current_organization;}
      else console.warn("connector:calendly:identity-failed",{conversationId:opts.conversationId,status:me.status});
    }catch(e){console.warn("connector:calendly:identity-error",{conversationId:opts.conversationId,error:e instanceof Error?e.message:String(e)});}finally{clearTimeout(timer)}
    rest.active=true;rest.count=100;
  }
  if(action.provider==="twilio"&&action.method==="POST"&&/\/Messages\.json$/i.test(path)&&!("From" in rest)&&!("MessagingServiceSid" in rest)){if(creds.messaging_service_sid)rest.MessagingServiceSid=String(creds.messaging_service_sid);else if(creds.from_number)rest.From=String(creds.from_number);else return{ok:false,text:"Twilio needs a configured Messaging Service SID, From number, or an explicit sender for this action."}}
  const build=async(current:Record<string,unknown>)=>{const ep=providerEndpoint(action.provider,current,path);const url=await assertPublicHttps(ep.url);if(action.method==="GET"||action.method==="DELETE"){for(const[k,v]of Object.entries(rest)){if(v!=null)url.searchParams.set(k,scalar(v))}}if(url.toString().length>8000)throw new Error("Connector request URL is too long");return{url,init:requestInitFor(action,ep,rest)}};
  const perform=async(current:Record<string,unknown>)=>{const {url,init}=await build(current);const ctrl=new AbortController();const timeoutMs=12_000;const timer=setTimeout(()=>ctrl.abort(),timeoutMs);const callStarted=Date.now();console.log("connector:request:start",{conversationId:opts.conversationId,actionId:action.id,provider:action.provider,method:action.method,endpoint:`${url.origin}${url.pathname}`,timeoutMs});try{const response=await fetch(url,{...init,signal:ctrl.signal});console.log("connector:request:done",{conversationId:opts.conversationId,actionId:action.id,provider:action.provider,status:response.status,elapsedMs:Date.now()-callStarted});return response}catch(e){const timedOut=e instanceof DOMException&&e.name==="AbortError";console.error(timedOut?"connector:request:timeout":"connector:request:error",{conversationId:opts.conversationId,actionId:action.id,provider:action.provider,elapsedMs:Date.now()-callStarted,error:timedOut?`Timed out after ${timeoutMs}ms`:e instanceof Error?e.message:String(e)});throw e}finally{clearTimeout(timer)}};
  try{
    let r=await perform(creds);
    if(r.status===401||r.status===403){const refreshed=await refreshOAuthIfAvailable(action.provider,creds);if(JSON.stringify(refreshed)!==JSON.stringify(creds)){creds=refreshed;await persistRefreshedCredentials(String(integration.id),action.provider,creds,stored);r=await perform(creds)}}
    const raw=await readResponseLimited(r);
    if(!r.ok){await log(false,r.status,"UPSTREAM_ERROR");return{ok:false,text:`${action.name} failed (${r.status}). ${safeResultText(raw).slice(0,4000)}`}}
    if(action.provider==="calendly"){
      try{
        const data=JSON.parse(raw) as any;
        if(path==="/event_types"&&Array.isArray(data?.collection)){
          const items=data.collection.filter((x:any)=>x?.active!==false).slice(0,12).map((x:any)=>({uri:String(x.uri??""),name:String(x.name??"Meeting"),duration:typeof x.duration==="number"?x.duration:undefined})).filter((x:any)=>x.uri);
          if(!items.length){await log(true,r.status);return{ok:true,text:"There are no active appointment types available to book right now."}}
          if(items.length===1){
            const availableRows=await getRows("connector_actions",{tenant_id:`eq.${opts.tenantId}`,provider:"eq.calendly",name:"eq.Check Calendly availability",active:"eq.true",select:"id",limit:"1"});
            const availableId=String(availableRows[0]?.id??"");
            if(availableId){
              const start=new Date(Date.now()+5*60*1000);
              const end=new Date(start.getTime()+14*24*60*60*1000);
              const nested=await executeConnectorAction({tenantId:opts.tenantId,actionId:availableId,input:{event_type:items[0].uri,start_time:start.toISOString(),end_time:end.toISOString()},confirmed:false,userMessage:opts.userMessage,conversationId:opts.conversationId});
              if(nested.interaction?.type==="appointment_picker") nested.interaction.eventType={...items[0]};
              await log(true,r.status);
              return nested.ok?nested:{...nested,text:nested.text||"I couldn't load the available appointment times just now."};
            }
          }
          await log(true,r.status);
          return{ok:true,text:"Choose the type of appointment you'd like to book.",interaction:{type:"appointment_type_picker",title:"Choose an appointment",description:"Select a meeting type to see live availability.",eventTypes:items}};
        }
        if(path==="/event_type_available_times"&&Array.isArray(data?.collection)){
          const slots=data.collection.filter((x:any)=>x?.status==="available"&&x?.start_time).slice(0,120).map((x:any)=>({startTime:String(x.start_time)}));
          await log(true,r.status);
          return{ok:true,text:slots.length?"Choose a date and time that suits you.":"I couldn't find any available appointment times in the next two weeks.",interaction:slots.length?{type:"appointment_picker",title:"Choose a date & time",description:"Times shown are live availability.",eventType:{uri:String(opts.input.event_type??""),name:"Appointment"},slots}:undefined};
        }
        if(path==="/invitees"&&data?.resource){
          const rr=data.resource;
          await log(true,r.status);
          return{ok:true,text:"Your appointment is booked.",interaction:{type:"booking_confirmation",title:"Appointment confirmed",startTime:String(opts.input.start_time??""),eventName:typeof opts.input.event_name==="string"?String(opts.input.event_name):undefined,inviteeName:typeof (opts.input.invitee as any)?.name==="string"?String((opts.input.invitee as any).name):undefined}};
        }
      }catch{/* fall through to mapped response */}
    }
    const customerText=action.provider==="calendly"?calendlyCustomerText(path,raw):null;const mapped=mappedResponse(raw,action.response_mapping??{});await log(true,r.status);return{ok:true,text:customerText??`${action.name} succeeded.\n${safeResultText(mapped)||"No response body."}`}

  }catch(e){const code=e instanceof DOMException&&e.name==="AbortError"?"TIMEOUT":"REQUEST_ERROR";await log(false,undefined,code);return{ok:false,text:`${action.name} failed: ${e instanceof Error?e.message:"request error"}`}}
}

