import { handleOptions, json, readJson } from "../_shared/cors.ts";
import { verifyConversation } from "../_shared/conversation-security.ts";
import { controlsForChatbot, originAllowed } from "../_shared/enterprise.ts";
import { supabaseConfig } from "../_shared/env.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleOptions();
  if (req.method !== "POST") return json({error:"Method not allowed"},405);
  const body=await readJson(req);
  const chatbotId=typeof body.chatbotId==="string"?body.chatbotId:"";
  const conversationId=typeof body.conversationId==="string"?body.conversationId:"";
  const token=typeof body.conversationToken==="string"?body.conversationToken:"";
  if (!chatbotId||!conversationId) return json({error:"chatbotId and conversationId are required"},400);
  if (!(await verifyConversation(chatbotId,conversationId,token))) return json({error:"Invalid conversation session"},401);
  const controls=await controlsForChatbot(chatbotId); if(controls&&!originAllowed(req,controls.allowedOrigins)) return json({error:"Widget origin is not authorised"},403);
  const {url,serviceRoleKey}=supabaseConfig(); const base=`${url.replace(/\/+$/g,"")}/rest/v1`; const h={apikey:serviceRoleKey,Authorization:`Bearer ${serviceRoleKey}`};
  const convRes=await fetch(`${base}/conversations?id=eq.${conversationId}&select=id,control_mode,updated_at&limit=1`,{headers:h}); if(!convRes.ok)return json({error:"Sync failed"},502);
  const conv=(await convRes.json() as Array<Record<string,unknown>>)[0]; if(!conv)return json({error:"Conversation not found"},404);
  const since=typeof body.since==="string"?body.since:"1970-01-01T00:00:00.000Z";
  const msgRes=await fetch(`${base}/messages?conversation_id=eq.${conversationId}&created_at=gt.${encodeURIComponent(since)}&source=in.(agent,system)&select=id,role,source,content,products,created_at&order=created_at.asc&limit=200`,{headers:h});
  if(!msgRes.ok)return json({error:"Sync failed"},502);
  return json({mode:conv.control_mode??"ai",messages:await msgRes.json(),updatedAt:conv.updated_at});
});
