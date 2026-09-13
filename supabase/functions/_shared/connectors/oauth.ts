import { env, supabaseConfig } from "../env.ts";
import { encryptSecret, decryptSecret } from "../secrets.ts";
import { definition, encryptCredentials } from "./registry.ts";

export interface OAuthProviderConfig {
  id:string;
  clientId:string;
  clientSecret:string;
  authorizeUrl:string;
  tokenUrl:string;
  scopes:string[];
  pkce?:boolean;
  authorizeExtra?:Record<string,string>;
}

function e(provider:string,suffix:string){return env(`${provider.toUpperCase()}_OAUTH_${suffix}`)?.trim()??""}
function cfg(provider:string):OAuthProviderConfig|null{
  const clientId=e(provider,"CLIENT_ID"),clientSecret=e(provider,"CLIENT_SECRET");
  if(!clientId||!clientSecret)return null;
  switch(provider){
    case "salesforce": {const login=e(provider,"LOGIN_URL")||"https://login.salesforce.com";return{id:provider,clientId,clientSecret,authorizeUrl:`${login}/services/oauth2/authorize`,tokenUrl:`${login}/services/oauth2/token`,scopes:["api","refresh_token"],pkce:true}}
    case "intercom": {const region=(e(provider,"REGION")||"us").toLowerCase();const host=region==="eu"?"https://app.eu.intercom.com":region==="au"?"https://app.au.intercom.com":"https://app.intercom.com";return{id:provider,clientId,clientSecret,authorizeUrl:`${host}/oauth`,tokenUrl:"https://api.intercom.io/auth/eagle/token",scopes:[],pkce:false}}
    case "hubspot": return{id:provider,clientId,clientSecret,authorizeUrl:"https://app.hubspot.com/oauth/authorize",tokenUrl:"https://api.hubapi.com/oauth/v3/token",scopes:(e(provider,"SCOPES")||"crm.objects.contacts.read crm.objects.contacts.write").split(/\s+/).filter(Boolean),pkce:false};
    case "slack": return{id:provider,clientId,clientSecret,authorizeUrl:"https://slack.com/oauth/v2/authorize",tokenUrl:"https://slack.com/api/oauth.v2.access",scopes:(e(provider,"SCOPES")||"chat:write channels:read users:read").split(/[ ,]+/).filter(Boolean),pkce:false};
    case "calendly": return{id:provider,clientId,clientSecret,authorizeUrl:"https://auth.calendly.com/oauth/authorize",tokenUrl:"https://auth.calendly.com/oauth/token",scopes:[],pkce:true};
    case "notion": return{id:provider,clientId,clientSecret,authorizeUrl:"https://api.notion.com/v1/oauth/authorize",tokenUrl:"https://api.notion.com/v1/oauth/token",scopes:[],pkce:false,authorizeExtra:{owner:"user_or_workspace"}};
    case "google_drive": return{id:provider,clientId,clientSecret,authorizeUrl:"https://accounts.google.com/o/oauth2/v2/auth",tokenUrl:"https://oauth2.googleapis.com/token",scopes:["https://www.googleapis.com/auth/drive.readonly"],pkce:true,authorizeExtra:{access_type:"offline",prompt:"consent"}};
    case "dropbox": return{id:provider,clientId,clientSecret,authorizeUrl:"https://www.dropbox.com/oauth2/authorize",tokenUrl:"https://api.dropboxapi.com/oauth2/token",scopes:[],pkce:true,authorizeExtra:{token_access_type:"offline"}};
    case "helpscout": return{id:provider,clientId,clientSecret,authorizeUrl:"https://secure.helpscout.net/authentication/authorizeClientApplication",tokenUrl:"https://api.helpscout.net/v2/oauth2/token",scopes:[],pkce:false};
    default:return null;
  }
}
export function oauthAvailable(provider:string):boolean{return Boolean(cfg(provider))}
export function oauthProviders():string[]{return ["salesforce","intercom","hubspot","slack","calendly","notion","google_drive","dropbox","helpscout"].filter(oauthAvailable)}

