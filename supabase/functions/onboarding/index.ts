// Onboarding edge function (convo3.md §Onboarding).
//
// POST /onboarding   — authenticated (verify_jwt=true).
//
// The tenant-dashboard wizard completes an existing tenant created by the
// dashboard. It NEVER creates a tenant itself. The supplied tenantId is
// membership-checked, then the tenant, chatbot, knowledge and integrations are
// updated idempotently. On completion the same tenant is marked
// onboarding_complete and the dashboard can move to the "Install" step.
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
import { DashboardError, authUserFromRequest, embedScriptFor } from "../_shared/dashboard.ts";
import { handleOptions, json } from "../_shared/cors.ts";
import { env, supabaseConfig, aiConfig, modelFor } from "../_shared/env.ts";
import { OpenAiCompatibleProvider } from "../_shared/ai.ts";

interface WizardKnowledge {
  title: string;
  content: string;
  keywords?: string[];
}
interface WizardIntegration {
  provider: "woocommerce" | "supabase";
  credentials: Record<string, string>;
}

interface OnboardingBody {
  tenantId?: string;
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
  // If the dashboard created an incomplete tenant before launching this
  // wizard, complete THAT tenant instead of silently creating a second one.
  // The supplied tenant id is accepted only when the authenticated user is
  // already a member of it.
  const requestedTenantId = (body.tenantId ?? "").trim();
  if (!requestedTenantId) {
    throw new DashboardError(
      "tenantId is required. Create the tenant first, then complete that tenant through onboarding.",
      400,
    );
  }
  const tenantId = requestedTenantId;
  let finalSlug = "";

  {
    const membershipCheck = await fetch(
      `${base}/tenant_members?tenant_id=eq.${encodeURIComponent(tenantId)}&user_id=eq.${encodeURIComponent(user.id)}&select=role&limit=1`,
      { headers },
    );
    if (!membershipCheck.ok) throw new DashboardError("Failed to verify tenant membership", 502);
    const membershipRows = await membershipCheck.json() as Array<{ role: string }>;
    if (!membershipRows.length) throw new DashboardError("Not a member of this tenant", 403);

    const tenantCheck = await fetch(
      `${base}/tenants?id=eq.${encodeURIComponent(tenantId)}&select=id,slug&limit=1`,
      { headers },
    );
    if (!tenantCheck.ok) throw new DashboardError("Failed to load tenant", 502);
    const tenantRows = await tenantCheck.json() as Array<{ id: string; slug: string }>;
    if (!tenantRows.length) throw new DashboardError("Tenant not found", 404);
    finalSlug = tenantRows[0].slug;
  }

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

  // Keep onboarding_complete false until every required resource has been
  // created. A partially failed wizard must remain resumable rather than being
  // mistaken for a finished tenant.
  const tenantRow = {
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
    onboarding_complete: false,
  };

