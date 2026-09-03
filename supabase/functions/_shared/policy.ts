// Tenant Policy Engine — generic, tenant-configured scope boundary.
//
// IMPORTANT: business topics are DATA, not application code. This module must
// never contain retailer/accountant/legal/etc topic dictionaries. Each tenant
// supplies its own scope via tenants.scope.allowedTopics + business_context.
// The application only owns platform-wide safety controls.

import type { Tenant, TenantPolicy } from "./types.ts";

export interface GateResult {
  allowed: boolean;
  reason?: "injection" | "off-topic" | "empty" | "leak" | "ok";
}

// Platform-level prompt-injection / jailbreak patterns. These protect every
// tenant equally and are intentionally unrelated to any business vertical.
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

// Generic conversational turns are not business topics and should never be
// rejected by a tenant scope gate.
const OPENING_RE =
  /^(hi|hi there|hello|hello there|hey|yo|good (morning|afternoon|evening)|how are you|how'?s it going|thanks|thank you|thanks a lot|bye|goodbye|help|help me|i need help|what can you do|what can you help (me )?with|what do you do|what do you offer|how do you work|how does this work|start over|restart|are you there|who are you|what are you|welcome)\b/i;

function isOpening(message: string): boolean {
  return OPENING_RE.test(message.trim());
}

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "this", "that", "your", "you", "our",
  "are", "can", "could", "would", "what", "when", "where", "how", "about", "into",
  "have", "has", "had", "does", "do", "please", "help", "service", "services",
  "business", "customer", "customers", "information", "enquiry", "enquiries",
]);

function normalise(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function significantTokens(value: string): string[] {
  return normalise(value)
    .split(" ")
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

/**
 * Fast tenant-specific lexical check.
 *
 * allowedTopics are free-text tenant concepts, not keys into a global lexicon.
 * Values may describe any tenant-specific product, service, policy or support
 * area — the engine does not know or care which industry they belong to.
 */
export function hasOnTopicSignal(message: string, policy: TenantPolicy): boolean {
  const m = normalise(message);
  if (!m) return false;

  const concepts = [
    ...policy.allowedTopics,
    ...(policy.scopeContext ? [policy.scopeContext] : []),
  ].filter(Boolean);

  for (const concept of concepts) {
    const c = normalise(concept);
    if (!c) continue;
    if (m.includes(c) || c.includes(m)) return true;

    const conceptTokens = significantTokens(c);
    if (!conceptTokens.length) continue;
    const messageTokens = new Set(significantTokens(m));
    const matches = conceptTokens.filter((token) => messageTokens.has(token)).length;

    // One distinctive token is enough for a short topic label (e.g. "Payroll").
    // For longer descriptions require at least two token matches unless the
    // concept itself is only one significant token.
    if (conceptTokens.length === 1 && matches === 1) return true;
    if (matches >= 2) return true;
  }

  return false;
}

export function buildPolicy(tenant: Tenant): TenantPolicy {
  const configured = tenant.policy;
  const allowedTopics = Array.isArray(configured?.allowedTopics)
    ? configured!.allowedTopics.map((x) => String(x).trim()).filter(Boolean)
    : [];

  const scopeContext = [
    tenant.industry ? `Industry: ${tenant.industry}` : "",
    tenant.businessContext ? `Business: ${tenant.businessContext}` : "",
  ].filter(Boolean).join("\n");

  return {
    allowedTopics,
    scopeContext,
    refusalMessage:
      configured?.refusalMessage?.trim() ||
      `I'm sorry, I can only help with ${tenant.name} and enquiries related to this business.`,
    securityLevel: configured?.securityLevel ?? "strict",
    // Strict tenants should use semantic classification for messages that do
    // not have an obvious lexical match. This keeps scope safe without baking
    // any tenant's vocabulary into source code.
    useModelClassifier: configured?.useModelClassifier ?? true,
  };
}

export function checkInputSafety(message: string): GateResult {
  const m = message.trim();
  if (!m) return { allowed: false, reason: "empty" };
  if (INJECTION_PATTERNS.some((p) => p.test(m))) {
    return { allowed: false, reason: "injection" };
  }
  return { allowed: true, reason: "ok" };
}

/**
 * Tenant scope gate.
 *
 * 1. Generic conversation is allowed.
 * 2. Fast match against tenant-owned scope data.
 * 3. Ambiguous messages are semantically classified against tenant-owned
 *    scope data when configured.
 * 4. Strict modes fail closed if classification is unavailable/negative.
 */
export async function checkTopicGate(
  message: string,
  policy: TenantPolicy,
  classify?: (msg: string) => Promise<boolean>,
): Promise<GateResult> {
  const m = message.trim();
  if (!m) return { allowed: false, reason: "empty" };

  if (isOpening(m)) return { allowed: true, reason: "ok" };
  if (hasOnTopicSignal(m, policy)) return { allowed: true, reason: "ok" };

  if (policy.useModelClassifier && classify) {
    try {
      if (await classify(message)) return { allowed: true, reason: "ok" };
    } catch {
      // Strict modes deliberately fail closed on classifier failure.
    }
  }

  if (policy.securityLevel === "standard") {
    return { allowed: true, reason: "ok" };
  }

  return { allowed: false, reason: "off-topic" };
}

// Platform-wide leak detector. It contains no tenant or industry names.
const LEAK_RE =
  /\b(system prompt|system instructions|internal configuration|internal config|api ?key|access token|secret|credentials|tenant id|service role|bearer)\b/i;

export function checkOutputGate(
  reply: string,
  _tenant: Tenant,
  _policy: TenantPolicy,
  _productNames: string[] = [],
  _opts?: { authoritativeContext?: boolean },
): GateResult {
  const r = reply.trim();
  if (!r) return { allowed: false, reason: "empty" };
  if (LEAK_RE.test(r)) return { allowed: false, reason: "leak" };
  return { allowed: true, reason: "ok" };
}

export function refusalReply(policy: TenantPolicy): string {
  return policy.refusalMessage;
}