function b64url(bytes:Uint8Array):string{let s="";for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"")}
async function sha256(v:string):Promise<string>{const d=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v)));return [...d].map(x=>x.toString(16).padStart(2,"0")).join("")}
async function challenge(v:string):Promise<string>{return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v))))}
function randomToken(bytes=32):string{return b64url(crypto.getRandomValues(new Uint8Array(bytes)))}
function rest(){const {url,serviceRoleKey}=supabaseConfig();return{base:`${url.replace(/\/+$/g,"")}/rest/v1`,h:{apikey:serviceRoleKey,Authorization:`Bearer ${serviceRoleKey}`,"Content-Type":"application/json"}}}
async function restRows(path:string,qs:Record<string,string>):Promise<Record<string,unknown>[]>{const x=rest();const r=await fetch(`${x.base}/${path}?${new URLSearchParams(qs)}`,{headers:x.h});if(!r.ok)throw new Error(`OAuth state database read failed (${r.status})`);return r.json()}
async function restWrite(method:string,path:string,body:Record<string,unknown>,prefer="return=minimal"):Promise<Response>{const x=rest();const r=await fetch(`${x.base}/${path}`,{method,headers:{...x.h,Prefer:prefer},body:JSON.stringify(body)});if(!r.ok)throw new Error(`OAuth state database write failed (${r.status}): ${(await r.text()).slice(0,180)}`);return r}

export function oauthCallbackUrl(req:Request):string{
  const explicit=env("CONNECTOR_OAUTH_CALLBACK_URL")?.trim();if(explicit)return explicit;
  const u=new URL(req.url);const path=u.pathname.endsWith("/connector-oauth-start")?u.pathname.slice(0,-"connector-oauth-start".length)+"connector-oauth":u.pathname;return `${u.origin}${path}`;
}
export function dashboardIntegrationUrl(params:Record<string,string>):string{
  const base=(env("DASHBOARD_URL")??"").trim();if(!base)throw new Error("DASHBOARD_URL is required for OAuth connections");const u=new URL(base);u.searchParams.set("page","integrations");for(const[k,v]of Object.entries(params))u.searchParams.set(k,v);return u.toString();
}

export async function startOAuth(req:Request,tenantId:string,userId:string,provider:string):Promise<{url:string;expiresAt:string}>{
  const c=cfg(provider);if(!c||!definition(provider))throw new Error("OAuth is not configured for this connector");
  const state=randomToken(32), verifier=c.pkce?randomToken(48):"", expiresAt=new Date(Date.now()+10*60_000).toISOString();
  await restWrite("POST","connector_oauth_states",{state_hash:await sha256(state),tenant_id:tenantId,user_id:userId,provider,verifier_encrypted:verifier?await encryptSecret(verifier):null,expires_at:expiresAt});
  const cb=oauthCallbackUrl(req);const u=new URL(c.authorizeUrl);u.searchParams.set("client_id",c.clientId);u.searchParams.set("redirect_uri",cb);u.searchParams.set("response_type","code");u.searchParams.set("state",state);
  if(c.scopes.length)u.searchParams.set("scope",c.scopes.join(provider==="slack"?",":" "));
  for(const[k,v]of Object.entries(c.authorizeExtra??{}))u.searchParams.set(k,v);
  if(c.pkce){u.searchParams.set("code_challenge",await challenge(verifier));u.searchParams.set("code_challenge_method","S256")}
  return{url:u.toString(),expiresAt};
}

async function consumeState(state:string):Promise<Record<string,unknown>>{
  if(!state||state.length>512)throw new Error("OAuth state is invalid");const hash=await sha256(state);const rows=await restRows("connector_oauth_states",{state_hash:`eq.${hash}`,used_at:"is.null",select:"*",limit:"1"});const row=rows[0];if(!row)throw new Error("OAuth state is invalid or has already been used");if(Date.parse(String(row.expires_at))<Date.now())throw new Error("OAuth connection request has expired");
  const x=rest();const r=await fetch(`${x.base}/connector_oauth_states?state_hash=eq.${encodeURIComponent(hash)}&used_at=is.null`,{method:"PATCH",headers:{...x.h,Prefer:"return=representation"},body:JSON.stringify({used_at:new Date().toISOString()})});if(!r.ok)throw new Error("Could not consume OAuth state");const used=await r.json() as Record<string,unknown>[];if(used.length!==1)throw new Error("OAuth state has already been used");return row;
}

