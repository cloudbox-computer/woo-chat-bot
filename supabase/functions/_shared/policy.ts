// Tenant Policy Engine — the strict-scope boundary for the whole platform.
//
// The AI is never the authority on tenant boundaries; the application is.
// Every request passes through this policy engine BEFORE the LLM is contacted:
//
//   Gate 1  Tenant auth     (chatbotId resolved server-side -> tenant)
//   Gate 2  Input safety    (prompt-injection / jailbreak detection)
//   Gate 3  Topic gate      (tenant-scope ALLOWLIST, never a blocklist)
//   Gate 4  Main AI + tools (permission-filtered tool set, in agent.ts)
//   Gate 5  Output gate     (response validator)
//
// Gate 2/3/5 live here. Gate 1 is db.getChatbot/getTenantByChatbot (agent.ts).
// Gate 4 is the tool loop with permission filtering (agent.ts + tools.ts).
//
// "extra extra extra strict" behaviour:
//   - The topic gate uses an allowlist derived from the tenant's policy.
//   - Ambiguous messages FAIL CLOSED (rejected) unless a cheap classifier
//     says they're on-topic, or the tenant is deliberately "standard".
//   - Off-topic and injected requests get the tenant's FIXED refusal message,
//     never a free-form model reply, and never a wasted model call.

import type { Tenant, TenantPolicy } from "./types.ts";

export interface GateResult {
  allowed: boolean;
  reason?: "injection" | "off-topic" | "empty" | "leak" | "cross-tenant" | "ok";
}

// ---------------------------------------------------------------------------
// Topic lexicon: topic name -> words/phrases that signal it.
// Topic names are keys a tenant may list in policy.allowedTopics.
// ---------------------------------------------------------------------------

export const TOPIC_LEXICON: Record<string, string[]> = {
  // --- retail (jewellery / e-commerce) ---
  products: [
    "necklace", "necklaces", "pendant", "chain", "chains", "choker",
    "earring", "earrings", "hoop", "hoops", "stud", "studs",
    "bracelet", "bracelets", "bangle", "bangles",
    "ring", "rings", "signet", "gemstone", "gemstones",
    "jewellery", "jewelry", "jewel", "piece", "pieces",
    "product", "products", "catalogue", "collection",
    "in stock", "out of stock", "stock", "price", "prices",
  ],
  jewellery: [
    "gold", "silver", "rose gold", "white gold", "platinum",
    "pearl", "pearls", "diamond", "diamonds", "gemstone", "gemstones",
    "material", "materials", "metal", "plating", "plated",
    "14ct", "18ct", "9ct", "karat", "carat", "sterling",
  ],
  orders: [
    "order", "orders", "basket", "cart", "checkout",
    "place an order", "placed", "track my order", "where is my order",
    "dispatch", "shipped", "tracking",
  ],
  shipping: [
    "shipping", "delivery", "deliver", "delivery times", "delivery cost",
    "free delivery", "next day", "express", "how long", "scotland",
    "international delivery", "postcode", "uk delivery", "arrive",
  ],
  returns: [
    "return", "returns", "refund", "refunds", "exchange", "exchanges",
    "30 days", "return policy", "warranty", "send it back", "send back",
  ],
  payments: [
    "payment", "payments", "pay", "apple pay", "google pay", "paypal",
    "card", "credit card", "debit card", "stripe", "gift card", "voucher",
  ],
  sizing: [
    "size", "sizes", "sizing", "length", "fit", "fits", "ring size",
    "wrist", "measure", "measurements", "choker", "princess", "adjustable",
  ],
  jewellery_care: [
    "care", "clean", "cleaning", "cleaner", "polish", "tarnish",
    "waterproof", "water", "swimming", "shower", "showering",
    "hypoallergenic", "nickel", "sensitive skin", "maintenance", "storage", "lustre",
  ],
  gifts: [
    "gift", "gifts", "gift wrap", "gift wrapping", "gift box", "gift set",
    "anniversary", "birthday", "wedding", "bridal", "bridesmaid",
    "present", "valentine", "christmas", "mother's day", "father's day",
    "for my wife", "for my husband", "for my mum", "for my mum",
    "occasion", "special someone",
  ],
  store: [
    "ivy & pearls", "ivy and pearls", "your store", "your shop",
    "opening hours", "contact", "about you", "where are you based",
    "customer service", "support",
  ],
  // --- services (accountancy / professional) ---
  accounting: [
    "accountant", "accountants", "accounting", "accounts", "company accounts",
    "year end", "self assessment", "corporation tax", "ct600", "hmrc",
    "tax return", "tax returns", "tax planning", "capital allowances", "reliefs",
  ],
  bookkeeping: [
    "bookkeeping", "books", "xero", "quickbooks", "reconciliation", "ledger",
    "management accounts", "management reports", "receipts", "expenses", "cash flow",
  ],
  tax_services: [
    "tax", "vat", "mtd", "making tax digital", "vat return", "flat rate",
    "vat registration", "paye", "rti",
  ],
  payroll: [
    "payroll", "payslip", "payslips", "p60", "p45", "pension",
    "auto-enrolment", "ssp", "smp", "employees", "starter", "leaver",
  ],
  business_services: [
    "limited company", "incorporation", "incorporate", "companies house",
    "confirmation statement", "register", "registered", "sole trader", "contractor",
    "landlord", "freelancer", "startup", "business support", "quote", "quotes",
    "fees", "pricing", "how much", "cost", "contact", "email", "phone",
    "rochdale", "opening hours", "ntm associates", "ntm-associates",
  ],
};

