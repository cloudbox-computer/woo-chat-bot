import { decryptSecret, encryptSecret } from "../secrets.ts";

export type ConnectorProvider =
  | "woocommerce" | "supabase" | "resend" | "shopify" | "stripe" | "hubspot"
  | "zendesk" | "slack" | "whatsapp" | "calendly" | "notion" | "google_drive"
  | "dropbox" | "zapier" | "make" | "n8n" | "webhook" | "custom_api";

export interface ConnectorDefinition {
  id: ConnectorProvider;
  name: string;
  category: "commerce"|"payments"|"crm"|"support"|"messaging"|"scheduling"|"knowledge"|"automation"|"developer"|"email"|"database";
  capabilities: string[];
  fields: Array<{key:string;label:string;secret?:boolean;required?:boolean;placeholder?:string;type?:"text"|"url"|"textarea"}>;
  sourceKinds?: string[];
}

export const CONNECTORS: ConnectorDefinition[] = [
  {id:"woocommerce",name:"WooCommerce",category:"commerce",capabilities:["catalogue.read","orders.read","orders.write","checkout.create","inventory.read","analytics.read"],fields:[{key:"url",label:"Store URL",required:true,type:"url"},{key:"consumer_key",label:"Consumer key",required:true,secret:true},{key:"consumer_secret",label:"Consumer secret",required:true,secret:true},{key:"webhook_secret",label:"Webhook secret",secret:true}]},
  {id:"shopify",name:"Shopify",category:"commerce",capabilities:["catalogue.read","orders.read","inventory.read","checkout.create (with Storefront token)"],fields:[{key:"store_domain",label:"Store domain",required:true,placeholder:"your-store.myshopify.com"},{key:"access_token",label:"Admin GraphQL API access token",required:true,secret:true},{key:"api_version",label:"Admin API version",placeholder:"2026-07"},{key:"storefront_access_token",label:"Storefront API token (optional, enables checkout)",secret:true},{key:"storefront_api_version",label:"Storefront API version",placeholder:"2026-07"}]},
  {id:"stripe",name:"Stripe",category:"payments",capabilities:["payments.read","payments.write"],fields:[{key:"secret_key",label:"Restricted/secret key",required:true,secret:true}]},
  {id:"hubspot",name:"HubSpot",category:"crm",capabilities:["crm.read","crm.write","support.read","support.write"],fields:[{key:"access_token",label:"Private app access token",required:true,secret:true}]},
  {id:"zendesk",name:"Zendesk",category:"support",capabilities:["support.read","support.write","knowledge.read"],sourceKinds:["zendesk"],fields:[{key:"base_url",label:"Zendesk URL",required:true,type:"url",placeholder:"https://company.zendesk.com"},{key:"email",label:"Agent email"},{key:"token",label:"API token",secret:true},{key:"access_token",label:"OAuth access token",secret:true}]},
  {id:"slack",name:"Slack",category:"messaging",capabilities:["messaging.send"],fields:[{key:"bot_token",label:"Bot token",required:true,secret:true}]},
  {id:"whatsapp",name:"WhatsApp Cloud API",category:"messaging",capabilities:["messaging.send"],fields:[{key:"access_token",label:"Access token",required:true,secret:true},{key:"phone_number_id",label:"Phone number ID",required:true},{key:"graph_version",label:"Graph API version",placeholder:"v24.0"}]},
  {id:"calendly",name:"Calendly",category:"scheduling",capabilities:["calendar.read","calendar.write"],fields:[{key:"access_token",label:"Personal/OAuth access token",required:true,secret:true}]},
  {id:"notion",name:"Notion",category:"knowledge",capabilities:["knowledge.read"],sourceKinds:["notion"],fields:[{key:"token",label:"Internal integration token",required:true,secret:true}]},
  {id:"google_drive",name:"Google Drive",category:"knowledge",capabilities:["knowledge.read"],sourceKinds:["google_drive"],fields:[{key:"access_token",label:"OAuth access token",secret:true},{key:"refresh_token",label:"OAuth refresh token",secret:true},{key:"client_id",label:"OAuth client ID"},{key:"client_secret",label:"OAuth client secret",secret:true}]},
  {id:"dropbox",name:"Dropbox",category:"knowledge",capabilities:["knowledge.read"],sourceKinds:["dropbox"],fields:[{key:"access_token",label:"Access token",required:true,secret:true}]},
  {id:"supabase",name:"Supabase",category:"database",capabilities:["business_data.read","catalogue.read","orders.read"],fields:[{key:"url",label:"Project URL",required:true,type:"url"},{key:"anon_key",label:"Anon key",required:true,secret:true},{key:"capability_config",label:"Capability mapping JSON",type:"textarea"},{key:"query_policy",label:"Business-data policy JSON",type:"textarea"}]},
  {id:"resend",name:"Resend",category:"email",capabilities:["email.send"],fields:[{key:"api_key",label:"API key",required:true,secret:true},{key:"from_email",label:"From email",required:true},{key:"from_name",label:"From name"}]},
  {id:"zapier",name:"Zapier",category:"automation",capabilities:["automation.trigger"],fields:[{key:"webhook_url",label:"Catch Hook URL",required:true,type:"url",secret:true},{key:"signing_secret",label:"Signing secret",secret:true}]},
  {id:"make",name:"Make",category:"automation",capabilities:["automation.trigger"],fields:[{key:"webhook_url",label:"Webhook URL",required:true,type:"url",secret:true},{key:"signing_secret",label:"Signing secret",secret:true}]},
  {id:"n8n",name:"n8n",category:"automation",capabilities:["automation.trigger"],fields:[{key:"webhook_url",label:"Webhook URL",required:true,type:"url",secret:true},{key:"api_key",label:"API key",secret:true}]},
  {id:"webhook",name:"Generic Webhook",category:"developer",capabilities:["automation.trigger"],fields:[{key:"url",label:"Webhook URL",required:true,type:"url",secret:true},{key:"authorization",label:"Authorization header",secret:true}]},
  {id:"custom_api",name:"Custom REST API",category:"developer",capabilities:["custom.read","custom.write"],fields:[{key:"base_url",label:"Base URL",required:true,type:"url"},{key:"auth_type",label:"Auth type",placeholder:"bearer | api_key | basic | none"},{key:"api_key",label:"API key / bearer token",secret:true},{key:"header_name",label:"API key header",placeholder:"X-API-Key"},{key:"username",label:"Basic auth username"},{key:"password",label:"Basic auth password",secret:true}]},
];

