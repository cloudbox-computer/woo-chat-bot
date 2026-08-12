// Onboarding edge function (convo3.md §Onboarding).
//
// POST /onboarding   — authenticated (verify_jwt=true).
//
// The tenant-dashboard wizard calls this once per signup. It atomically
// creates: the tenant row, the owning tenant_members row (linking the auth
// user), the default chatbot, seed knowledge items and the WooCommerce
// integration. On completion the tenant is marked onboarding_complete and the
// dashboard can move the user to the "Install" step.
//
// Body (all optional, server applies defaults):
//   {
//     name, industry, website, businessContext, supportEmail, ticketPrefix,
//     botName, welcomeMessage, tone, brandColour,
//     allowedTopics: string[],        // topic-gate allowlist
//     securityLevel: "standard"|"strict"|"extra-strict",
//     knowledge: [{ title, content, keywords }],
//     integrations: [{ provider:"woocommerce", credentials:{url,consumer_key,consumer_secret} }],
//     defaultTicketPriority, autoTicketCategories: string[]
//   }
import { DashboardError, authUserFromRequest, embedScriptFor, slugify } from "../_shared/dashboard.ts";
import { handleOptions, json } from "../_shared/cors.ts";
import { env, supabaseConfig, aiConfig, modelFor } from "../_shared/env.ts";
import { OpenAiCompatibleProvider } from "../_shared/ai.ts";

interface WizardKnowledge {
  title: string;
  content: string;
  keywords?: string[];
}
interface WizardIntegration {
  provider: "woocommerce";
  credentials: Record<string, string>;
}

interface OnboardingBody {
  name?: string;
  industry?: string;
  website?: string;
  businessContext?: string;
  supportEmail?: string;
  ticketPrefix?: string;
  botName?: string;
  welcomeMessage?: string;
  tone?: string;
  brandColour?: string;
  allowedTopics?: string[];
  securityLevel?: "standard" | "strict" | "extra-strict";
  knowledge?: WizardKnowledge[];
  integrations?: WizardIntegration[];
  defaultTicketPriority?: string;
  autoTicketCategories?: string[];
}

const TICKET_PREFIX_RE = /^[A-Za-z0-9]{1,4}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEX_RE = /^#?[0-9a-fA-F]{6}$/;

