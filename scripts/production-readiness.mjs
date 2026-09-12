import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const required = [
  '.github/workflows/production-gate.yml',
  'dashboard/package.json',
  'widget/package.json',
  'supabase/functions/chat/index.ts',
  'supabase/functions/dashboard/index.ts',
  'supabase/functions/stripe-webhook/index.ts',
  'supabase/functions/_shared/entitlements.ts',
  'supabase/functions/_shared/conversation-security.ts',
  'supabase/functions/_shared/rate-limit.ts',
  'SECURITY.md',
  'PRODUCTION_RELEASE_CHECKLIST.md',
];

let failed = false;
for (const rel of required) {
  if (!fs.existsSync(path.join(root, rel))) {
    console.error(`MISSING ${rel}`);
    failed = true;
  } else {
    console.log(`OK ${rel}`);
  }
}

const dashboard = fs.readFileSync(path.join(root, 'supabase/functions/dashboard/index.ts'), 'utf8');
for (const marker of ['SUBSCRIPTION_REQUIRED', 'ASSISTANT_LIMIT_REACHED', 'create_workspace_for_user']) {
  if (!dashboard.includes(marker)) {
    console.error(`MISSING dashboard safety marker: ${marker}`);
    failed = true;
  }
}

const chat = fs.readFileSync(path.join(root, 'supabase/functions/chat/index.ts'), 'utf8');
for (const marker of ['allowPublicChat', 'verifyConversation', 'monthlyConversationCount', 'originAllowed']) {
  if (!chat.includes(marker)) {
    console.error(`MISSING chat safety marker: ${marker}`);
    failed = true;
  }
}

const billing = fs.readFileSync(path.join(root, 'supabase/functions/_shared/billing.ts'), 'utf8');
for (const marker of ['customer_update[name]', 'customer_update[address]']) {
  if (!billing.includes(marker)) {
    console.error(`MISSING Stripe checkout hardening marker: ${marker}`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log('Production readiness static checks passed.');
