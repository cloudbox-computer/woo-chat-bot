// Typed API client for the tenant dashboard (convo3.md).
// Talks to the `onboarding` + `dashboard` edge functions using the caller's
// access token (verify_jwt=true on the functions).
import { FUNCTIONS_URL } from "../config";
import { getAccessToken } from "./supabase";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${FUNCTIONS_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token ?? ""}`,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(message, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// --- types -----------------------------------------------------------------

export interface TenantSummary {
  id: string;
  slug: string;
  name: string;
  created_at: string;
}

export interface OnboardingKnowledge {
  title: string;
  content: string;
  keywords?: string[];
}

export interface OnboardingInput {
  name: string;
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
  knowledge?: OnboardingKnowledge[];
  integrations?: Array<{
    provider: "woocommerce";
    credentials: { url: string; consumer_key: string; consumer_secret: string };
  }>;
  defaultTicketPriority?: string;
  autoTicketCategories?: string[];
}

export interface OnboardingResult {
  ok: boolean;
  tenantId: string;
  slug: string;
  chatbotId: string;
  publicId: string;
  embedScript: string;
  next: string;
}

export interface WebsiteAnalyzeData {
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

export interface OverviewData {
  conversations: number;
  tickets: number;
  openTickets: number;
  usage: number;
  recentConversations: Array<{
    id: string;
    title: string;
    customerEmail: string | null;
    emailConsent: boolean;
    createdAt: string | null;
  }>;
}

export interface TenantConfig {
  id: string;
  name: string;
  slug: string;
  website: string | null;
  industry: string | null;
  supportEmail: string | null;
  ticketPrefix: string | null;
  brandColour: string | null;
  welcomeMessage: string | null;
  assistantHeaderMessage: string | null;
  tone: string | null;
  businessContext: string | null;
  defaultTicketPriority: string;
  autoTicketCategories: unknown;
  onboardingComplete: boolean;
}

export interface ChatbotInfo {
  id: string;
  publicId: string | null;
  name: string;
  active: boolean;
  config: Record<string, unknown>;
}

export interface ConfigData {
  tenant: TenantConfig;
  chatbots: ChatbotInfo[];
  embedScript: string;
}

export interface KnowledgeItem {
  id: string;
  title: string;
  content: string;
  keywords: string[] | null;
  chatbot_id: string;
  created_at: string;
}

export interface IntegrationItem {
  provider: string;
  active: boolean;
  configured: boolean;
  url: string | null;
}

export interface TicketItem {
  id: string;
  reference: string;
  subject: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  customer_name: string;
  customer_email: string;
  created_at: string;
}

// --- onboarding ------------------------------------------------------------

export function runOnboarding(input: OnboardingInput): Promise<OnboardingResult> {
  return request<OnboardingResult>("/onboarding", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function analyzeWebsite(url: string): Promise<{ data: WebsiteAnalyzeData }> {
  return request<{ data: WebsiteAnalyzeData }>("/onboarding/analyze", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
}

// --- dashboard -------------------------------------------------------------

export function getOverview(): Promise<OverviewData> {
  return request<OverviewData>("/dashboard?action=overview");
}

export function getConfig(tenantId?: string): Promise<ConfigData> {
  const params = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}&action=config` : "?action=config";
  return request<ConfigData>(`/dashboard${params}`);
}

export function updateConfig(
  patch: Record<string, unknown>,
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>("/dashboard?action=config", {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}
// --- multi-tenant ----------------------------------------------------------

export function listTenants(): Promise<{ tenants: TenantSummary[] }> {
  return request<{ tenants: TenantSummary[] }>("/dashboard?action=tenants");
}

export function createTenant(name: string): Promise<{ ok: boolean; tenantId: string; slug: string }> {
  return request<{ ok: boolean; tenantId: string; slug: string }>('/dashboard?action=tenants', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}
export function listKnowledge(): Promise<{ items: KnowledgeItem[] }> {
  return request<{ items: KnowledgeItem[] }>("/dashboard?action=knowledge");
}

export function addKnowledge(item: {
  title: string;
  content: string;
  keywords?: string[];
}): Promise<{ item: KnowledgeItem }> {
  return request<{ item: KnowledgeItem }>("/dashboard?action=knowledge", {
    method: "POST",
    body: JSON.stringify(item),
  });
}

export function updateKnowledge(
  id: string,
  patch: { title?: string; content?: string; keywords?: string[] },
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/dashboard?action=knowledge&id=${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}

export function deleteKnowledge(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/dashboard?action=knowledge&id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function getIntegrations(): Promise<{ items: IntegrationItem[] }> {
  return request<{ items: IntegrationItem[] }>("/dashboard?action=integrations");
}

export function updateIntegration(input: {
  provider: "woocommerce";
  credentials: { url: string; consumer_key: string; consumer_secret: string };
}): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>("/dashboard?action=integrations", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function listTickets(): Promise<{ items: TicketItem[] }> {
  return request<{ items: TicketItem[] }>("/dashboard?action=tickets");
}

export function updateTicket(
  id: string,
  patch: { status?: string; priority?: string },
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/dashboard?action=tickets&id=${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}