const SECRET_FIELDS = new Set(CONNECTORS.flatMap(c=>c.fields.filter(f=>f.secret).map(f=>`${c.id}:${f.key}`)));
export function definition(provider:string):ConnectorDefinition|undefined{return CONNECTORS.find(c=>c.id===provider)}
export function isSecretField(provider:string,key:string):boolean{return SECRET_FIELDS.has(`${provider}:${key}`)}

export async function encryptCredentials(provider:string,input:Record<string,unknown>,existing:Record<string,unknown>={}):Promise<Record<string,unknown>>{
  const def=definition(provider); if(!def)throw new Error("Unsupported connector"); const out:Record<string,unknown>={...existing};
  for(const field of def.fields){if(!(field.key in input))continue;let value=input[field.key];if(typeof value==="string")value=value.trim();if(value===""||value==null){continue}out[field.key]=field.secret?await encryptSecret(String(value)):value}
  return out;
}
export async function decryptedCredentials(provider:string,input:Record<string,unknown>):Promise<Record<string,unknown>>{
  const out:Record<string,unknown>={...input};const def=definition(provider);if(!def)return out;for(const f of def.fields){if(f.secret&&out[f.key])out[f.key]=await decryptSecret(out[f.key])}return out;
}
export function publicCredentialSummary(provider:string,credentials:Record<string,unknown>):Record<string,unknown>{
  const def=definition(provider);const out:Record<string,unknown>={};if(!def)return out;for(const f of def.fields){const v=credentials[f.key];if(f.secret){out[`has_${f.key}`]=Boolean(v)}else if(v!=null)out[f.key]=v}return out;
}


async function externalHttps(raw:string,label="URL"):Promise<URL>{
  let u:URL;try{u=new URL(raw)}catch{throw new Error(`${label} is invalid`)}
  if(u.protocol!=="https:")throw new Error(`${label} must use HTTPS`);
  const h=u.hostname.toLowerCase().replace(/^\[|\]$/g,"");
  const privateHost=h==="localhost"||h.endsWith(".localhost")||h==="::1"||/^127\./.test(h)||/^10\./.test(h)||/^192\.168\./.test(h)||/^169\.254\./.test(h)||(/^172\.(\d+)\./.test(h)&&(()=>{const n=Number(h.split(".")[1]);return n>=16&&n<=31})())||h.startsWith("fc")||h.startsWith("fd")||h.startsWith("fe80:");
  if(privateHost)throw new Error(`${label} cannot target a private/internal network`);
  try{const ips=await Deno.resolveDns(u.hostname,"A");if(ips.some(ip=>/^127\.|^10\.|^192\.168\.|^169\.254\./.test(ip)||(/^172\.(\d+)\./.test(ip)&&(()=>{const n=Number(ip.split(".")[1]);return n>=16&&n<=31})())))throw new Error(`${label} resolves to a private/internal network`)}catch(e){if(e instanceof Error&&e.message.includes("private/internal"))throw e}
  return u;
}
async function timedFetch(input:string|URL,init:RequestInit={}):Promise<Response>{const ctrl=new AbortController();const t=setTimeout(()=>ctrl.abort(),10000);try{return await fetch(input,{...init,signal:ctrl.signal,redirect:init.redirect??"manual"})}finally{clearTimeout(t)}}

