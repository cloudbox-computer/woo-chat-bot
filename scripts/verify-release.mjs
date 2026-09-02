import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
let failed = 0;
function check(name, ok) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failed++;
}
function text(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

const dashboard = text('supabase/functions/dashboard/index.ts');
const chat = text('supabase/functions/chat/index.ts');
const widget = text('widget/src/widget.tsx');
const schema = text('supabase/schema.sql');
const migration = text('supabase/migrations/20260902_enterprise_foundation.sql');
check('dashboard tenant scope required', dashboard.includes('tenantId is required'));
check('encrypted integration secrets', dashboard.includes('encryptSecret'));
check('audit trail', dashboard.includes('actionAudit'));
check('last owner protected', dashboard.includes('Cannot remove the last owner'));
check('ticket writes tenant scoped', dashboard.includes('tenant_id=eq.${ctx.tenantId}'));
check('knowledge writes ownership checked', dashboard.includes('assertKnowledgeOwnership'));
check('chat signed session verification', chat.includes('verifyConversation'));
check('chat public rate limit', chat.includes('allowPublicChat'));
check('chat origin allowlist', chat.includes('originAllowed'));
check('request/token quotas', chat.includes('monthlyUsage'));
check('human takeover runtime', chat.includes('conversationControl'));
check('widget session persisted', widget.includes('WIDGET_SESSION_PREFIX') && widget.includes('localStorage.setItem(sessionKey'));
check('live agent sync', widget.includes('/conversation-sync'));
check('enterprise migration', migration.includes('audit_logs') && migration.includes('background_jobs') && migration.includes('idempotency_keys'));
check('usage aggregate RPC', schema.includes('tenant_usage_current_month'));
check('service role RPC grants', schema.includes('grant execute on function public.tenant_usage_current_month(uuid) to service_role'));
check('knowledge version bigint', schema.includes('version bigint not null'));
check('GDPR export includes messages/tickets', dashboard.includes('{ conversations, messages, tickets }'));
check('CI has no test failure masking', !text('.github/workflows/ci.yml').includes('bun test ||'));
check('CodeQL enabled', fs.existsSync(path.join(root,'.github/workflows/codeql.yml')));
check('Dependabot enabled', fs.existsSync(path.join(root,'.github/dependabot.yml')));
check('deployment runbook exists', fs.existsSync(path.join(root,'ENTERPRISE_DEPLOYMENT.md')));

// Local relative TS imports must resolve to a file.
const sourceRoots = ['dashboard/src','widget/src','supabase/functions','scripts','tests'];
const sourceFiles=[];
function walk(dir){ if(!fs.existsSync(dir))return; for(const ent of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,ent.name);if(ent.isDirectory())walk(p); else if(/\.(ts|tsx|mjs)$/.test(ent.name))sourceFiles.push(p);} }
for(const r of sourceRoots) walk(path.join(root,r));
let missing=[];
for(const file of sourceFiles){
 const src=fs.readFileSync(file,'utf8');
 for(const m of src.matchAll(/(?:from\s+|import\s*)["'](\.{1,2}\/[^"']+)["']/g)){
  const spec=m[1]; const base=path.resolve(path.dirname(file),spec); const candidates=[base,base+'.ts',base+'.tsx',base+'.js',path.join(base,'index.ts'),path.join(base,'index.tsx')];
  if(!candidates.some(fs.existsSync)) missing.push(`${path.relative(root,file)} -> ${spec}`);
 }
}
check('all local source imports resolve', missing.length===0);
if(missing.length) console.error(missing.join('\n'));

if (failed) { console.error(`\n${failed} release checks failed.`); process.exit(1); }
console.log(`\nAll release checks passed (${sourceFiles.length} source/script files inspected).`);