  const resTenant = await fetch(`${base}/tenants?id=eq.${encodeURIComponent(tenantId)}`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify(tenantRow),
  });
  if (!resTenant.ok) throw new DashboardError(`Failed to update tenant: ${resTenant.status}`, 502);

  // --- chatbot ------------------------------------------------------------
  const botName = (body.botName ?? "").trim() || name;
  const existingBotRes = await fetch(
    `${base}/chatbots?tenant_id=eq.${encodeURIComponent(tenantId)}&select=id,public_id&order=created_at.asc&limit=1`,
    { headers },
  );
  if (!existingBotRes.ok) throw new DashboardError("Failed to check existing chatbot", 502);
  const existingBots = await existingBotRes.json() as Array<{ id: string; public_id: string | null }>;
  const existingBot = existingBots[0];
  const chatbotId = existingBot?.id ?? finalSlug;
  const publicId = existingBot?.public_id || `cb_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
  const botPayload = {
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
  };
  const resBot = await fetch(
    existingBot ? `${base}/chatbots?id=eq.${encodeURIComponent(chatbotId)}` : `${base}/chatbots`,
    {
      method: existingBot ? "PATCH" : "POST",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify(existingBot ? botPayload : { id: chatbotId, ...botPayload }),
    },
  );
  if (!resBot.ok) throw new DashboardError(existingBot ? "Failed to update chatbot" : "Failed to create chatbot", 502);

  // --- knowledge ----------------------------------------------------------
  // Re-running onboarding updates an existing same-title item instead of
  // duplicating seed knowledge.
  const knowledge = Array.isArray(body.knowledge) ? body.knowledge : [];
  for (const k of knowledge.slice(0, 200)) {
    const title = (k.title ?? "").trim();
    const content = (k.content ?? "").trim();
    if (!title || !content) continue;
    const existingKnowledgeRes = await fetch(
      `${base}/knowledge?chatbot_id=eq.${encodeURIComponent(chatbotId)}&title=eq.${encodeURIComponent(title)}&select=id&limit=1`,
      { headers },
    );
    if (!existingKnowledgeRes.ok) throw new DashboardError("Failed to check knowledge item", 502);
    const existingKnowledge = await existingKnowledgeRes.json() as Array<{ id: string }>;
    const payload = {
      chatbot_id: chatbotId,
      title,
      content,
      keywords: Array.isArray(k.keywords) ? k.keywords : [],
    };
    const res = await fetch(
      existingKnowledge[0]
        ? `${base}/knowledge?id=eq.${encodeURIComponent(existingKnowledge[0].id)}`
        : `${base}/knowledge`,
      {
        method: existingKnowledge[0] ? "PATCH" : "POST",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify(payload),
      },
    );
    if (!res.ok) throw new DashboardError("Failed to save knowledge item", 502);
  }

  // --- integrations -------------------------------------------------------
  // integrations has a unique (tenant_id, provider) key. Use PostgREST upsert
  // semantics so retries update the same integration rather than failing or
  // creating another row.
  const integrations = Array.isArray(body.integrations) ? body.integrations : [];
  for (const integ of integrations) {
    if ((integ.provider === "woocommerce" || integ.provider === "supabase") && integ.credentials) {
      const res = await fetch(`${base}/integrations?on_conflict=tenant_id,provider`, {
        method: "POST",
        headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          tenant_id: tenantId,
          provider: integ.provider,
          credentials: integ.credentials,
          active: true,
        }),
      });
      if (!res.ok) throw new DashboardError(`Failed to save ${integ.provider} integration`, 502);
    }
  }

  // Mark the tenant complete only after the chatbot, knowledge and integration
  // writes above succeeded.
  const completeTenant = await fetch(`${base}/tenants?id=eq.${encodeURIComponent(tenantId)}`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({ onboarding_complete: true }),
  });
  if (!completeTenant.ok) throw new DashboardError("Failed to finalize onboarding", 502);

  const embedScript = embedScriptFor(publicId);

  return json({
    ok: true,
    tenantId,
    slug: finalSlug,
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

Given a website's structured content, extract accurate business information and return ONLY valid JSON (no markdown, no explanation, no code blocks) with this exact shape:
{"name":"Business name","industry":"Industry name","businessContext":"Key business details like shipping, returns, products","botName":"Suggested assistant name","welcomeMessage":"A friendly welcome message for customers","tone":"friendly","brandColour":"#hexcolor","allowedTopics":["products","orders","returns","support"],"securityLevel":"strict","knowledge":[{"title":"FAQ Title","content":"Answer content","keywords":["keyword1","keyword2"]}]}`;

