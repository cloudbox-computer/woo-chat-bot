// Typed API client for the tenant dashboard (convo3.md).
// Talks to the `onboarding` + `dashboard` edge functions using the caller's
// access token (verify_jwt=true on the functions).
import { FUNCTIONS_URL } from "../config";
import { getAccessToken } from "./supabase";

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
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
    let code: string | undefined;
    try {
      const body = (await res.json()) as { error?: string; code?: string };
      if (body.error) message = body.error;
      if (body.code) code = body.code;
    } catch {
      /* ignore */
    }
    throw new ApiError(message, res.status, code);
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
  quickActions?: Array<{ label: string; prompt: string }>;
  refusalMessage?: string;
  securityLevel?: "standard" | "strict" | "extra-strict";
  knowledge?: OnboardingKnowledge[];
  integrations?: Array<{
    provider: "woocommerce" | "supabase" | "resend";
    credentials: {
      url?: string;
      consumer_key?: string;
      consumer_secret?: string;
      anon_key?: string;
      api_key?: string;
      from_email?: string;
      from_name?: string;
    };
  }>;
  defaultTicketPriority?: string;
  autoTicketCategories?: string[];
  deferCompletion?: boolean;
}

export interface OnboardingResult {
  ok: boolean;
  tenantId: string;
  slug: string;
  chatbotId: string;
  publicId: string;
  embedScript: string | null;
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
  quickActions?: Array<{ label: string; prompt: string }>;
  securityLevel?: string;
  knowledge?: Array<{ title: string; content: string; keywords?: string[] }>;
}

export interface OverviewData {
  conversations: number;
  tickets: number;
  openTickets: number;
  usage: number;
  feedback?: number;
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
  allowedTopics: string[];
  refusalMessage: string | null;
  securityLevel: "standard" | "strict" | "extra-strict";
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
  embedScript?: string;
  created_at?: string;
}

export interface PlanEntitlements {
  plan: "starter" | "growth" | "scale" | "legacy" | "unsubscribed";
  legacy: boolean;
  subscriptionActive: boolean;
  liveIntegrations: boolean;
  businessData: boolean;
  customerSafeActions: boolean;
  restrictedActionPermissions: boolean;
  customActions: boolean;
  team: boolean;
  humanTakeover: boolean;
  auditLog: boolean;
  operations: boolean;
  enterpriseControls: boolean;
  advancedPermissions: boolean;
  fullAnalytics: boolean;
  maxAssistants: number;
  minimumUpgradeFor: Partial<Record<string, "starter" | "growth" | "scale">>;
}

