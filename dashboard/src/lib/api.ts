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
  tenantId?: string;
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
    provider: "woocommerce" | "supabase";
    credentials: {
      url: string;
      consumer_key?: string;
      consumer_secret?: string;
      anon_key?: string;
    };
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
  provider: "woocommerce" | "supabase" | "resend";
  active: boolean;
  configured: boolean;
  url: string | null;
  fromEmail?: string | null;
  fromName?: string | null;
  hasApiKey?: boolean;
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

function tenantQuery(tenantId: string, action: string, extra?: Record<string, string>): string {
  const params = new URLSearchParams({ tenantId, action, ...(extra ?? {}) });
  return `?${params.toString()}`;
}


export function getOverview(tenantId: string): Promise<OverviewData> {
  return request<OverviewData>(`/dashboard${tenantQuery(tenantId, "overview")}`);
}

export function getConfig(tenantId: string): Promise<ConfigData> {
  return request<ConfigData>(`/dashboard${tenantQuery(tenantId, "config")}`);
}

export function updateConfig(
  tenantId: string,
  patch: Record<string, unknown>,
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/dashboard${tenantQuery(tenantId, "config")}`, {
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
export function listKnowledge(tenantId: string): Promise<{ items: KnowledgeItem[] }> {
  return request<{ items: KnowledgeItem[] }>(`/dashboard${tenantQuery(tenantId, "knowledge")}`);
}

export function addKnowledge(tenantId: string, item: {
  title: string;
  content: string;
  keywords?: string[];
}): Promise<{ item: KnowledgeItem }> {
  return request<{ item: KnowledgeItem }>(`/dashboard${tenantQuery(tenantId, "knowledge")}`, {
    method: "POST",
    body: JSON.stringify(item),
  });
}

export function updateKnowledge(
  tenantId: string,
  id: string,
  patch: { title?: string; content?: string; keywords?: string[] },
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/dashboard${tenantQuery(tenantId, "knowledge", { id })}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}

export function deleteKnowledge(tenantId: string, id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/dashboard${tenantQuery(tenantId, "knowledge", { id })}`, {
    method: "DELETE",
  });
}

export function getIntegrations(tenantId: string): Promise<{ items: IntegrationItem[] }> {
  return request<{ items: IntegrationItem[] }>(`/dashboard${tenantQuery(tenantId, "integrations")}`);
}


export function updateIntegration(tenantId: string, input: {
  provider: "woocommerce" | "supabase" | "resend";
  credentials: {
    url?: string;
    consumer_key?: string;
    consumer_secret?: string;
    webhook_secret?: string;
    anon_key?: string;
    api_key?: string;
    from_email?: string;
    from_name?: string;
  };
}): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/dashboard${tenantQuery(tenantId, "integrations")}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function listTickets(tenantId: string): Promise<{ items: TicketItem[] }> {
  return request<{ items: TicketItem[] }>(`/dashboard${tenantQuery(tenantId, "tickets")}`);
}

export function updateTicket(
  tenantId: string,
  id: string,
  patch: { status?: string; priority?: string },
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/dashboard${tenantQuery(tenantId, "tickets", { id })}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}

// --- enterprise ------------------------------------------------------------
export interface AuditItem { id:string; actor_email?:string|null; action:string; resource_type:string; resource_id?:string|null; metadata?:Record<string,unknown>; created_at:string; }
export interface TeamItem { id:string; user_id:string; role:"owner"|"admin"|"agent"|"viewer"; created_at:string; }
export interface EnterpriseSettings { plan?:string; allowed_origins?:string[]; retention_days?:number; monthly_request_limit?:number; monthly_token_limit?:number; feature_flags?:Record<string,boolean>; data_region?:string; }
export function getAudit(tenantId:string) { return request<{items:AuditItem[]}>(`/dashboard${tenantQuery(tenantId,"audit")}`); }
export function getTeam(tenantId:string) { return request<{items:TeamItem[];currentUserId:string;currentRole:string}>(`/dashboard${tenantQuery(tenantId,"team")}`); }
export function updateTeamRole(tenantId:string,id:string,role:TeamItem["role"]) { return request<{ok:boolean}>(`/dashboard${tenantQuery(tenantId,"team",{id})}`,{method:"PUT",body:JSON.stringify({role})}); }
export function removeTeamMember(tenantId:string,id:string) { return request<{ok:boolean}>(`/dashboard${tenantQuery(tenantId,"team",{id})}`,{method:"DELETE"}); }
export function getEnterprise(tenantId:string) { return request<{settings:EnterpriseSettings}>(`/dashboard${tenantQuery(tenantId,"enterprise")}`); }
export function updateEnterprise(tenantId:string,patch:Record<string,unknown>) { return request<{ok:boolean}>(`/dashboard${tenantQuery(tenantId,"enterprise")}`,{method:"PUT",body:JSON.stringify(patch)}); }
export function getOperations(tenantId:string) { return request<{health:Array<Record<string,unknown>>;jobs:Array<Record<string,unknown>>;usage:Record<string,unknown>}>(`/dashboard${tenantQuery(tenantId,"operations")}`); }
export function getTranscript(tenantId:string,id:string) { return request<{conversation:Record<string,unknown>;messages:Array<Record<string,unknown>>}>(`/dashboard${tenantQuery(tenantId,"transcript",{id})}`); }
export function submitGdpr(tenantId:string,email:string,requestType:"export"|"erase") { return request<{ok:boolean;requestId:string;data?:unknown}>(`/dashboard${tenantQuery(tenantId,"gdpr")}`,{method:"POST",body:JSON.stringify({email,requestType})}); }

export function testIntegration(tenantId:string,provider:"woocommerce"|"supabase"|"resend"){return request<{ok:boolean;status:string;message:string;latencyMs:number}>(`/dashboard${tenantQuery(tenantId,"integration_test")}`,{method:"POST",body:JSON.stringify({provider})});}

export function setConversationMode(tenantId:string,conversationId:string,mode:"ai"|"human"){return request<{ok:boolean;mode:string}>(`/dashboard${tenantQuery(tenantId,"takeover")}`,{method:"POST",body:JSON.stringify({conversationId,mode})});}
export function sendAgentMessage(tenantId:string,conversationId:string,message:string){return request<{ok:boolean;id:string}>(`/dashboard${tenantQuery(tenantId,"agent_message")}`,{method:"POST",body:JSON.stringify({conversationId,message})});}

export function inviteTeamMember(tenantId:string,email:string,role:TeamItem["role"]){return request<{ok:boolean}>(`/dashboard${tenantQuery(tenantId,"team")}`,{method:"POST",body:JSON.stringify({email,role})});}
