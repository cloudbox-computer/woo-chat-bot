import { json, handleOptions } from "../_shared/cors.ts";
import { env, supabaseConfig } from "../_shared/env.ts";
import { decryptSecret } from "../_shared/secrets.ts";
import { sendTicketEmail } from "../_shared/email.ts";
import type { Tenant, Ticket } from "../_shared/types.ts";

function authorised(req:Request){const secret=env("WORKER_SECRET")??"";return !!secret && req.headers.get("x-worker-secret")===secret}
function mapTicket(r:Record<string,unknown>):Ticket{return{id:String(r.id),tenantId:String(r.tenant_id),reference:String(r.reference),conversationId:r.conversation_id?String(r.conversation_id):undefined,customerName:r.customer_name?String(r.customer_name):undefined,customerEmail:String(r.customer_email),subject:String(r.subject),description:String(r.description),category:r.category as Ticket["category"],priority:r.priority as Ticket["priority"],status:r.status as Ticket["status"],createdAt:String(r.created_at),updatedAt:String(r.updated_at)}}

Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return handleOptions(); if(!authorised(req))return json({error:"Unauthorised"},401);
 const {url,serviceRoleKey}=supabaseConfig(); const root=url.replace(/\/+$/g,""); const h={apikey:serviceRoleKey,Authorization:`Bearer ${serviceRoleKey}`,"Content-Type":"application/json"};
 const claim=await fetch(`${root}/rest/v1/rpc/claim_background_jobs`,{method:"POST",headers:h,body:JSON.stringify({p_limit:20})}); if(!claim.ok)return json({error:"Failed to claim jobs"},502);
 const jobs=await claim.json() as Array<Record<string,unknown>>; const results=[] as Array<Record<string,unknown>>;
 for(const job of jobs){const id=String(job.id),kind=String(job.kind),attempts=Number(job.attempts??1),max=Number(job.max_attempts??5);try{
   if(kind==="ticket_email"){
     const payload=(job.payload??{}) as Record<string,unknown>; const ticketId=String(payload.ticketId??""); if(!ticketId)throw new Error("ticketId missing");
     const tr=await fetch(`${root}/rest/v1/tickets?id=eq.${ticketId}&select=*`,{headers:h}); const ticketRows=await tr.json() as Array<Record<string,unknown>>; if(!ticketRows[0])throw new Error("Ticket not found"); const ticket=mapTicket(ticketRows[0]);
     const ten=await fetch(`${root}/rest/v1/tenants?id=eq.${ticket.tenantId}&select=id,slug,name,currency,support_email,ticket_prefix`,{headers:h}); const tenRows=await ten.json() as Array<Record<string,unknown>>; if(!tenRows[0])throw new Error("Tenant not found");
     const ir=await fetch(`${root}/rest/v1/integrations?tenant_id=eq.${ticket.tenantId}&provider=eq.resend&active=eq.true&select=credentials&limit=1`,{headers:h}); const irows=await ir.json() as Array<Record<string,unknown>>; const creds=(irows[0]?.credentials??{}) as Record<string,unknown>;
     const tenant:Tenant={id:String(tenRows[0].id),slug:String(tenRows[0].slug),name:String(tenRows[0].name),currency:String(tenRows[0].currency??"GBP"),welcomeMessage:"",supportEmail:tenRows[0].support_email?String(tenRows[0].support_email):undefined,ticketPrefix:tenRows[0].ticket_prefix?String(tenRows[0].ticket_prefix):undefined,resendApiKey:await decryptSecret(creds.api_key),resendFromEmail:creds.from_email?String(creds.from_email):undefined,resendFromName:creds.from_name?String(creds.from_name):undefined};
     const sent=await sendTicketEmail(tenant,ticket); if(!sent.sent)throw new Error(sent.error||"Ticket email failed");
   } else throw new Error(`Unknown job kind: ${kind}`);
   await fetch(`${root}/rest/v1/background_jobs?id=eq.${id}`,{method:"PATCH",headers:{...h,Prefer:"return=minimal"},body:JSON.stringify({status:"completed",locked_at:null,last_error:null,updated_at:new Date().toISOString()})}); results.push({id,ok:true});
 }catch(e){const message=e instanceof Error?e.message:"Job failed";const dead=attempts>=max;const delayMinutes=Math.min(60,2**Math.max(0,attempts-1));const runAfter=new Date(Date.now()+delayMinutes*60000).toISOString();await fetch(`${root}/rest/v1/background_jobs?id=eq.${id}`,{method:"PATCH",headers:{...h,Prefer:"return=minimal"},body:JSON.stringify({status:dead?"dead":"pending",locked_at:null,last_error:message.slice(0,1000),run_after:runAfter,updated_at:new Date().toISOString()})});results.push({id,ok:false,error:message,dead});}
 }
 return json({ok:true,processed:results.length,results});
});