export async function handleOnboarding(req: Request): Promise<Response> {
  const user = authUserFromRequest(req);
  if (!user) throw new DashboardError("Not authenticated", 401);

  const body = (await req.json().catch(() => ({}))) as OnboardingBody;
  const name = (body.name ?? "").trim();
  if (!name) throw new DashboardError("Business name is required");

  const { url, serviceRoleKey } = supabaseConfig();
  const base = `${url}/rest/v1`;
  const headers: Record<string, string> = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };

  // --- tenant -------------------------------------------------------------
  const tenantId = crypto.randomUUID();
  const slug = slugify(name);
  const supportEmail = (body.supportEmail ?? "").trim() || undefined;
  if (supportEmail && !EMAIL_RE.test(supportEmail)) {
    throw new DashboardError("Support email looks invalid");
  }
  const ticketPrefix = (body.ticketPrefix ?? "").trim().toUpperCase() || undefined;
  if (ticketPrefix && !TICKET_PREFIX_RE.test(ticketPrefix)) {
    throw new DashboardError("Ticket prefix must be 1-4 letters/numbers");
  }
  const brandColour = body.brandColour;
  if (brandColour && !HEX_RE.test(brandColour)) {
    throw new DashboardError("Brand colour must be a hex value like #7c3aed");
  }

  const scope = {
    allowedTopics: Array.isArray(body.allowedTopics) ? body.allowedTopics : [],
    securityLevel: ["standard", "strict", "extra-strict"].includes(body.securityLevel ?? "")
      ? body.securityLevel
      : "strict",
  };
  const refusalMessage =
    `I'm sorry, I can only help with ${name} products, orders, delivery, returns and other services provided by ${name}.`;

  const tenantRow = {
    id: tenantId,
    slug,
    name,
    store_url: (body.website ?? "").trim() || null,
    currency: "GBP",
    welcome_message: (body.welcomeMessage ?? `Hi! Welcome to ${name}. How can I help today?`).trim(),
    tone: (body.tone ?? "friendly").trim() || null,
    brand_colour: brandColour ? (brandColour.startsWith("#") ? brandColour : `#${brandColour}`) : null,
    business_context: (body.businessContext ?? "").trim() || null,
    industry: (body.industry ?? "").trim() || null,
    support_email: supportEmail ?? null,
    ticket_prefix: ticketPrefix ?? null,
    scope,
    refusal_message: refusalMessage,
    default_ticket_priority: (body.defaultTicketPriority ?? "normal").trim() || "normal",
    auto_ticket_categories: JSON.stringify(
      Array.isArray(body.autoTicketCategories) ? body.autoTicketCategories : [],
    ),
    onboarding_complete: true,
  };
  const resTenant = await fetch(`${base}/tenants`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify(tenantRow),
  });
  if (!resTenant.ok) throw new DashboardError(`Failed to create tenant: ${resTenant.status}`, 502);

  // --- owner membership ---------------------------------------------------
  const resMember = await fetch(`${base}/tenant_members`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({ tenant_id: tenantId, user_id: user.id, role: "owner" }),
  });
  if (!resMember.ok) throw new DashboardError("Failed to link account to tenant", 502);

  // --- chatbot ------------------------------------------------------------
  const chatbotId = slug;
  const botName = (body.botName ?? "").trim() || name;
  // Opaque public widget id ("cb_..."): the customer embed snippet references
  // this instead of the internal slug or the Supabase project URL (convo4.md).
  const publicId = `cb_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
  const resBot = await fetch(`${base}/chatbots`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({
      id: chatbotId,
      tenant_id: tenantId,
      name: botName,
      active: true,
      public_id: publicId,
      config: {
        permissions: ["read", "cart", "support"],
        welcome: (body.welcomeMessage ?? "").trim(),
        tone: (body.tone ?? "friendly").trim(),
        avatar_url: null,
      },
    }),
  });
  if (!resBot.ok) throw new DashboardError("Failed to create chatbot", 502);

  // --- knowledge ----------------------------------------------------------
  const knowledge = Array.isArray(body.knowledge) ? body.knowledge : [];
  for (const k of knowledge.slice(0, 200)) {
    const title = (k.title ?? "").trim();
    const content = (k.content ?? "").trim();
    if (!title || !content) continue;
    const res = await fetch(`${base}/knowledge`, {
      method: "POST",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({
        chatbot_id: chatbotId,
        title,
        content,
        keywords: Array.isArray(k.keywords) ? k.keywords : [],
      }),
    });
    if (!res.ok) throw new DashboardError("Failed to save knowledge item", 502);
  }

  // --- integrations -------------------------------------------------------
  const integrations = Array.isArray(body.integrations) ? body.integrations : [];
  const woo = integrations.find((i) => i.provider === "woocommerce");
  if (woo && woo.credentials) {
    const res = await fetch(`${base}/integrations`, {
      method: "POST",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({
        tenant_id: tenantId,
        provider: "woocommerce",
        credentials: woo.credentials,
        active: true,
      }),
    });
    if (!res.ok) throw new DashboardError("Failed to save WooCommerce integration", 502);
  }

  const embedScript = embedScriptFor(publicId);

  return json({
    ok: true,
    tenantId,
    slug,
    chatbotId,
    publicId,
    embedScript,
    next: "install", // wizard step to land on after onboarding
  });
}

// ---------------------------------------------------------------------------
// Analyze website handler
// ---------------------------------------------------------------------------

const ANALYZE_SYSTEM_PROMPT = `You are an expert at analyzing e-commerce websites and extracting business information for chatbot onboarding.

Given a website, analyze it and return ONLY valid JSON (no markdown, no explanation, no code blocks) with this exact shape:
{"name":"Business name","industry":"Industry name","businessContext":"Key business details like shipping, returns, products","botName":"Suggested assistant name","welcomeMessage":"A friendly welcome message for customers","tone":"friendly","brandColour":"#hexcolor","allowedTopics":["products","orders","returns","support"],"securityLevel":"strict","knowledge":[{"title":"FAQ Title","content":"Answer content","keywords":["keyword1","keyword2"]}]}`;

interface AnalyzeWebsiteInput {
  url: string;
}

interface AnalyzeWebsiteOutput {
  name: string;
  industry?: string;
  businessContext?: string;
  botName?: string;
  welcomeMessage?: string;
  tone?: string;
  brandColour?: string;
  allowedTopics?: string[];
  securityLevel?: string;
  knowledge?: Array<{ title: string; content: string; keywords?: string[] }>;
}

async function scrapeWebsite(url: string): Promise<string> {
  const urlsToTry = [
    url,
    url.replace(/\/$/, ""),
    url.startsWith("https://") ? url.replace("https://", "http://") : url,
  ];

  let cssColors: string[] = [];
  let ogColor: string | null = null;

  for (const tryUrl of urlsToTry) {
    try {
      const res = await fetch(tryUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; ChatBotHelper/1.0)",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) continue;

      const html = await res.text();

      // Extract Open Graph color if present
      const ogColorMatch = html.match(/<meta\s+property="og:color"\s+content="([^"]+)"/i);
      if (ogColorMatch) ogColor = ogColorMatch[1];

      // Extract hex colors from inline styles
      const inlineStyles = html.match(/style="([^"]*)"/g) || [];
      for (const style of inlineStyles) {
        const colorMatch = style.match(/(?:#|color|background|bgcolor)\s*[:=]\s*(#[0-9a-fA-F]{3,8})/i);
        if (colorMatch && !cssColors.includes(colorMatch[1])) {
          cssColors.push(colorMatch[1]);
        }
      }

      // Extract colors from <style> blocks
      const styleBlocks = html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) || [];
      for (const block of styleBlocks) {
        const hexMatches = block.match(/#[0-9a-fA-F]{3,8}/g) || [];
        for (const hex of hexMatches) {
          if (!cssColors.includes(hex)) cssColors.push(hex);
        }
      }

      // Extract colors from CSS color() functions
      const colorFnMatches = html.match(/color\s*\([^)]+\)/gi) || [];
      for (const fn of colorFnMatches) {
        const rgbMatch = fn.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/i);
        if (rgbMatch) {
          const r = parseInt(rgbMatch[1]).toString(16).padStart(2, "0");
          const g = parseInt(rgbMatch[2]).toString(16).padStart(2, "0");
          const b = parseInt(rgbMatch[3]).toString(16).padStart(2, "0");
          const hex = `#${r}${g}${b}`;
          if (!cssColors.includes(hex)) cssColors.push(hex);
        }
      }

      const text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      // Append CSS colors info for the AI to consider
      const uniqueColors = [...new Set(cssColors)].slice(0, 10);
      const colorInfo = uniqueColors.length > 0 ? `\n\nCSS_COLORS: ${uniqueColors.join(", ")}` : "";
      const ogInfo = ogColor ? `\nOG_COLOR: ${ogColor}` : "";

      return (text + colorInfo + ogInfo).slice(0, 8000);
    } catch {
      continue;
    }
  }

  throw new Error("Could not fetch the website");
}

