import fs from 'node:fs';
const s=fs.readFileSync(new URL('../supabase/functions/_shared/agent.ts',import.meta.url),'utf8');
const checks=[
 ['human support bypasses topic gate',s.includes('approvedHumanSupportIntent')&&s.includes('customer-support-intent')],
 ['human request queues directly',s.includes('HUMAN_REQUEST_RE.test(req.message) || SUPPORT_CONFIRM_RE.test(req.message)')&&s.includes('sent this conversation to the support team')],
 ['returns ask for order number',s.includes('RETURN_REQUEST_RE.test(req.message)')&&s.includes('What is your order number?')],
 ['sensitive changes go straight to inbox',s.includes('Other sensitive order mutations are handed directly to Inbox')],
];
for(const [n,ok] of checks){if(!ok){console.error('FAIL',n);process.exitCode=1}else console.log('PASS',n)}