// Notes for the AI - CRITICAL:
// 1. ACCURACY: Extract information DIRECTLY from the provided content. Do NOT invent or assume anything.
// 2. INDUSTRY: Must be a real industry category (e.g., "Fashion & Apparel", "Footwear", "Electronics", "Beauty & Cosmetics"). NEVER guess "Health & Wellness" unless the site literally sells health products/supplements.
// 3. PRODUCT BASED: If the site sells physical goods, use the product category as industry (e.g., shoes -> "Footwear", jewelry -> "Fashion & Accessories").
// 4. BUSINESS CONTEXT: Base this ONLY on what the content says. Include shipping info, return policies, key products mentioned.
// 5. BRAND_COLORS are colors from CSS custom properties like --primary, --brand, --accent, --cta (highest confidence)
// 6. CSS_COLORS are all other hex colors found in stylesheets (lower confidence)
// 7. ALWAYS choose the PRIMARY brand colour from BRAND_COLORS first - these are most reliable
// 8. Look for colors associated with .primary, .btn, .button, .cta classes (brand context)
// 9. The brand colour should be the main accent colour - the one used for buttons, links, and key CTAs
// 10. NEVER choose neutral colours: black (#000000, #111111), white (#ffffff), greys (#333333, #888888), or near-whites
// 11. If a site has a clear primary brand colour (e.g., #4c1d95 for purple, #0066cc for blue), use THAT
// 12. For sites with green/yellow themes, use that distinctive brand colour

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
  let brandColors: Map<string, number> = new Map(); // hex -> score
  let cssContent = "";
  let pageTitle = "";
  let metaDescription = "";
  let headings: string[] = [];
  let productCategories: string[] = [];

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
      cssContent += extractCssFromHtml(html);

      // Extract Open Graph color if present
      const ogColorMatch = html.match(/<meta\s+property="og:color"\s+content="([^"]+)"/i);
      if (ogColorMatch) ogColor = ogColorMatch[1];

      // Extract page title
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (titleMatch && !pageTitle) pageTitle = titleMatch[1].trim();

      // Extract meta description
      const descMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
      if (descMatch && !metaDescription) metaDescription = descMatch[1].trim();

      // Extract headings (H1, H2, H3)
      const headingMatches = html.matchAll(/<(h[1-3])[^>]*>([^<]+)<\/h\1>/gi) || [];
      for (const match of headingMatches) {
        const text = match[2].trim();
        if (text && text.length > 0 && text.length < 200) {
          headings.push(text);
        }
      }

      // Extract product categories (common patterns in e-commerce)
      const categoryPatterns = [
        /product-category\/([^"']+)[/"']?/gi,
        /\b(CATEGORY|CATEGORIES)\s*[:]\s*([^<]+)/gi,
      ];
      for (const pattern of categoryPatterns) {
        const matches = html.matchAll(pattern);
        for (const m of matches) {
          const cat = m[0].replace(/category/gi, "").trim();
          if (cat && cat.length > 2 && !productCategories.includes(cat)) {
            productCategories.push(cat);
          }
        }
      }

      // Also try to fetch linked CSS files for more complete color analysis
      const linkMatches = html.matchAll(/<link\s[^>]*href=["']([^"']*\.css["'])/gi) || [];
      for (const match of linkMatches) {
        try {
          const cssUrl = new URL(match[1], tryUrl).toString();
          const cssRes = await fetch(cssUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (compatible; ChatBotHelper/1.0)",
              "Accept": "text/css,*/*;q=0.1",
            },
            signal: AbortSignal.timeout(5000),
          });
          if (cssRes.ok) {
            cssContent += await cssRes.text();
          }
        } catch {
          // Skip CSS fetch errors
        }
      }
    } catch {
      continue;
    }
  }

  // Parse all collected CSS to extract colors
  cssColors = extractColorsFromCss(cssContent);

  // Score colors based on context (brand-like names get higher scores)
  brandColors = scoreBrandColors(cssContent, cssColors);

  const text = stripHtmlAndScripts(cssContent);

  // Append CSS colors info for the AI to consider - sorted by brand score
  const allScores = [...brandColors.entries()].sort((a, b) => b[1] - a[1]);
  const sortedColors = allScores.slice(0, 10).map(([hex]) => hex);
  const uniqueColors = [...new Set(cssColors)].slice(0, 15);
  const colorInfo = sortedColors.length > 0
    ? `\n\nBRAND_COLORS (highest confidence - from CSS variables like --primary, --brand): ${sortedColors.join(", ")}`
    : uniqueColors.length > 0
    ? `\n\nCSS_COLORS (all detected colors): ${uniqueColors.join(", ")}`
    : "";
  const ogInfo = ogColor ? `\nOG_COLOR: ${ogColor}` : "";

  // Build structured content for AI analysis
  const structuredContent = [
    pageTitle ? `PAGE_TITLE: ${pageTitle}` : null,
    metaDescription ? `META_DESCRIPTION: ${metaDescription}` : null,
    headings.length > 0 ? `HEADINGS (${headings.length} found):\n${headings.slice(0, 15).join("\n")}` : null,
    productCategories.length > 0 ? `PRODUCT_CATEGORIES: ${productCategories.join(", ")}` : null,
    text.slice(0, 8000),
    colorInfo,
    ogInfo,
  ]
    .filter(Boolean)
    .join("\n\n");

  return structuredContent;
}

// Extract all CSS from HTML (inline <style> blocks and <link> hrefs are handled separately)
function extractCssFromHtml(html: string): string {
  const styleBlocks = html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi) || [];
  return Array.from(styleBlocks, ([, block]) => block).join("\n");
}

