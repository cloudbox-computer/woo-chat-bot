// E2E test for the convo3.md onboarding + dashboard edge functions against live Supabase.
// Run:  node_modules\.bin\deno.exe run --allow-all tests/dashboard-e2e.ts
//
// Flow: sign up a fresh auth user -> run onboarding wizard -> exercise the
// dashboard actions (overview / config / knowledge / tickets / integrations).
const SUPABASE_URL = "https://xsegdfcqqktxoqlbazpl.supabase.co";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhzZWdkZmNxcWt0eG9xbGJhenBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMzIzNjIsImV4cCI6MjEwMTgwODM2Mn0.sYZ4DchDZL9RefAyrDBs-L5ChJKMAFqNJ3XbDlbjLy8";
const AUTH_URL = `${SUPABASE_URL}/auth/v1`;
const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    passed++;
    console.log(`PASS [${name}]`);
  } else {
    failed++;
    console.log(`FAIL [${name}] ${detail ? JSON.stringify(detail).slice(0, 400) : ""}`);
  }
}

async function callFn(
  fn: string,
  token: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${FUNCTIONS_URL}/${fn}`, {
    method: opts.method ?? "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(opts.method && opts.method !== "POST" && opts.method !== "OPTIONS"
        ? {}
        : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

// ---- 1. Create a confirmed user via the admin API + sign in ----------------
// (Project has mailer_autoconfirm=false, so a plain signup would need email
// confirmation. The admin API lets us create a user with email_confirm=true,
// which is what the dashboard's signup flow produces after confirmation.)
const SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhzZWdkZmNxcWt0eG9xbGJhenBsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NjIzMjM2MiwiZXhwIjoyMTAxODA4MzYyfQ.CWbWjOG_Et3k-pnyjI_KxWsFzLkwSMz1bpmx0gvbOT8";
const email = `dash-e2e-${Date.now()}@example.com`;
const password = "Test1234!";
console.log(`\n== Creating confirmed user ${email}`);
const createRes = await fetch(`${AUTH_URL}/admin/users`, {
  method: "POST",
  headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ email, password, email_confirm: true }),
});
const created = await createRes.json();
const userId: string | undefined = created.id;
ok("admin creates user", Boolean(userId), created);

const signinRes = await fetch(`${AUTH_URL}/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});
const signin = await signinRes.json();
const token: string | undefined = signin.access_token;
ok("sign-in returns session token", Boolean(token), signin);

// ---- 2. Onboarding wizard --------------------------------------------------
console.log("\n== Onboarding wizard");
const wizard = {
  name: `E2E Boutique ${Date.now() % 100000}`,
  industry: "jewellery",
  website: "https://e2e-boutique.example.com",
  businessContext: "A small test jewellery shop used for the dashboard e2e.",
  supportEmail: "saqjewelleryshop@gmail.com",
  ticketPrefix: "E2E",
  botName: "Bella",
  welcomeMessage: "Hi! Welcome to E2E Boutique.",
  tone: "friendly",
  brandColour: "#7c3aed",
  allowedTopics: ["products", "orders", "returns", "support"],
  securityLevel: "strict",
  knowledge: [
    {
      title: "Shipping policy",
      content: "We ship within 2 working days with free tracked delivery over £50.",
      keywords: ["shipping", "delivery", "tracked"],
    },
    {
      title: "Returns",
      content: "Returns accepted within 30 days of delivery.",
      keywords: ["returns", "refund", "30 days"],
    },
  ],
  integrations: [
    {
      provider: "woocommerce",
      credentials: { url: "https://e2e-boutique.example.com", consumer_key: "ck_test", consumer_secret: "cs_test" },
    },
  ],
  defaultTicketPriority: "high",
  autoTicketCategories: ["damaged", "refund", "order_query"],
};

const onb = await callFn("onboarding", token!, { body: wizard });
ok("onboarding returns ok", onb.json?.ok === true, onb.json);
ok("onboarding returns tenantId + slug", Boolean(onb.json?.tenantId && onb.json?.slug), onb.json);
ok("onboarding returns embedScript", String(onb.json?.embedScript ?? "").includes("widget?tenant="), onb.json?.embedScript);
const slug: string = onb.json?.slug;

