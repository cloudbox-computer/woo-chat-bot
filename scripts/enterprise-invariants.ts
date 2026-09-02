import { readFile } from "node:fs/promises";
const checks: Array<[string,string,string]> = [
 ["dashboard requires tenantId","supabase/functions/dashboard/index.ts","tenantId is required"],
 ["conversation signing","supabase/functions/chat/index.ts","verifyConversation"],
 ["public rate limit","supabase/functions/chat/index.ts","allowPublicChat"],
 ["origin restriction","supabase/functions/chat/index.ts","originAllowed"],
 ["encrypted integration secrets","supabase/functions/dashboard/index.ts","encryptSecret"],
 ["audit log","supabase/functions/dashboard/index.ts","actionAudit"],
 ["last-owner protection","supabase/functions/dashboard/index.ts","Cannot remove the last owner"],
 ["ticket tenant scope","supabase/functions/dashboard/index.ts","tenant_id=eq.${ctx.tenantId}"],
 ["knowledge ownership","supabase/functions/dashboard/index.ts","assertKnowledgeOwnership"],
 ["enterprise migration","supabase/migrations/20260902_enterprise_foundation.sql","audit_logs"],
];
let failed=0;
for(const [name,file,needle] of checks){const text=await readFile(file,"utf8");const ok=text.includes(needle);console.log(`${ok?"PASS":"FAIL"} ${name}`);if(!ok) failed++;}
if(failed) process.exit(1);