// Strip HTML tags and scripts from content
function stripHtmlAndScripts(content: string): string {
  return content
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Extract all hex colors from CSS content
function extractColorsFromCss(css: string): string[] {
  const colors = new Set<string>();

  // Match hex colors (#RGB, #RRGGBB, #RRGGBBAA)
  const hexMatches = css.matchAll(/#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/gi);
  for (const match of hexMatches) {
    const hex = match[0];
    if (!hex.includes("000000") && !hex.includes("ffffff")) {
      colors.add(hex.length === 3 ? expandShorthandHex(hex) : hex.slice(0, 7));
    }
  }

  // Convert rgb() to hex
  const rgbMatches = css.matchAll(/rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/gi);
  for (const match of rgbMatches) {
    const r = parseInt(match[1]).toString(16).padStart(2, "0");
    const g = parseInt(match[2]).toString(16).padStart(2, "0");
    const b = parseInt(match[3]).toString(16).padStart(2, "0");
    colors.add(`#${r}${g}${b}`);
  }

  // Convert hsl() to hex
  const hslMatches = css.matchAll(/hsla?\((\d+)\s*,\s*(\d+)%\s*,\s*(\d+)%/gi);
  for (const match of hslMatches) {
    const hex = hslToHex(parseInt(match[1]), parseInt(match[2]), parseInt(match[3]));
    if (hex) colors.add(hex);
  }

  return [...colors];
}

// Score colors based on how "brand-like" their context is
function scoreBrandColors(css: string, colors: string[]): Map<string, number> {
  const scoreMap = new Map<string, number>();

  // Priority 1: CSS custom properties that are clearly brand-related
  const primaryProps = [
    '--primary', '--primary-color', '--main-color',
    '--brand', '--brand-color', '--brand-main',
    '--accent', '--accent-color',
    '--cta', '--cta-color', '--button-color',
    '--hero', '--hero-color',
    '--color-primary', '--color-brand', '--color-accent', '--color-cta',
  ];

  // Find all CSS custom property definitions and their values
  for (const prop of primaryProps) {
    const propRegex = new RegExp(`${prop.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\s*:\\s*([^;]+)`, 'i');
    const match = css.match(propRegex);
    if (match) {
      const value = match[1].trim();
      // Extract hex color from value
      const hexMatch = value.match(/#[0-9a-fA-F]{3,8}\b/i);
      if (hexMatch) {
        const hex = expandShorthandHex(hexMatch[0].slice(0, 7));
        scoreMap.set(hex, (scoreMap.get(hex) || 0) + 100); // Very high priority
      }
      // Also check for rgb/rgba values
      const rgbMatch = value.match(/rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
      if (rgbMatch) {
        const r = parseInt(rgbMatch[1]).toString(16).padStart(2, "0");
        const g = parseInt(rgbMatch[2]).toString(16).padStart(2, "0");
        const b = parseInt(rgbMatch[3]).toString(16).padStart(2, "0");
        const hex = `#${r}${g}${b}`;
        scoreMap.set(hex, (scoreMap.get(hex) || 0) + 80);
      }
    }
  }

  // Priority 2: Colors in brand-related class contexts
  const brandContextPatterns = [
    /\.primary\b.*?\{[^}]*color[^}]*\}/gi,
    /\.btn\b.*?\{[^}]*background[^}]*\}/gi,
    /\.button\b.*?\{[^}]*background[^}]*\}/gi,
    /\.cta\b.*?\{[^}]*background[^}]*\}/gi,
    /\.accent\b.*?\{[^}]*[^}]*\}/gi,
  ];

  for (const pattern of brandContextPatterns) {
    const matches = css.matchAll(pattern);
    for (const match of matches) {
      const block = match[0];
      // Find colors in this block
      const hexMatches = block.matchAll(/#[0-9a-fA-F]{3,8}\b/gi);
      for (const hm of hexMatches) {
        const hex = expandShorthandHex(hm[0].slice(0, 7));
        scoreMap.set(hex, (scoreMap.get(hex) || 0) + 20);
      }
    }
  }

  // Priority 3: General occurrence counting (lower weight)
  for (const hex of colors) {
    const occurrences = (css.match(new RegExp(hex.replace("#", ""), "gi")) || []).length;
    if (occurrences > 0 && !scoreMap.has(hex)) {
      scoreMap.set(hex, occurrences * 2);
    }
  }

  return scoreMap;
}

// Expand shorthand hex (#abc -> #aabbcc)
function expandShorthandHex(hex: string): string {
  if (hex.length === 4) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  return hex;
}

// Convert hex to rgb string for matching
function cssToRgb(hex: string): string {
  const clean = hex.replace("#", "");
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    return `${r}, ${g}, ${b}`;
  } else if (clean.length === 6) {
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);
    return `${r}, ${g}, ${b}`;
  }
  return "";
}

// Convert HSL to hex
function hslToHex(h: number, s: number, l: number): string | null {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
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