// ---- 3. Dashboard: overview ------------------------------------------------
console.log("\n== Dashboard overview");
const ov = await callFn("dashboard?action=overview", token!, { method: "GET" });
ok("overview 200", ov.status === 200, ov);
ok("overview has stats", ov.json?.conversations !== undefined && Array.isArray(ov.json?.recentConversations), ov.json);

// ---- 4. Dashboard: config --------------------------------------------------
console.log("\n== Dashboard config");
const cfg = await callFn("dashboard?action=config", token!, { method: "GET" });
ok("config 200", cfg.status === 200, cfg);
ok("config returns tenant", cfg.json?.tenant?.name === wizard.name, cfg.json?.tenant);
ok("config returns chatbots", Array.isArray(cfg.json?.chatbots), cfg.json);
ok("config returns embedScript", Boolean(cfg.json?.embedScript), cfg.json);

// update config
const upd = await callFn("dashboard?action=config", token!, {
  method: "PUT",
  body: { name: `${wizard.name} v2`, defaultTicketPriority: "urgent", autoTicketCategories: ["a", "b"] },
});
ok("config PUT 200", upd.status === 200, upd);
const cfg2 = await callFn("dashboard?action=config", token!, { method: "GET" });
ok("config updated name", cfg2.json?.tenant?.name === `${wizard.name} v2`, cfg2.json?.tenant?.name);
ok("config updated priority", cfg2.json?.tenant?.defaultTicketPriority === "urgent", cfg2.json?.tenant?.defaultTicketPriority);

// ---- 5. Knowledge CRUD -----------------------------------------------------
console.log("\n== Knowledge CRUD");
const kbList = await callFn("dashboard?action=knowledge", token!, { method: "GET" });
ok("knowledge list has 2 items", Array.isArray(kbList.json?.items) && kbList.json.items.length === 2, kbList.json);

const kbAdd = await callFn("dashboard?action=knowledge", token!, {
  method: "POST",
  body: { title: "Payment methods", content: "We accept cards and PayPal.", keywords: ["pay", "card", "paypal"] },
});
ok("knowledge add ok", (kbAdd.status === 200 || kbAdd.status === 201) && Boolean(kbAdd.json?.item?.id), kbAdd.json);

const kbId: string = kbAdd.json?.item?.id;
const kbEdit = await callFn(`dashboard?action=knowledge&id=${kbId}`, token!, {
  method: "PUT",
  body: { content: "We accept cards, PayPal and Apple Pay." },
});
ok("knowledge edit ok", kbEdit.status === 200, kbEdit);

const kbDel = await callFn(`dashboard?action=knowledge&id=${kbId}`, token!, {
  method: "DELETE",
});
ok("knowledge delete ok", kbDel.status === 200, kbDel);

// ---- 6. Integrations -------------------------------------------------------
console.log("\n== Integrations");
const ints = await callFn("dashboard?action=integrations", token!, { method: "GET" });
ok("integrations 200", ints.status === 200, ints);
ok("integrations returns woocommerce without secrets", ints.json?.items?.[0]?.provider === "woocommerce" && !JSON.stringify(ints.json).includes("ck_test"), ints.json);

// ---- 7. Tickets ------------------------------------------------------------
console.log("\n== Tickets");
const tickets = await callFn("dashboard?action=tickets", token!, { method: "GET" });
ok("tickets 200 + empty list", tickets.status === 200 && Array.isArray(tickets.json?.items), tickets.json);

// ---- 8. Auth guard: no token must 401 --------------------------------------
console.log("\n== Auth guard");
const noAuth = await fetch(`${FUNCTIONS_URL}/dashboard?action=overview`, { method: "GET" });
ok("dashboard without token 401", noAuth.status === 401, noAuth.status);

// ---- 9. Cleanup: delete the test user (via service role) -------------------
console.log("\n== Cleanup");
if (userId) {
  const del = await fetch(`${AUTH_URL}/admin/users/${userId}`, {
    method: "DELETE",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  ok(`cleanup deleted user ${del.status}`, del.status === 200 || del.status === 204, del.status);
} else {
  ok("cleanup user id present", false);
}

console.log(`\n${passed} passed, ${failed} failed`);
Deno.exit(failed > 0 ? 1 : 0);
