/**
 * Apply supabase/schema.sql to a remote Supabase project via the Management API.
 *
 * Uses only the account access token (sbp_...) — no DB password needed.
 *
 *   $env:SUPABASE_ACCESS_TOKEN="sbp_..."
 *   bun scripts/supabase-migrate.ts <project-ref> [--apply]
 *
 * Without --apply it prints a diff-style report of what is missing vs
 * schema.sql. With --apply it applies the schema idempotently:
 *   - DDL is `create ... if not exists` / `drop+create policy`, so re-runs are safe
 *   - Seed rows use `on conflict` upserts so existing tenants are updated, not duplicated
 */

const REF = process.argv[2];
const APPLY = process.argv.includes("--apply");
const VERIFY = process.argv.includes("--verify");
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!REF) {
  console.error("usage: bun scripts/supabase-migrate.ts <project-ref> [--apply]");
  process.exit(1);
}
if (!TOKEN) {
  console.error("Set SUPABASE_ACCESS_TOKEN env var first.");
  process.exit(1);
}

const API = `https://api.supabase.com/v1/projects/${REF}/database/query`;

async function run(sql: string): Promise<any[]> {
  const res = await fetch(API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text.slice(0, 600)}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

const schema = await Bun.file("supabase/schema.sql").text();

// ---- 1. Inspect current remote state --------------------------------------
const existingTables = new Set(
  (await run(
    `select table_name from information_schema.tables where table_schema='public'`,
  )).map((r) => r.table_name),
);

let tenantCols = new Set<string>();
let chatbotCols = new Set<string>();
let existingSlugs = new Map<string, string>(); // slug -> name
let rls: Record<string, boolean> = {};
try {
  tenantCols = new Set(
    (await run(
      `select column_name from information_schema.columns where table_schema='public' and table_name='tenants'`,
    )).map((r) => r.column_name),
  );
} catch (e) {
  console.log("  (no tenants table yet)");
}
try {
  chatbotCols = new Set(
    (await run(
      `select column_name from information_schema.columns where table_schema='public' and table_name='chatbots'`,
    )).map((r) => r.column_name),
  );
} catch {
  /* empty */
}
try {
  existingSlugs = new Map(
    (await run(`select slug, name from public.tenants`)).map((r) => [r.slug, r.name]),
  );
} catch {
  /* empty */
}
try {
  rls = Object.fromEntries(
    (await run(
      `select relname, relrowsecurity from pg_class where relnamespace='public'::regnamespace`,
    )).map((r) => [r.relname, r.relrowsecurity]),
  );
} catch {
  /* empty */
}

// ---- 2. What schema.sql wants ---------------------------------------------
const wantTables = [
  "tenants",
  "chatbots",
  "conversations",
  "messages",
  "knowledge",
  "integrations",
  "usage_logs",
  "feedback",
  "carts",
  "tickets",
  "ticket_messages",
  "tenant_members",
];
const wantScopeCols = ["scope", "refusal_message"];
const wantTenantCols = ["support_email", "ticket_prefix"];
const wantTenantCols3 = ["industry", "avatar_url", "onboarding_complete", "default_ticket_priority", "auto_ticket_categories"];
const wantChatbotCols = ["public_id"];
const wantSeeds = ["ivy-pearls", "ntm-associates"];

console.log("=== Remote state ===");
console.log("Tables present : " + wantTables.map((t) => `${t}${existingTables.has(t) ? " ✓" : " MISSING"}`).join(", "));
console.log(
  "tenants cols   : " + wantScopeCols.map((c) => `${c}${tenantCols.has(c) ? " ✓" : " MISSING"}`).join(", "),
);
console.log(
  "tenants cols2  : " + wantTenantCols.map((c) => `${c}${tenantCols.has(c) ? " ✓" : " MISSING"}`).join(", "),
);
console.log(
  "tenants cols3  : " + wantTenantCols3.map((c) => `${c}${tenantCols.has(c) ? " ✓" : " MISSING"}`).join(", "),
);
console.log(
  "chatbots cols  : " + wantChatbotCols.map((c) => `${c}${chatbotCols.has(c) ? " ✓" : " MISSING"}`).join(", "),
);
console.log(
  "RLS enabled    : " + wantTables.map((t) => `${t}${rls[t] ? " ✓" : " (off)"}`).join(", "),
);
console.log(
  "Seed tenants   : " + wantSeeds.map((s) => `${s}${existingSlugs.has(s) ? " ✓" : " MISSING"}`).join(", "),
);

if (!APPLY && !VERIFY) {
  console.log("\nDry run — pass --apply to apply the schema.");
  process.exit(0);
}

if (VERIFY) {
  console.log("\n=== Verification ===");
  const tenants = await run(
    `select slug, scope->'allowedTopics' as topics, left(coalesce(refusal_message,'(null)'),60) as refusal from public.tenants order by slug`,
  );
  for (const t of tenants) console.log(`tenant ${t.slug}: topics=${t.topics} refusal="${t.refusal}"`);
  const bots = await run(`select id, public_id, active from public.chatbots order by id`);
  for (const b of bots) console.log(`chatbot ${b.id}: public=${b.public_id} active=${b.active}`);
  const kb = await run(`select chatbot_id, count(*) as n from public.knowledge group by chatbot_id order by chatbot_id`);
  for (const k of kb) console.log(`knowledge ${k.chatbot_id}: ${k.n} rows`);
  const pols = await run(`select tablename, count(*) as n from pg_policies where schemaname='public' group by tablename order by tablename`);
  for (const p of pols) console.log(`policies ${p.tablename}: ${p.n}`);
  process.exit(0);
}

console.log("\n=== Applying ===");

// schema.sql is ordered: TABLES -> seed: first tenant -> seed: second tenant -> RLS.
// Split on the section markers so each can be applied idempotently in order.
const seed1Idx = schema.indexOf("-- Seed: first tenant");
const seed2Idx = schema.indexOf("-- Seed: second tenant");
const rlsIdx = schema.indexOf("-- Row Level Security");

const tablesDdl = schema.slice(0, seed1Idx >= 0 ? seed1Idx : schema.length);
const seedIvy = seed1Idx >= 0 && seed2Idx >= 0 ? schema.slice(seed1Idx, seed2Idx) : "";
const seedNtm = seed2Idx >= 0 && rlsIdx >= 0 ? schema.slice(seed2Idx, rlsIdx) : "";
const rlsDdl = rlsIdx >= 0 ? schema.slice(rlsIdx) : "";

// Existing tenants table predates the policy engine, so `create table if not
// exists` is a no-op — add the new columns explicitly (idempotent).
await run(`
  alter table tenants add column if not exists scope jsonb not null default '{}'::jsonb;
  alter table tenants add column if not exists refusal_message text;
  alter table tenants add column if not exists support_email text;
  alter table tenants add column if not exists ticket_prefix text;
`);
console.log("0. tenants.scope / refusal_message / support_email / ticket_prefix columns ensured.");

await run(tablesDdl);
console.log("1. Tables + indexes applied (idempotent).");

// Seeds: ivy-pearls exists -> update policy only; ntm-associates missing -> full insert.
if (existingSlugs.has("ivy-pearls")) {
  await run(`
    update tenants set
      scope = '{"allowedTopics":["products","jewellery","orders","shipping","returns","payments","sizing","jewellery_care","gifts","store"],"securityLevel":"extra-strict","useModelClassifier":false}'::jsonb,
      refusal_message = 'I''m sorry, I can only help with Ivy & Pearls products, orders, delivery, returns and other services provided by Ivy & Pearls.',
      support_email = coalesce(support_email, 'support@ivyandpearls.co.uk'),
      ticket_prefix = coalesce(ticket_prefix, 'IP')
    where slug = 'ivy-pearls';
  `);
  console.log("2. Ivy & Pearls seed: already present -> policy upsert.");
} else {
  await run(seedIvy);
  console.log("2. Ivy & Pearls seed inserted.");
}

if (existingSlugs.has("ntm-associates")) {
  await run(`
    update tenants set
      scope = '{"allowedTopics":["accounting","bookkeeping","tax_services","payroll","business_services"],"securityLevel":"strict","useModelClassifier":false}'::jsonb,
      refusal_message = 'I''m sorry, I can only help with NTM Associates accountancy services — bookkeeping, tax, payroll, VAT and company accounts.',
      support_email = coalesce(support_email, 'contact@ntmassociatesltd.co.uk'),
      ticket_prefix = coalesce(ticket_prefix, 'NTM')
    where slug = 'ntm-associates';
  `);
  console.log("3. NTM Associates seed: already present -> policy upsert.");
} else {
  await run(seedNtm);
  console.log("3. NTM Associates seed inserted.");
}

await run(rlsDdl);
console.log("4. RLS enabled + isolation policies applied (drop+create, idempotent).");

console.log("\nDone.");
