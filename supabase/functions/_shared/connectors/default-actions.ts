import { supabaseConfig } from "../env.ts";
import { definition } from "./registry.ts";

function cfg(){const {url,serviceRoleKey}=supabaseConfig();return{base:`${url.replace(/\/+$/g,"")}/rest/v1`,h:{apikey:serviceRoleKey,Authorization:`Bearer ${serviceRoleKey}`,"Content-Type":"application/json"}}}
async function rows(path:string,qs:Record<string,string>){const c=cfg();const r=await fetch(`${c.base}/${path}?${new URLSearchParams(qs)}`,{headers:c.h});if(!r.ok)throw new Error(`Default action read failed (${r.status})`);return r.json() as Promise<Record<string,unknown>[]>}
async function write(method:string,path:string,body:Record<string,unknown>){const c=cfg();const r=await fetch(`${c.base}/${path}`,{method,headers:{...c.h,Prefer:"return=minimal"},body:JSON.stringify(body)});if(!r.ok)throw new Error(`Default action write failed (${r.status}): ${(await r.text()).slice(0,180)}`)}

/**
 * Installs ZoChat's safe, built-in action catalogue for a connected provider.
 * Users should not need to understand HTTP methods, paths or JSON Schema for
 * common integrations. Existing actions with the same built-in name are
 * upgraded to the current canonical definition so provider API fixes roll out.
 */
export async function ensureDefaultConnectorActions(tenantId:string,provider:string,createdBy?:string):Promise<number>{
  const def=definition(provider);const templates=def?.actionTemplates??[];if(!templates.length)return 0;
  const existing=await rows("connector_actions",{tenant_id:`eq.${tenantId}`,provider:`eq.${provider}`,select:"id,name",limit:"500"});
  const byName=new Map(existing.map(x=>[String(x.name),String(x.id)]));
  let changed=0;
  for(const t of templates){
    const row={tenant_id:tenantId,provider,name:t.name,description:t.description,capability:t.capability,method:t.method,path_template:t.pathTemplate,request_schema:t.requestSchema??{},response_mapping:t.responseMapping??{},require_confirmation:t.requireConfirmation===true||t.method!=="GET",active:true,updated_at:new Date().toISOString()};
    const id=byName.get(t.name);
    if(id)await write("PATCH",`connector_actions?id=eq.${encodeURIComponent(id)}&tenant_id=eq.${encodeURIComponent(tenantId)}`,row);
    else await write("POST","connector_actions",{id:crypto.randomUUID(),...row,created_by:createdBy??null});
    changed++;
  }
  return changed;
}