function normDomain(v:string){return v.trim().replace(/^https?:\/\//i,"").replace(/\/$/,"")}
function basic(v:string){return `Basic ${btoa(v)}`}
export async function testConnector(provider:string,creds:Record<string,unknown>):Promise<{ok:boolean;message:string}>{
  const c=await decryptedCredentials(provider,creds);let r:Response;
  switch(provider){
    case"woocommerce":{const base=(await externalHttps(String(c.url??""),"WooCommerce URL")).toString().replace(/\/$/,"");const u=new URL(`${base}/wp-json/wc/v3/system_status`);u.searchParams.set("consumer_key",String(c.consumer_key??""));u.searchParams.set("consumer_secret",String(c.consumer_secret??""));r=await timedFetch(u,{headers:{Accept:"application/json"}});break}
    case"shopify":{const d=normDomain(String(c.store_domain??""));if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(d))throw new Error("Shopify store domain must be a *.myshopify.com domain");const version=String(c.api_version??"2026-07");r=await timedFetch(`https://${d}/admin/api/${version}/graphql.json`,{method:"POST",headers:{"X-Shopify-Access-Token":String(c.access_token??""),"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({query:"query ZoChatConnectionTest { shop { name } }"})});break}
    case"stripe":r=await timedFetch("https://api.stripe.com/v1/account",{headers:{Authorization:`Bearer ${String(c.secret_key??"")}`}});break;
    case"hubspot":r=await timedFetch("https://api.hubapi.com/crm/v3/objects/contacts?limit=1",{headers:{Authorization:`Bearer ${String(c.access_token??"")}`}});break;
    case"zendesk":{const base=(await externalHttps(String(c.base_url??""),"Zendesk URL")).toString().replace(/\/$/,"");const auth=c.access_token?`Bearer ${c.access_token}`:basic(`${c.email}/token:${c.token}`);r=await timedFetch(`${base}/api/v2/account/settings.json`,{headers:{Authorization:String(auth),Accept:"application/json"}});break}
    case"slack":r=await timedFetch("https://slack.com/api/auth.test",{method:"POST",headers:{Authorization:`Bearer ${String(c.bot_token??"")}`,"Content-Type":"application/x-www-form-urlencoded"},body:""});break;
    case"whatsapp":{const version=String(c.graph_version??"v24.0");const id=encodeURIComponent(String(c.phone_number_id??""));r=await timedFetch(`https://graph.facebook.com/${version}/${id}?fields=display_phone_number,verified_name`,{headers:{Authorization:`Bearer ${String(c.access_token??"")}`}});break}
    case"calendly":r=await timedFetch("https://api.calendly.com/users/me",{headers:{Authorization:`Bearer ${String(c.access_token??"")}`}});break;
    case"notion":r=await timedFetch("https://api.notion.com/v1/users/me",{headers:{Authorization:`Bearer ${String(c.token??"")}`,"Notion-Version":"2022-06-28"}});break;
    case"google_drive":r=await timedFetch("https://www.googleapis.com/drive/v3/about?fields=user",{headers:{Authorization:`Bearer ${String(c.access_token??"")}`}});break;
    case"dropbox":r=await timedFetch("https://api.dropboxapi.com/2/users/get_current_account",{method:"POST",headers:{Authorization:`Bearer ${String(c.access_token??"")}`,"Content-Type":"application/json"},body:"null"});break;
    case"supabase":{const base=(await externalHttps(String(c.url??""),"Supabase URL")).toString().replace(/\/$/,"");r=await timedFetch(`${base}/rest/v1/`,{headers:{apikey:String(c.anon_key??""),Authorization:`Bearer ${String(c.anon_key??"")}`}});break;}
    case"resend":r=await timedFetch("https://api.resend.com/domains",{headers:{Authorization:`Bearer ${String(c.api_key??"")}`}});break;
    case"zapier":case"make":case"n8n":case"webhook":{const raw=String(c.webhook_url??c.url??"");const u=await externalHttps(raw,"Webhook URL");r=await timedFetch(u,{method:"HEAD",redirect:"manual"});if(r.status===405||r.status===404)return{ok:true,message:"Webhook URL is configured (endpoint does not support HEAD testing)"};break}
    case"custom_api":{const base=(await externalHttps(String(c.base_url??""),"Custom API base URL")).toString().replace(/\/$/,"");const headers:Record<string,string>={Accept:"application/json"};const auth=String(c.auth_type??"none");if(auth==="bearer")headers.Authorization=`Bearer ${String(c.api_key??"")}`;if(auth==="api_key")headers[String(c.header_name??"X-API-Key")]=String(c.api_key??"");if(auth==="basic")headers.Authorization=basic(`${c.username??""}:${c.password??""}`);r=await timedFetch(base,{method:"GET",headers,redirect:"manual"});break}
    default:throw new Error("Unsupported connector");
  }
  if(provider==="slack"&&r.ok){const d=await r.clone().json().catch(()=>({})) as any;if(d.ok===false)return{ok:false,message:String(d.error??"Slack rejected credentials")}}
  if(!r.ok)return{ok:false,message:`Connection failed (${r.status})`};return{ok:true,message:"Connection verified"};
}
