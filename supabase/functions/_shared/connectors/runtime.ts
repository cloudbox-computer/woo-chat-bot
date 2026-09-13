import type { ToolSpec } from "../ai.ts";
import { supabaseConfig } from "../env.ts";
import { decryptedCredentials, encryptCredentials } from "./registry.ts";

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

export async function listRuntimeActions(tenantId:string,allowWrites:boolean):Promise<RuntimeConnectorAction[]>{
  const rows=await getRows("connector_actions",{tenant_id:`eq.${tenantId}`,active:"eq.true",select:"id,tenant_id,provider,name,description,capability,method,path_template,request_schema,response_mapping,require_confirmation,active",order:"name.asc",limit:"100"});
  return rows.map(r=>r as unknown as RuntimeConnectorAction).filter(a=>allowWrites||a.method==="GET");
}

export function connectorActionTool(actions:RuntimeConnectorAction[]):ToolSpec|null{
  if(!actions.length)return null;
  const catalogue=actions.map(a=>`${a.id} — ${a.name} [${a.method}]${a.require_confirmation?" (confirmation required)":""}: ${a.description||a.capability}. Input schema: ${JSON.stringify(a.request_schema||{})}`).join("\n");
  return {type:"function",function:{name:"run_connector_action",description:`Run one administrator-approved external integration action. Never invent an action id. For an action marked confirmation required, ask the customer for explicit confirmation first and only call it after they confirm. Available actions:\n${catalogue}`.slice(0,12000),parameters:{type:"object",properties:{actionId:{type:"string",enum:actions.map(a=>a.id),description:"Approved action id"},input:{type:"object",description:"Arguments required by the selected action. Use the action description and customer request; never include secrets."},confirmed:{type:"boolean",description:"Set true only after the customer explicitly confirmed a confirmation-required action."}},required:["actionId","input"]}}};
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


export async function executeConnectorAction(opts:{tenantId:string;actionId:string;input:Record<string,unknown>;confirmed:boolean;userMessage:string;conversationId?:string}):Promise<{ok:boolean;text:string}>{
  const rows=await getRows("connector_actions",{id:`eq.${opts.actionId}`,tenant_id:`eq.${opts.tenantId}`,active:"eq.true",select:"*",limit:"1"});const action=rows[0] as unknown as RuntimeConnectorAction|undefined;if(!action)return{ok:false,text:"That integration action is not available."};
  const started=Date.now();const log=async(ok:boolean,statusCode?:number,errorCode?:string)=>insertRun({tenant_id:opts.tenantId,action_id:action.id,conversation_id:opts.conversationId||null,provider:action.provider,action_name:action.name,method:action.method,ok,status_code:statusCode??null,duration_ms:Math.max(0,Date.now()-started),error_code:errorCode??null,metadata:{capability:action.capability,confirmationRequired:action.require_confirmation,confirmed:opts.confirmed===true}});
  if(action.method!=="GET"&&action.require_confirmation&&(!opts.confirmed||!isExplicitConfirmation(opts.userMessage))){await log(false,undefined,"CONFIRMATION_REQUIRED");return{ok:false,text:`Confirmation is required before I can run “${action.name}”. Please ask the customer to explicitly confirm, then try again.`}}
  const validationError=validateInput(action.request_schema??{},opts.input??{});if(validationError){await log(false,undefined,"INVALID_INPUT");return{ok:false,text:validationError}}
  const intRows=await getRows("integrations",{tenant_id:`eq.${opts.tenantId}`,provider:`eq.${action.provider}`,active:"eq.true",select:"id,credentials",limit:"1"});const integration=intRows[0];if(!integration){await log(false,undefined,"INTEGRATION_INACTIVE");return{ok:false,text:`The ${action.provider} connection is not active.`}}
  const stored=(integration.credentials??{}) as Record<string,unknown>;let creds=await decryptedCredentials(action.provider,stored);const {path,rest}=fillPath(action.path_template,opts.input??{},creds);
  if(action.provider==="twilio"&&action.method==="POST"&&/\/Messages\.json$/i.test(path)&&!("From" in rest)&&!("MessagingServiceSid" in rest)){if(creds.messaging_service_sid)rest.MessagingServiceSid=String(creds.messaging_service_sid);else if(creds.from_number)rest.From=String(creds.from_number);else return{ok:false,text:"Twilio needs a configured Messaging Service SID, From number, or an explicit sender for this action."}}
  const build=async(current:Record<string,unknown>)=>{const ep=providerEndpoint(action.provider,current,path);const url=await assertPublicHttps(ep.url);if(action.method==="GET"||action.method==="DELETE"){for(const[k,v]of Object.entries(rest)){if(v!=null)url.searchParams.set(k,scalar(v))}}if(url.toString().length>8000)throw new Error("Connector request URL is too long");return{url,init:requestInitFor(action,ep,rest)}};
  const perform=async(current:Record<string,unknown>)=>{const {url,init}=await build(current);const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),12_000);try{return await fetch(url,{...init,signal:ctrl.signal})}finally{clearTimeout(timer)}};
  try{
    let r=await perform(creds);
    if(r.status===401||r.status===403){const refreshed=await refreshOAuthIfAvailable(action.provider,creds);if(JSON.stringify(refreshed)!==JSON.stringify(creds)){creds=refreshed;await persistRefreshedCredentials(String(integration.id),action.provider,creds,stored);r=await perform(creds)}}
    const raw=await readResponseLimited(r);if(!r.ok){await log(false,r.status,"UPSTREAM_ERROR");return{ok:false,text:`${action.name} failed (${r.status}). ${safeResultText(raw).slice(0,4000)}`}}const mapped=mappedResponse(raw,action.response_mapping??{});await log(true,r.status);return{ok:true,text:`${action.name} succeeded.\n${safeResultText(mapped)||"No response body."}`}
  }catch(e){const code=e instanceof DOMException&&e.name==="AbortError"?"TIMEOUT":"REQUEST_ERROR";await log(false,undefined,code);return{ok:false,text:`${action.name} failed: ${e instanceof Error?e.message:"request error"}`}}
}