export const RETAIL_DEFAULT_TOPICS = [
  "products", "jewellery", "orders", "shipping", "returns",
  "payments", "sizing", "jewellery_care", "gifts", "store",
];

export const SERVICES_DEFAULT_TOPICS = [
  "accounting", "bookkeeping", "tax_services", "payroll", "business_services",
];

// ---------------------------------------------------------------------------
// Off-topic signals (pre-filter only — the allowlist is the authority).
// The blocklist exists purely so we can reject "obvious" unrelated messages
// cheaply without spending a classifier call. Do NOT add bare tokens that
// could appear in legit tenant copy (e.g. "apple"/"google" clash with
// Apple Pay / Google Pay; "policy" appears in "returns policy").
// ---------------------------------------------------------------------------

const OFF_TOPIC_PATTERNS: RegExp[] = [
  // politics / government / war
  /\b(politics|political|politician|election|vote|voting|government|prime minister|president|parliament|brexit|military|war|warfare)\b/i,
  // news / current events
  /\b(news|current events|headline|breaking news)\b/i,
  // weather
  /\b(weather|forecast|temperature|rainfall|snowfall)\b/i,
  // coding / software
  /\b(code|coding|programming|python|javascript|typescript|java|software|bug|debug|api|script|developer|algorithm|css|html|react|database|sql|computer|hacking|cyber)\b/i,
  // maths
  /\b(maths|math|mathematics|equation|algebra|calculus|trigonometry|geometry|integral|derivative)\b/i,
  // sports
  /\b(sports|sport|football|soccer|cricket|tennis|rugby|golf|hockey|world cup|premier league|olympics)\b/i,
  // entertainment
  /\b(movie|movies|film|films|song|songs|music|celebrity|actor|actress|netflix|spotify|video game|gaming)\b/i,
  // general knowledge / homework / lifestyle
  /\b(capital of|history of|homework|essay|recipe|recipes|how to cook|cooking|baking|travel tips|tourism|horoscope|astrology)\b/i,
  // famous people / other companies (avoid apple/google clash with Pay)
  /\b(elon|musk|bill gates|steve jobs|mark zuckerberg|donald trump|obama|trump|tesla|microsoft|amazon|netflix|facebook|whatsapp)\b/i,
  // meta / assistant-identity probes
  /\b(write me a|tell me a story|tell me a joke|write an essay|write a poem|meaning of life|are you human|who are you really)\b/i,
];

// ---------------------------------------------------------------------------
// Prompt-injection / jailbreak patterns (Gate 2).
// ---------------------------------------------------------------------------