function tokenHeaders(provider:string,c:OAuthProviderConfig):Record<string,string>{const h:Record<string,string>={Accept:"application/json","Content-Type":"application/x-www-form-urlencoded"};if(["notion","dropbox","slack"].includes(provider))h.Authorization=`Basic ${btoa(`${c.clientId}:${c.clientSecret}`)}`;return h}
async function exchangeCode(req:Request,c:OAuthProviderConfig,provider:string,code:string,verifier:string):Promise<Record<string,unknown>>{
  const p=new URLSearchParams({grant_type:"authorization_code",code,redirect_uri:oauthCallbackUrl(req)});
  if(!["notion","dropbox","slack"].includes(provider)){p.set("client_id",c.clientId);p.set("client_secret",c.clientSecret)}
  if(provider==="notion"){p.delete("grant_type");}
  if(provider==="intercom"){p.delete("grant_type");p.set("client_id",c.clientId);p.set("client_secret",c.clientSecret)}
  if(verifier)p.set("code_verifier",verifier);
  const ctrl=new AbortController();const t=setTimeout(()=>ctrl.abort(),12_000);try{const notionBody=provider==="notion"?JSON.stringify(Object.fromEntries(p)):undefined;const headers=tokenHeaders(provider,c);if(provider==="notion")headers["Content-Type"]="application/json";const r=await fetch(c.tokenUrl,{method:"POST",headers,body:notionBody??p,signal:ctrl.signal,redirect:"manual"});const text=await r.text();let data:Record<string,unknown>;try{data=JSON.parse(text)}catch{data={raw:text.slice(0,500)}}if(!r.ok||data.error){throw new Error(String(data.error_description??data.error??`OAuth token exchange failed (${r.status})`))}return data}finally{clearTimeout(t)}}

function normalizedOAuthCredentials(provider:string,t:Record<string,unknown>):Record<string,unknown>{
  const access=String(t.access_token??"");if(!access)throw new Error("OAuth provider did not return an access token");const out:Record<string,unknown>={};
  if(provider==="notion")out.token=access;else if(provider==="slack")out.bot_token=access;else out.access_token=access;
  if(t.refresh_token)out.refresh_token=String(t.refresh_token);
  if(provider==="salesforce"&&t.instance_url)out.instance_url=String(t.instance_url);
  if(provider==="google_drive"){out.client_id=e(provider,"CLIENT_ID");out.client_secret=e(provider,"CLIENT_SECRET")}
  if(provider==="dropbox"){out.app_key=e(provider,"CLIENT_ID");out.app_secret=e(provider,"CLIENT_SECRET")}
  if(provider==="helpscout"){out.app_id=e(provider,"CLIENT_ID");out.app_secret=e(provider,"CLIENT_SECRET")}
  if(provider==="hubspot"){out.client_id=e(provider,"CLIENT_ID");out.client_secret=e(provider,"CLIENT_SECRET")}
  if(provider==="slack"){out.client_id=e(provider,"CLIENT_ID");out.client_secret=e(provider,"CLIENT_SECRET")}
  if(provider==="calendly"){out.client_id=e(provider,"CLIENT_ID");out.client_secret=e(provider,"CLIENT_SECRET")}
  if(provider==="salesforce"){out.client_id=e(provider,"CLIENT_ID");out.client_secret=e(provider,"CLIENT_SECRET");out.login_url=e(provider,"LOGIN_URL")||"https://login.salesforce.com"}
  return out;
}
export async function finishOAuth(req:Request,code:string,state:string):Promise<{tenantId:string;provider:string}>{
  const row=await consumeState(state);const provider=String(row.provider);const c=cfg(provider);if(!c)throw new Error("OAuth provider is no longer configured");const verifier=row.verifier_encrypted?await decryptSecret(row.verifier_encrypted):"";const token=await exchangeCode(req,c,provider,code,verifier??"");const incoming=normalizedOAuthCredentials(provider,token);
  const current=await restRows("integrations",{tenant_id:`eq.${row.tenant_id}`,provider:`eq.${provider}`,select:"id,credentials",limit:"1"});const encrypted=await encryptCredentials(provider,incoming,(current[0]?.credentials??{}) as Record<string,unknown>);
  if(current[0])await restWrite("PATCH",`integrations?id=eq.${current[0].id}`,{credentials:encrypted,active:true});else await restWrite("POST","integrations",{tenant_id:row.tenant_id,provider,credentials:encrypted,active:true});
  return{tenantId:String(row.tenant_id),provider};
}