export interface ConfigData {
  tenant: TenantConfig;
  chatbots: ChatbotInfo[];
  entitlements: PlanEntitlements;
  embedScript: string | null;
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
  capabilities?: string[];
  capabilityConfig?: Record<string, unknown> | null;
  queryPolicy?: Record<string, unknown> | null;
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

export function createTenant(name: string, reuseIncomplete = false): Promise<{ ok: boolean; tenantId: string; slug: string }> {
  return request<{ ok: boolean; tenantId: string; slug: string }>('/dashboard?action=tenants', {
    method: 'POST',
    body: JSON.stringify({ name, reuseIncomplete }),
  });
}

export function listAssistants(tenantId: string): Promise<{ items: ChatbotInfo[]; maxAssistants: number; activeCount: number }> {
  return request(`/dashboard${tenantQuery(tenantId, "assistants")}`);
}

export function createAssistant(tenantId: string, name: string): Promise<{ item: ChatbotInfo }> {
  return request(`/dashboard${tenantQuery(tenantId, "assistants")}`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function deleteAssistant(tenantId: string, id: string): Promise<{ ok: boolean }> {
  return request(`/dashboard${tenantQuery(tenantId, "assistants", { id })}`, { method: "DELETE" });
}
export function listKnowledge(tenantId: string, chatbotId?: string): Promise<{ items: KnowledgeItem[] }> {
  return request<{ items: KnowledgeItem[] }>(`/dashboard${tenantQuery(tenantId, "knowledge", chatbotId ? { chatbotId } : undefined)}`);
}

export function addKnowledge(tenantId: string, item: {
  chatbotId: string;
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
    query_policy?: Record<string, unknown> | null;
    capability_config?: Record<string, unknown> | null;
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
export interface EnterpriseSettings { plan?:string; billing_enforced?:boolean; allowed_origins?:string[]; retention_days?:number; monthly_request_limit?:number; monthly_token_limit?:number; feature_flags?:Record<string,boolean>; data_region?:string; zero_data_retention?:boolean; store_conversations?:boolean; pii_redaction_enabled?:boolean; hipaa_mode?:boolean; baa_status?:"none"|"requested"|"signed"; mfa_required?:boolean; ip_allowlist?:string[]; incident_contact_email?:string|null; security_contact_email?:string|null; model_training_opt_out?:boolean; }
export interface SecurityIncidentItem { id:string; title:string; description:string; severity:"info"|"warning"|"critical"; status:"open"|"investigating"|"contained"|"resolved"; reported_by?:string|null; resolved_at?:string|null; created_at:string; updated_at:string; }
export function getAudit(tenantId:string) { return request<{items:AuditItem[]}>(`/dashboard${tenantQuery(tenantId,"audit")}`); }
export function getTeam(tenantId:string) { return request<{items:TeamItem[];currentUserId:string;currentRole:string}>(`/dashboard${tenantQuery(tenantId,"team")}`); }
export function updateTeamRole(tenantId:string,id:string,role:TeamItem["role"]) { return request<{ok:boolean}>(`/dashboard${tenantQuery(tenantId,"team",{id})}`,{method:"PUT",body:JSON.stringify({role})}); }
export function removeTeamMember(tenantId:string,id:string) { return request<{ok:boolean}>(`/dashboard${tenantQuery(tenantId,"team",{id})}`,{method:"DELETE"}); }
export function getEnterprise(tenantId:string) { return request<{settings:EnterpriseSettings}>(`/dashboard${tenantQuery(tenantId,"enterprise")}`); }
export function updateEnterprise(tenantId:string,patch:Record<string,unknown>) { return request<{ok:boolean}>(`/dashboard${tenantQuery(tenantId,"enterprise")}`,{method:"PUT",body:JSON.stringify(patch)}); }
export function listSecurityIncidents(tenantId:string){return request<{items:SecurityIncidentItem[]}>(`/dashboard${tenantQuery(tenantId,"incidents")}`);}
export function createSecurityIncident(tenantId:string,input:{title:string;description:string;severity:SecurityIncidentItem["severity"]}){return request<{ok:boolean;id:string}>(`/dashboard${tenantQuery(tenantId,"incidents")}`,{method:"POST",body:JSON.stringify(input)});}
export function updateSecurityIncident(tenantId:string,id:string,patch:{status?:SecurityIncidentItem["status"];severity?:SecurityIncidentItem["severity"];description?:string}){return request<{ok:boolean}>(`/dashboard${tenantQuery(tenantId,"incidents",{id})}`,{method:"PATCH",body:JSON.stringify(patch)});}
export function getOperations(tenantId:string) { return request<{health:Array<Record<string,unknown>>;jobs:Array<Record<string,unknown>>;usage:Record<string,unknown>}>(`/dashboard${tenantQuery(tenantId,"operations")}`); }
export function getTranscript(tenantId:string,id:string) { return request<{conversation:Record<string,unknown>;messages:Array<Record<string,unknown>>}>(`/dashboard${tenantQuery(tenantId,"transcript",{id})}`); }
export function submitGdpr(tenantId:string,email:string,requestType:"export"|"erase") { return request<{ok:boolean;requestId:string;data?:unknown}>(`/dashboard${tenantQuery(tenantId,"gdpr")}`,{method:"POST",body:JSON.stringify({email,requestType})}); }

export function testIntegration(tenantId:string,provider:"woocommerce"|"supabase"|"resend"){return request<{ok:boolean;status:string;message:string;latencyMs:number}>(`/dashboard${tenantQuery(tenantId,"integration_test")}`,{method:"POST",body:JSON.stringify({provider})});}

export function setConversationMode(tenantId:string,conversationId:string,mode:"ai"|"human"){return request<{ok:boolean;mode:string}>(`/dashboard${tenantQuery(tenantId,"takeover")}`,{method:"POST",body:JSON.stringify({conversationId,mode})});}
export function sendAgentMessage(tenantId:string,conversationId:string,message:string){return request<{ok:boolean;id:string}>(`/dashboard${tenantQuery(tenantId,"agent_message")}`,{method:"POST",body:JSON.stringify({conversationId,message})});}

export function inviteTeamMember(tenantId:string,email:string,role:TeamItem["role"]){return request<{ok:boolean}>(`/dashboard${tenantQuery(tenantId,"team")}`,{method:"POST",body:JSON.stringify({email,role})});}




// --- data sources + universal connectors ----------------------------------
export type DataSourceKind = "file"|"website"|"sitemap"|"url"|"text"|"qa"|"notion"|"google_drive"|"dropbox"|"zendesk"|"wordpress";
export interface DataSourceItem {
  id:string; tenant_id:string; chatbot_id:string; kind:DataSourceKind; name:string;
  status:"pending"|"syncing"|"ready"|"error"|"paused"; config:Record<string,unknown>;
  connection_provider?:string|null; object_path?:string|null; sync_interval_minutes?:number|null;
  next_sync_at?:string|null; last_sync_at?:string|null; last_error?:string|null;
  document_count:number; chunk_count:number; created_at:string; updated_at:string;
}
export interface SourceDocumentItem { id:string; external_id:string; title:string; source_url?:string|null; mime_type?:string|null; byte_size?:number|null; metadata?:Record<string,unknown>; indexed_at:string; }
export interface ConnectorField { key:string; label:string; secret?:boolean; required?:boolean; placeholder?:string; type?:"text"|"url"|"textarea"; }
export interface ConnectorActionTemplate { id:string; name:string; description:string; capability:string; method:string; pathTemplate:string; requestSchema:Record<string,unknown>; responseMapping?:Record<string,unknown>; requireConfirmation?:boolean; }
export interface ConnectorItem {
  id:string; name:string; category:string; capabilities:string[]; sourceKinds?:string[]; fields:ConnectorField[]; docsUrl?:string; actionTemplates?:ConnectorActionTemplate[];
  configured:boolean; active:boolean; credentials:Record<string,unknown>; oauthAvailable?:boolean;
  health?:{provider:string;status:string;message?:string|null;checked_at?:string|null;latency_ms?:number|null}|null;
}
export interface ConnectorActionItem { id:string; provider:string; name:string; description:string; capability:string; method:string; path_template:string; request_schema:Record<string,unknown>; response_mapping:Record<string,unknown>; require_confirmation:boolean; active:boolean; created_at:string; chatbot_ids?:string[]; restricted_chatbot_ids?:string[]; }

function sourceQuery(tenantId:string,action:string,extra?:Record<string,string>){const q=new URLSearchParams({tenantId,action,...(extra??{})});return `/data-sources?${q.toString()}`;}
export function listDataSources(tenantId:string,chatbotId?:string){return request<{items:DataSourceItem[]}>(sourceQuery(tenantId,"sources",chatbotId?{chatbotId}:undefined));}
export function createDataSource(tenantId:string,input:{chatbotId:string;kind:DataSourceKind;name:string;config:Record<string,unknown>;syncIntervalMinutes?:number|null}){return request<{item:DataSourceItem;uploadPath?:string|null}>(sourceQuery(tenantId,"sources"),{method:"POST",body:JSON.stringify(input)});}
export function updateDataSource(tenantId:string,id:string,patch:Record<string,unknown>){return request<{ok:boolean}>(sourceQuery(tenantId,"sources",{id}),{method:"PUT",body:JSON.stringify(patch)});}
export function deleteDataSource(tenantId:string,id:string){return request<{ok:boolean}>(sourceQuery(tenantId,"sources",{id}),{method:"DELETE"});}
export function syncDataSource(tenantId:string,id:string){return request<{ok:boolean;jobId:string}>(sourceQuery(tenantId,"sync",{id}),{method:"POST"});}
export function listSourceDocuments(tenantId:string,id:string){return request<{items:SourceDocumentItem[]}>(sourceQuery(tenantId,"documents",{id}));}
export function listConnections(tenantId:string){return request<{items:ConnectorItem[]}>(sourceQuery(tenantId,"connections"));}
export function saveConnection(tenantId:string,provider:string,credentials:Record<string,unknown>,active=true){return request<{ok:boolean}>(sourceQuery(tenantId,"connections"),{method:"PUT",body:JSON.stringify({provider,credentials,active})});}
export function removeConnection(tenantId:string,provider:string){return request<{ok:boolean}>(sourceQuery(tenantId,"connections",{provider}),{method:"DELETE"});}
export function testConnection(tenantId:string,provider:string){return request<{ok:boolean;status:string;message:string;latencyMs:number}>(sourceQuery(tenantId,"connection_test"),{method:"POST",body:JSON.stringify({provider})});}
export function listConnectorActions(tenantId:string){return request<{items:ConnectorActionItem[];assistants:Array<{id:string;name:string;active:boolean}>}>(sourceQuery(tenantId,"actions"));}
export function saveConnectorAction(tenantId:string,input:Record<string,unknown>,id?:string){return request<{ok:boolean;id:string}>(sourceQuery(tenantId,"actions",id?{id}:undefined),{method:id?"PUT":"POST",body:JSON.stringify(input)});}
export function deleteConnectorAction(tenantId:string,id:string){return request<{ok:boolean}>(sourceQuery(tenantId,"actions",{id}),{method:"DELETE"});}
export function startConnectorOAuth(tenantId:string,provider:string){const q=new URLSearchParams({action:"start",tenantId,provider});return request<{url:string;expiresAt:string}>(`/connector-oauth-start?${q.toString()}`,{method:"POST"});}

// --- Stripe billing --------------------------------------------------------
export type BillingPlanKey = "starter" | "growth" | "scale";
export interface BillingPlanSummary { key: BillingPlanKey; name: string; monthlyPriceGbp: number; conversationLimit: number; requestLimit: number; tokenLimit: number; maxAssistants: number; }
export interface BillingState {
  plan: string; billingEnforced: boolean; status: string; hasCustomer: boolean; hasSubscription: boolean;
  currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; conversationLimit: number; requestLimit: number; tokenLimit: number;
  maxAssistants: number; conversationsUsed: number;
}
export function getBilling(tenantId:string) { return request<{billing:BillingState;plans:BillingPlanSummary[];canManage:boolean;entitlements:PlanEntitlements}>(`/dashboard${tenantQuery(tenantId,"billing")}`); }
export function createBillingCheckout(tenantId:string,plan:BillingPlanKey,source:"billing"|"onboarding"="billing") { return request<{url:string}>(`/dashboard${tenantQuery(tenantId,"billing")}`,{method:"POST",body:JSON.stringify({operation:"checkout",plan,source})}); }
export function openBillingPortal(tenantId:string) { return request<{url:string}>(`/dashboard${tenantQuery(tenantId,"billing")}`,{method:"POST",body:JSON.stringify({operation:"portal"})}); }