async function handleAnalyzeWebsite(req: Request): Promise<Response> {
  const user = authUserFromRequest(req);
  if (!user) throw new DashboardError("Not authenticated", 401);

  const body = (await req.json().catch(() => ({}))) as AnalyzeWebsiteInput;
  const url = (body.url ?? "").trim();
  if (!url) throw new DashboardError("Website URL is required");

  try {
    new URL(url);
  } catch {
    throw new DashboardError("Invalid URL format");
  }

  const aiCfg = aiConfig();
  const provider = new OpenAiCompatibleProvider({
    name: aiCfg.provider,
    apiKey: aiCfg.openaiKey ?? aiCfg.geminiKey ?? "",
    baseUrl: aiCfg.openaiBaseUrl,
  });

  let websiteContent: string;
  try {
    websiteContent = await scrapeWebsite(url);
  } catch (err) {
    throw new DashboardError(err instanceof Error ? err.message : "Failed to scrape website");
  }

  if (!websiteContent || websiteContent.length < 100) {
    throw new DashboardError("Website content too short to analyze. Try a different URL.");
  }

  const model = modelFor(aiCfg.provider, aiCfg);

  let result: AnalyzeWebsiteOutput;
  try {
    const chatResult = await provider.chat({
      model,
      system: ANALYZE_SYSTEM_PROMPT,
      history: [],
      userMessage: `Analyze this website content and extract business information:\n\n${websiteContent}`,
      tools: [],
    });

    let rawContent = chatResult.content?.trim() ?? "";

    // Strip markdown code fences if present
    rawContent = rawContent.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/g, "");

    // Try to extract valid JSON by finding the last closing brace
    // This handles cases where the AI appends text after the JSON
    let jsonStr = rawContent;
    const lastBrace = rawContent.lastIndexOf("}");
    if (lastBrace > 0) {
      jsonStr = rawContent.slice(0, lastBrace + 1);
    }

    try {
      result = JSON.parse(jsonStr) as AnalyzeWebsiteOutput;
    } catch {
      // Try extracting just the first JSON object
      const jsonMatch = rawContent.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]) as AnalyzeWebsiteOutput;
      } else {
        throw new DashboardError("AI returned invalid JSON response");
      }
    }
  } catch (err) {
    if (err instanceof DashboardError) throw err;
    throw new DashboardError(err instanceof Error ? err.message : "AI analysis failed");
  }

  if (!result.name) {
    throw new DashboardError("Could not extract business name from website");
  }

  return json({
    success: true,
    data: {
      name: result.name,
      industry: result.industry,
      businessContext: result.businessContext,
      botName: result.botName,
      welcomeMessage: result.welcomeMessage,
      tone: result.tone,
      brandColour: result.brandColour,
      allowedTopics: result.allowedTopics,
      securityLevel: result.securityLevel,
      knowledge: result.knowledge,
    },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleOptions();

  const url = new URL(req.url);
  const path = url.pathname;

  // Route: /onboarding/analyze
  if (path === "/onboarding/analyze" || path === "/onboarding/analyze/") {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    try {
      return await handleAnalyzeWebsite(req);
    } catch (err) {
      console.error("analyze website error", err);
      if (err instanceof DashboardError) return json({ error: err.message }, err.status);
      return json({ error: "Internal error" }, 500);
    }
  }

  // Route: /onboarding (original)
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    return await handleOnboarding(req);
  } catch (err) {
    console.error("onboarding error", err);
    if (err instanceof DashboardError) return json({ error: err.message }, err.status);
    return json({ error: "Internal error" }, 500);
  }
});