const INJECTION_PATTERNS: RegExp[] = [
  /\b(ignore (all |any |your |the |previous |prior )*(instructions|prompts|rules|system)|ignore your)\b/i,
  /\b(previous instructions|previous prompt|system prompt|system instructions|your instructions|the instructions)\b/i,
  /\byou are now\b/i,
  /\b(pretend (you are|to be)|act as (a |an |the )?|simulate being)\b/i,
  /\b(forget everything|forget all (of )?(your )?(instructions|rules)|forget that you|forget you'?re)\b/i,
  /\b(jailbreak|developer mode|dan mode|overlord mode|sudo mode)\b/i,
  /\b(reveal|disclose|leak|show me) (your |the )?(system|instructions|prompt|tools|credentials|api ?key|secret|config|internal)\b/i,
  /\b(what (are|were) your instructions|tell me your (instructions|prompt|system)|what instructions (were|have) you)\b/i,
  /\b(override|disregard|bypass|circumvent) (your|the|these|all) (instructions|rules|restrictions|safety)\b/i,
  /\b(you are not (bound|allowed|restricted)|you don'?t have to follow|don'?t follow (your|the) (instructions|rules))\b/i,
  /\b(prompt injection|play the role of|become a general|pretend to be a general)\b/i,
];

// ---------------------------------------------------------------------------
// Opening / pleasantry detection — always allowed so a conversation can start.
// ---------------------------------------------------------------------------

const OPENING_RE =
  /^(hi|hi there|hello|hello there|hey|yo|good (morning|afternoon|evening)|how are you|how'?s it going|thanks|thank you|thanks a lot|bye|goodbye|help|help me|i need help|what can you do|what can you help (me )?with|what do you do|what do you sell|what do you offer|how do you work|how does this work|start over|restart|are you there|who are you|what are you|welcome)\b/i;

function isOpening(m: string): boolean {
  return OPENING_RE.test(m.trim());
}

// ---------------------------------------------------------------------------
// Policy construction
// ---------------------------------------------------------------------------

export function buildPolicy(tenant: Tenant): TenantPolicy {
  const retail = tenant.kind !== "services";
  const p = tenant.policy;
  return {
    allowedTopics:
      p?.allowedTopics?.length
        ? p.allowedTopics
        : retail
          ? [...RETAIL_DEFAULT_TOPICS]
          : [...SERVICES_DEFAULT_TOPICS],
    refusalMessage:
      p?.refusalMessage ??
      `I'm sorry, I can only help with ${tenant.name} products, orders, delivery, returns and other services provided by ${tenant.name}.`,
    securityLevel: p?.securityLevel ?? (retail ? "extra-strict" : "strict"),
    useModelClassifier: p?.useModelClassifier ?? false,
  };
}

export function hasOnTopicSignal(message: string, policy: TenantPolicy): boolean {
  const m = message.toLowerCase();
  for (const topic of policy.allowedTopics) {
    const words = TOPIC_LEXICON[topic];
    if (!words) continue;
    for (const w of words) {
      if (m.includes(w)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Order-tracking / contact follow-up signals (Gate 3).
//
// Mid-flow a customer may reply with ONLY their order number and/or checkout
// email (e.g. "#314 amelia@example.com") without repeating any topic keyword.
// These are unambiguous order/contact signals and must stay in-scope, or the
// strict allowlist would refuse a legitimate order lookup. A bare number with
// no order marker or email still fails closed.
// ---------------------------------------------------------------------------

const ORDER_MARKER_RE = /\b(order\s*#?\s*\d+|#\s*\d{2,})\b/i;
const EMAIL_RE = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i;

function hasOrderFollowUpSignal(m: string): boolean {
  return EMAIL_RE.test(m) || ORDER_MARKER_RE.test(m);
}

// ---------------------------------------------------------------------------
// Support-ticket signals (convo2 — Gate 3).
//
// A customer describing a problem that needs human help (damaged item, missing
// order, wrong product, defect, complaint, explicit "speak to support" request)
// may not use a topic keyword the allowlist recognises. These messages must
// still pass the topic gate so the AI can offer create_ticket. The AI still
// confirms before raising a ticket — the gate only decides what reaches it.
// ---------------------------------------------------------------------------

const TICKET_SIGNALS: RegExp[] = [
  /\b(damaged|damage|broken|broke|faulty|fault|defective|defect|malfunction|not working|stopped working)\b/i,
  /\b(missing|haven'?t received|never arrived|didn'?t arrive|not (been )?delivered)\b/i,
  /\b(wrong (item|product|order|size)|incorrect (item|product|order))\b/i,
  /\b(complaint|complain|complained)\b/i,
  /\b(speak to|talk to|contact|see|reach) (a |the )?(human|support|someone|person|agent|team)\b/i,
  /\b(refund (problem|issue)|refund not (received|arrived)|no refund)\b/i,
];

function hasTicketSignal(m: string): boolean {
  return TICKET_SIGNALS.some((p) => p.test(m));
}

// ---------------------------------------------------------------------------
// Gate 2 — Input safety / prompt injection
// ---------------------------------------------------------------------------

export function checkInputSafety(message: string): GateResult {
  const m = message.trim();
  if (!m) return { allowed: false, reason: "empty" };
  if (INJECTION_PATTERNS.some((p) => p.test(m))) {
    return { allowed: false, reason: "injection" };
  }
  return { allowed: true, reason: "ok" };
}

// ---------------------------------------------------------------------------
// Gate 3 — Topic gate (tenant-scope allowlist)
// ---------------------------------------------------------------------------

/**
 * Deterministic allowlist gate. `classify` is an optional cheap classifier
 * used only for ambiguous messages when policy.useModelClassifier is set.
 */
export async function checkTopicGate(
  message: string,
  policy: TenantPolicy,
  classify?: (msg: string) => Promise<boolean>,
): Promise<GateResult> {
  const m = message.trim().toLowerCase();
  if (!m) return { allowed: false, reason: "empty" };

  if (isOpening(m)) return { allowed: true, reason: "ok" };

  if (hasOnTopicSignal(m, policy)) return { allowed: true, reason: "ok" };

  // Obvious off-topic → reject without spending a model call.
  if (OFF_TOPIC_PATTERNS.some((p) => p.test(m))) {
    return { allowed: false, reason: "off-topic" };
  }

  // Order-tracking / contact follow-up ("#314 amelia@example.com", "314",
  // "amelia@example.com") — no topic keyword repeated, but clearly order scope.
  if (hasOrderFollowUpSignal(m)) return { allowed: true, reason: "ok" };

  // Support-ticket signals ("my necklace arrived damaged", "I need to speak
  // to support") — in-scope; the AI may offer create_ticket for these.
  if (hasTicketSignal(m)) return { allowed: true, reason: "ok" };

  // Ambiguous. Fail closed unless a cheap classifier approves it.
  if (policy.securityLevel !== "standard") {
    if (policy.useModelClassifier && classify) {
      try {
        if (await classify(message)) return { allowed: true, reason: "ok" };
      } catch {
        // classifier failure → stay closed
      }
    }
    return { allowed: false, reason: "off-topic" };
  }
  return { allowed: true, reason: "ok" };
}

// ---------------------------------------------------------------------------
// Gate 5 — Output gate (response validator)
// ---------------------------------------------------------------------------

const LEAK_RE =
  /\b(system prompt|system instructions|internal configuration|internal config|api ?key|access token|secret|credentials|tenant id|service role|bearer)\b/i;

/** Other tenants the model must never mention in another tenant's reply. */
const OTHER_TENANT_NAMES = ["ntm associates", "ntm-associates", "ivy & pearls", "ivy and pearls"];

export function checkOutputGate(reply: string, tenant: Tenant, policy: TenantPolicy): GateResult {
  const r = reply.trim();
  if (!r) return { allowed: false, reason: "empty" };

  const low = r.toLowerCase();

  if (LEAK_RE.test(low)) return { allowed: false, reason: "leak" };

  const self = tenant.name.toLowerCase();
  for (const n of OTHER_TENANT_NAMES) {
    if (n !== self && low.includes(n)) return { allowed: false, reason: "cross-tenant" };
  }

  // If the model produced an obviously off-topic reply (went off the rails),
  // discard it and fall back to the fixed refusal.
  if (OFF_TOPIC_PATTERNS.some((p) => p.test(r))) {
    return { allowed: false, reason: "off-topic" };
  }

  return { allowed: true, reason: "ok" };
}

// ---------------------------------------------------------------------------
// Fixed refusal response (§10) — the ONLY thing an out-of-scope customer sees.
// ---------------------------------------------------------------------------

export function refusalReply(policy: TenantPolicy): string {
  return policy.refusalMessage;
}
