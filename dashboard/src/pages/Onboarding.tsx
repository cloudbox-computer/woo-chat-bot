import React from "react";
import { runOnboarding, analyzeWebsite, createTenant, createBillingCheckout, getBilling, type OnboardingInput, type BillingPlanKey } from "../lib/api";
import { supabase } from "../lib/supabase";
import { toast } from "../components/ui";

// 7-step onboarding wizard. Plan selection happens before plan-gated integrations
// so the service step can accurately show what the selected plan includes.

const STEPS = [
  "Business",
  "Assistant",
  "Strict scope",
  "Knowledge",
  "Support",
  "Plan",
  "Integrations",
];


const TONES = ["friendly", "professional", "playful", "helpful", "calm", "luxury"];
const SECURITY_LEVELS: Array<{ id: OnboardingInput["securityLevel"]; label: string; desc: string }> = [
  { id: "standard", label: "Standard", desc: "Answer most questions; refuse clearly off-topic ones." },
  { id: "strict", label: "Strict", desc: "Only answer on-topic questions; flag anything ambiguous." },
  { id: "extra-strict", label: "Extra strict", desc: "Maximum guardrails — ambiguous requests fail closed." },
];

const PRIORITIES = ["low", "normal", "high", "urgent"];

interface WizardState {
  name: string;
  website: string;
  industry: string;
  businessContext: string;
  botName: string;
  welcomeMessage: string;
  tone: string;
  brandColour: string;
  allowedTopics: string[];
  quickActions: Array<{ label: string; prompt: string }>;
  refusalMessage: string;
  securityLevel: OnboardingInput["securityLevel"];
  knowledge: Array<{ title: string; content: string }>;
  wooUrl: string;
  wooKey: string;
  wooSecret: string;
  supaUrl: string;
  supaAnonKey: string;
  resendApiKey: string;
  resendFromEmail: string;
  resendFromName: string;
  supportEmail: string;
  ticketPrefix: string;
  defaultTicketPriority: string;
  autoTicketCategories: string[];
}

const initial: WizardState = {
  name: "",
  website: "",
  industry: "",
  businessContext: "",
  botName: "",
  welcomeMessage: "",
  tone: "friendly",
  brandColour: "#7c3aed",
  allowedTopics: [],
  quickActions: [],
  refusalMessage: "",
  securityLevel: "strict",
  knowledge: [],
  wooUrl: "",
  wooKey: "",
  wooSecret: "",
  supaUrl: "",
  supaAnonKey: "",
  resendApiKey: "",
  resendFromEmail: "",
  resendFromName: "",
  supportEmail: "",
  ticketPrefix: "",
  defaultTicketPriority: "normal",
  autoTicketCategories: [],
};

interface OnboardingProps {
  tenantId?: string | null;
  onComplete?: (tenantId: string) => void;
}

export default function Onboarding({ tenantId, onComplete }: OnboardingProps) {
  const [step, setStep] = React.useState(0);
  const [state, setState] = React.useState<WizardState>(initial);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [analyzing, setAnalyzing] = React.useState(false);
  const [analyzeError, setAnalyzeError] = React.useState<string | null>(null);
  const query = React.useMemo(() => new URLSearchParams(window.location.search), []);
  const initialPlan = query.get("plan");
  const [selectedPlan, setSelectedPlan] = React.useState<BillingPlanKey>(
    initialPlan === "starter" || initialPlan === "growth" || initialPlan === "scale" ? initialPlan : "growth",
  );
  const checkoutState = query.get("onboarding_checkout");
  const resumeCheckout = !!tenantId && (checkoutState === "cancelled" || checkoutState === "success");

  React.useEffect(() => {
    if (resumeCheckout) setStep(5);
  }, [resumeCheckout]);

  React.useEffect(() => {
    if (!tenantId || checkoutState !== "success") return;
    let stopped = false;
    const check = async () => {
      try {
        const data = await getBilling(tenantId);
        if (!stopped && ["active", "trialing"].includes(data.billing.status)) {
          if (onComplete) onComplete(tenantId);
          else window.location.assign("/?welcome=1&billing=success");
        }
      } catch { /* webhook may still be processing */ }
    };
    void check();
    const timer = window.setInterval(check, 1800);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [tenantId, checkoutState, onComplete]);

  const set = <K extends keyof WizardState>(key: K, value: WizardState[K]) =>
    setState((s) => ({ ...s, [key]: value }));


  const addKnowledge = () =>
    setState((s) => ({ ...s, knowledge: [...s.knowledge, { title: "", content: "" }] }));

  const setKnowledge = (i: number, key: "title" | "content", value: string) =>
    setState((s) => ({
      ...s,
      knowledge: s.knowledge.map((k, idx) => (idx === i ? { ...k, [key]: value } : k)),
    }));

  const removeKnowledge = (i: number) =>
    setState((s) => ({ ...s, knowledge: s.knowledge.filter((_, idx) => idx !== i) }));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      // A brand-new account may enter onboarding before any tenant exists.
      // Create-or-resume through the atomic backend RPC exactly once, then use
      // that returned id for every onboarding write. Existing incomplete
      // tenants are always reused by the backend.
      let onboardingTenantId = tenantId ?? null;
      if (!onboardingTenantId) {
        const tenantResult = await createTenant(state.name.trim(), true);
        onboardingTenantId = tenantResult.tenantId;
      }
      if (!onboardingTenantId) throw new Error("Unable to resolve onboarding tenant");

      const input: OnboardingInput = {
        tenantId: onboardingTenantId,
        name: state.name,
        website: state.website || undefined,
        industry: state.industry || undefined,
        businessContext: state.businessContext || undefined,
        botName: state.botName || undefined,
        welcomeMessage: state.welcomeMessage || undefined,
        tone: state.tone,
        brandColour: state.brandColour,
        allowedTopics: state.allowedTopics,
        quickActions: state.quickActions,
        refusalMessage: state.refusalMessage || undefined,
        securityLevel: state.securityLevel,
        knowledge: state.knowledge.filter((k) => k.title.trim() && k.content.trim()).map((k) => ({
          title: k.title.trim(),
          content: k.content.trim(),
        })),
        integrations: [
          ...(state.resendApiKey.trim() && state.resendFromEmail.trim()
            ? [{
                provider: "resend" as const,
                credentials: {
                  api_key: state.resendApiKey.trim(),
                  from_email: state.resendFromEmail.trim(),
                  from_name: state.resendFromName.trim() || undefined,
                },
              }]
            : []),
          ...(selectedPlan !== "starter" && state.wooUrl.trim() && state.wooKey.trim() && state.wooSecret.trim()
            ? [{
                provider: "woocommerce" as const,
                credentials: {
                  url: state.wooUrl.trim(),
                  consumer_key: state.wooKey.trim(),
                  consumer_secret: state.wooSecret.trim(),
                },
              }]
            : []),
          ...(selectedPlan !== "starter" && state.supaUrl.trim() && state.supaAnonKey.trim()
            ? [{
                provider: "supabase" as const,
                credentials: {
                  url: state.supaUrl.trim(),
                  anon_key: state.supaAnonKey.trim(),
                },
              }]
            : []),
        ],
        supportEmail: state.supportEmail || undefined,
        ticketPrefix: state.ticketPrefix || undefined,
        defaultTicketPriority: state.defaultTicketPriority,
        autoTicketCategories: state.autoTicketCategories,
        deferCompletion: true,
      };
      await runOnboarding(input);
      const checkout = await createBillingCheckout(onboardingTenantId, selectedPlan, "onboarding");
      window.location.assign(checkout.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Onboarding failed");
      toast("err", err instanceof Error ? err.message : "Onboarding failed");
    } finally {
      setBusy(false);
    }
  }


  async function signOut() {
    await supabase.auth.signOut();
  }

  async function handleAnalyzeWebsite() {
    const url = state.website.trim();
    if (!url) {
      setAnalyzeError("Please enter a website URL first");
      return;
    }
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const res = await analyzeWebsite(url);
      const data = res.data;
      if (data.name) set("name", data.name);
      if (data.industry) set("industry", data.industry);
      if (data.businessContext) set("businessContext", data.businessContext);
      if (data.botName) set("botName", data.botName);
      if (data.welcomeMessage) set("welcomeMessage", data.welcomeMessage);
      if (data.tone && TONES.includes(data.tone)) set("tone", data.tone);
      if (data.brandColour) set("brandColour", data.brandColour);
      if (data.allowedTopics?.length) set("allowedTopics", data.allowedTopics);
      if (data.quickActions?.length) set("quickActions", data.quickActions);
      if (data.securityLevel === "standard" || data.securityLevel === "strict" || data.securityLevel === "extra-strict") {
        set("securityLevel", data.securityLevel as WizardState["securityLevel"]);
      }
      if (data.knowledge?.length) {
        setState((s) => ({
          ...s,
          knowledge: data.knowledge!.map((k) => ({ title: k.title, content: k.content })),
        }));
      }
      toast("ok", "Website analyzed — fields have been filled in");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to analyze website";
      setAnalyzeError(msg);
      toast("err", msg);
    } finally {
      setAnalyzing(false);
    }
  }

  const supportEmailValid =
    state.supportEmail.trim().length === 0 || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.supportEmail);
  const resendComplete =
    (!state.resendApiKey.trim() && !state.resendFromEmail.trim()) ||
    (!!state.resendApiKey.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.resendFromEmail.trim()));
  const wooComplete =
    selectedPlan === "starter" ||
    (!state.wooUrl.trim() && !state.wooKey.trim() && !state.wooSecret.trim()) ||
    (!!state.wooUrl.trim() && !!state.wooKey.trim() && !!state.wooSecret.trim());
  const supabaseComplete =
    selectedPlan === "starter" ||
    (!state.supaUrl.trim() && !state.supaAnonKey.trim()) ||
    (!!state.supaUrl.trim() && !!state.supaAnonKey.trim());

  const canNext =
    step === 0 ? state.name.trim().length > 0 :
    step === 4 ? supportEmailValid :
    step === 6 ? resendComplete && wooComplete && supabaseComplete :
    true;

  return (
    <div className="wizard">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div className="brand">
          <span className="logo">◈</span> Tenant setup
        </div>
        <button className="btn ghost sm" onClick={signOut}>Sign out</button>
      </div>

      <div className="steps">
        {STEPS.map((label, i) => (
          <div key={label} className={`step-chip ${i === step ? "active" : ""} ${i < step ? "done" : ""}`}>
            {i + 1}. {label}
          </div>
        ))}
      </div>

      <div className="wizard-card">
        {step === 0 && (
          <>
            <h2>Tell us about your business</h2>
            <p className="step-desc">This powers your assistant's knowledge and tone.</p>
            <div className="field">
              <label>Website</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="url"
                  value={state.website}
                  onChange={(e) => set("website", e.target.value)}
                  placeholder="https://example.com"
                  style={{ flex: 1 }}
                />
                <button
                  className="btn secondary sm"
                  onClick={handleAnalyzeWebsite}
                  disabled={analyzing || !state.website.trim()}
                  title="Let AI analyze this website and fill in the form"
                >
                  {analyzing ? "Analyzing…" : "🔍 Analyze"}
                </button>
              </div>
              {analyzeError && <div className="hint" style={{ color: "var(--red)", marginTop: 4 }}>{analyzeError}</div>}
            </div>
            <div className="field">
              <label>Business name *</label>
              <input type="text" value={state.name} onChange={(e) => set("name", e.target.value)} placeholder="Your business name" />
            </div>
            <div className="field">
              <label>Industry</label>
              <input type="text" value={state.industry} onChange={(e) => set("industry", e.target.value)} placeholder="Your industry" />
            </div>
            <div className="field">
              <label>Anything the assistant should know?</label>
              <textarea
                value={state.businessContext}
                onChange={(e) => set("businessContext", e.target.value)}
                placeholder="Describe what the business does, offers, who it serves, and important policies…"
              />
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h2>Design your assistant</h2>
            <p className="step-desc">The name, look and voice customers will see.</p>
            <div className="field">
              <label>Assistant name</label>
              <input type="text" value={state.botName} onChange={(e) => set("botName", e.target.value)} placeholder={state.name || "Store assistant"} />
            </div>
            <div className="field">
              <label>Welcome message</label>
              <textarea
                value={state.welcomeMessage}
                onChange={(e) => set("welcomeMessage", e.target.value)}
                placeholder={`Hi! Welcome to ${state.name || "our store"}. How can I help today?`}
              />
            </div>
            <div className="field">
              <label>Starter chips</label>
              <div className="hint" style={{ marginBottom: 6 }}>
                One per line. Use <code>Label | Prompt sent to assistant</code>. If you omit the prompt, the label is sent.
              </div>
              <textarea
                value={state.quickActions.map((a) => a.label === a.prompt ? a.label : `${a.label} | ${a.prompt}`).join("\n")}
                onChange={(e) => {
                  const actions = e.target.value.split(/\r?\n/).map((line) => {
                    const [rawLabel, ...rest] = line.split("|");
                    const label = rawLabel.trim();
                    const prompt = rest.join("|").trim() || label;
                    return { label, prompt };
                  }).filter((a) => a.label).slice(0, 8);
                  set("quickActions", actions);
                }}
                placeholder={"Ask about our services\nGet a quote | How can I get a quote?"}
              />
            </div>
            <div className="field">
              <label>Personality</label>
              <div className="chip-grid">
                {TONES.map((t) => (
                  <button
                    key={t}
                    className={`chip-option ${state.tone === t ? "active" : ""}`}
                    onClick={() => set("tone", t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>Brand colour</label>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(state.brandColour) ? state.brandColour : "#7c3aed"}
                  onChange={(e) => set("brandColour", e.target.value)}
                />
                <input type="text" value={state.brandColour} onChange={(e) => set("brandColour", e.target.value)} style={{ width: 120 }} />
              </div>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2>Set the strict scope</h2>
            <p className="step-desc">
              The assistant will only answer within the topics you allow. Everything else gets a polite refusal.
            </p>
            <div className="field">
              <label>What can it talk about?</label>
              <div className="hint" style={{ marginBottom: 6 }}>
                Enter tenant-specific topics, one per line. These are free-text concepts, not platform categories.
              </div>
              <textarea
                value={state.allowedTopics.join("\n")}
                onChange={(e) => set(
                  "allowedTopics",
                  e.target.value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).slice(0, 100),
                )}
                placeholder={"Primary service or product area\nAnother service\nPolicies or support area"}
              />
            </div>
            <div className="field">
              <label>Out-of-scope reply</label>
              <textarea
                value={state.refusalMessage}
                onChange={(e) => set("refusalMessage", e.target.value)}
                placeholder={`I'm sorry, I can only help with ${state.name || "this business"} and enquiries related to this business.`}
              />
            </div>
            <div className="field">
              <label>Strictness</label>
              {SECURITY_LEVELS.map((s) => (
                <div
                  key={s.id}
                  className={`chip-option ${state.securityLevel === s.id ? "active" : ""}`}
                  style={{ marginBottom: 8, width: "100%" }}
                  onClick={() => set("securityLevel", s.id)}
                >
                  <strong>{s.label}</strong> — {s.desc}
                </div>
              ))}
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h2>Add knowledge</h2>
            <p className="step-desc">FAQs, policies and facts the assistant should know. You can add more later.</p>
            {state.knowledge.length === 0 && <div className="empty">No knowledge items yet.</div>}
            {state.knowledge.map((k, i) => (
              <div key={i} className="kb-row">
                <div className="field">
                  <label>Title</label>
                  <input type="text" value={k.title} onChange={(e) => setKnowledge(i, "title", e.target.value)} placeholder="e.g. Shipping times" />
                </div>
                <div className="field">
                  <label>Content</label>
                  <textarea value={k.content} onChange={(e) => setKnowledge(i, "content", e.target.value)} placeholder="e.g. Orders ship within 1-2 business days…" />
                </div>
                <button className="btn danger sm" onClick={() => removeKnowledge(i)}>Remove</button>
              </div>
            ))}
            <button className="btn secondary sm" onClick={addKnowledge}>+ Add knowledge item</button>
          </>
        )}

        {step === 4 && (
          <>
            <h2>Support & tickets</h2>
            <p className="step-desc">Where support tickets go and how they're organised.</p>
            <div className="field">
              <label>Support email</label>
              <input type="email" value={state.supportEmail} onChange={(e) => set("supportEmail", e.target.value)} placeholder="support@yourstore.com" autoComplete="email" />
              <div className="hint">Tickets created by customers are emailed here.</div>
            </div>
            <div className="field">
              <label>Ticket reference prefix</label>
              <input type="text" value={state.ticketPrefix} onChange={(e) => set("ticketPrefix", e.target.value)} placeholder="IP" maxLength={4} autoComplete="off" />
              <div className="hint">e.g. IP → IP-2026-000001. 1-4 letters/numbers.</div>
            </div>
            <div className="field">
              <label>Default ticket priority</label>
              <select value={state.defaultTicketPriority} onChange={(e) => set("defaultTicketPriority", e.target.value)}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Auto-ticket categories</label>
              <input
                type="text"
                value={state.autoTicketCategories.join(", ")}
                onChange={(e) => set("autoTicketCategories", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
                placeholder="damaged, refund, order query"
                autoComplete="off"
              />
              <div className="hint">Comma-separated. The assistant categorises tickets automatically.</div>
            </div>
          </>
        )}

        {step === 5 && (
          <>
            <h2>{checkoutState === "success" ? "Activating your workspace…" : "Choose your plan"}</h2>
            <p className="step-desc">
              {checkoutState === "success"
                ? "Payment details were accepted. We’re waiting for Stripe to confirm your 14-day trial."
                : "Choose your plan now so the next step only shows integrations available to that plan. Your 14-day trial starts when you finish setup and continue to Stripe."}
            </p>
            {checkoutState === "cancelled" && <div className="err" style={{marginBottom:16}}>Checkout was cancelled. Your setup is saved — review your plan, then continue to integrations when ready.</div>}
            {checkoutState !== "success" && (
              <div className="billing-plan-grid onboarding-plans">
                {[
                  {key:"starter" as const,name:"Starter",price:29,limit:"500 conversations",assistants:"1 assistant"},
                  {key:"growth" as const,name:"Growth",price:79,limit:"2,500 conversations",assistants:"3 assistants"},
                  {key:"scale" as const,name:"Scale",price:199,limit:"10,000 conversations",assistants:"10 assistants"},
                ].map((plan) => (
                  <button type="button" key={plan.key} className={`billing-plan card ${selectedPlan===plan.key?"featured selected-plan":""}`} onClick={()=>setSelectedPlan(plan.key)}>
                    {plan.key === "growth" && <span className="billing-badge">MOST POPULAR</span>}
                    <h2>{plan.name}</h2>
                    <div className="billing-price"><b>£{plan.price}</b><span>/ month<br/><small>ex VAT</small></span></div>
                    <ul><li>✓ {plan.assistants}</li><li>✓ {plan.limit} / month</li><li>✓ 14-day free trial</li></ul>
                    <div className="plan-select-mark">{selectedPlan===plan.key?"✓ Selected":"Select plan"}</div>
                  </button>
                ))}
              </div>
            )}
            {checkoutState === "success" && <div className="empty">Confirming subscription… this usually takes only a few seconds.</div>}
          </>
        )}

        {step === 6 && checkoutState !== "success" && (
          <>
            <h2>Connect services</h2>
            <p className="step-desc">
              Configure email delivery and any live business integrations you want to use. Everything here is optional and can be changed later.
            </p>

            <div className="integration-onboarding-card">
              <div className="integration-onboarding-head">
                <div>
                  <strong>Email notifications · Resend</strong>
                  <div className="hint">Available on every plan. Used to send support ticket notifications from your workspace.</div>
                </div>
                <span className="badge on">All plans</span>
              </div>
              <div className="field">
                <label>Resend API key</label>
                <input
                  type="password"
                  name="resend_api_key"
                  value={state.resendApiKey}
                  onChange={(e) => set("resendApiKey", e.target.value)}
                  placeholder="re_…"
                  autoComplete="new-password"
                />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="field">
                  <label>From email</label>
                  <input
                    type="email"
                    name="resend_from_email"
                    value={state.resendFromEmail}
                    onChange={(e) => set("resendFromEmail", e.target.value)}
                    placeholder="support@yourdomain.com"
                    autoComplete="off"
                  />
                </div>
                <div className="field">
                  <label>From name</label>
                  <input
                    type="text"
                    name="resend_from_name"
                    value={state.resendFromName}
                    onChange={(e) => set("resendFromName", e.target.value)}
                    placeholder={state.name || "Customer Support"}
                    autoComplete="off"
                  />
                </div>
              </div>
              {!resendComplete && <div className="err">Enter both a Resend API key and a valid From email, or leave both blank to configure later.</div>}
              <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                The From email must belong to a domain you have verified in Resend.
              </p>
            </div>

            {selectedPlan === "starter" ? (
              <>
                <div className="integration-onboarding-card locked-integration">
                  <div className="integration-onboarding-head">
                    <div>
                      <strong>WooCommerce</strong>
                      <div className="hint">Product, order and checkout data.</div>
                    </div>
                    <span className="badge off">Growth+</span>
                  </div>
                  <p className="muted">Upgrade to Growth or Scale to connect live integrations such as WooCommerce.</p>
                </div>
                <div className="integration-onboarding-card locked-integration">
                  <div className="integration-onboarding-head">
                    <div>
                      <strong>Supabase</strong>
                      <div className="hint">Live business-data queries from your database.</div>
                    </div>
                    <span className="badge off">Growth+</span>
                  </div>
                  <p className="muted">Upgrade to Growth or Scale to connect live integrations and business-data sources such as Supabase.</p>
                </div>
              </>
            ) : (
              <>
                <div className="integration-onboarding-card">
                  <div className="integration-onboarding-head">
                    <div>
                      <strong>WooCommerce</strong>
                      <div className="hint">Available on {selectedPlan === "scale" ? "Scale" : "Growth"}.</div>
                    </div>
                    <span className="badge on">Included</span>
                  </div>
                  <div className="field">
                    <label>Store URL</label>
                    <input
                      type="url"
                      name="woocommerce_store_url"
                      value={state.wooUrl}
                      onChange={(e) => set("wooUrl", e.target.value)}
                      placeholder="https://example.com"
                      autoComplete="off"
                    />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div className="field">
                      <label>Consumer key</label>
                      <input
                        type="text"
                        name="woocommerce_consumer_key"
                        value={state.wooKey}
                        onChange={(e) => set("wooKey", e.target.value)}
                        placeholder="ck_…"
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </div>
                    <div className="field">
                      <label>Consumer secret</label>
                      <input
                        type="password"
                        name="woocommerce_consumer_secret"
                        value={state.wooSecret}
                        onChange={(e) => set("wooSecret", e.target.value)}
                        placeholder="cs_…"
                        autoComplete="new-password"
                      />
                    </div>
                  </div>
                  {!wooComplete && <div className="err">Complete all three WooCommerce fields, or leave all three blank.</div>}
                  <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    Create these in WooCommerce → Settings → Advanced → REST API.
                  </p>
                </div>

                <div className="integration-onboarding-card">
                  <div className="integration-onboarding-head">
                    <div>
                      <strong>Supabase</strong>
                      <div className="hint">Available on {selectedPlan === "scale" ? "Scale" : "Growth"}.</div>
                    </div>
                    <span className="badge on">Included</span>
                  </div>
                  <div className="field">
                    <label>Project URL</label>
                    <input
                      type="url"
                      name="external_supabase_url"
                      value={state.supaUrl}
                      onChange={(e) => set("supaUrl", e.target.value)}
                      placeholder="https://xyz.supabase.co"
                      autoComplete="off"
                    />
                  </div>
                  <div className="field">
                    <label>Anon key</label>
                    <input
                      type="password"
                      name="external_supabase_anon_key"
                      value={state.supaAnonKey}
                      onChange={(e) => set("supaAnonKey", e.target.value)}
                      placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                      autoComplete="new-password"
                    />
                  </div>
                  {!supabaseComplete && <div className="err">Enter both the Supabase Project URL and Anon key, or leave both blank.</div>}
                  <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    Find these in Supabase Dashboard → Settings → API.
                  </p>
                </div>
              </>
            )}
          </>
        )}

        {error ? <div className="err" style={{ color: "var(--red)", marginTop: 8 }}>{error}</div> : null}

        <div className="wizard-nav">
          <button className="btn secondary" disabled={step === 0 || busy || checkoutState === "success"} onClick={() => setStep((s) => s - 1)}>
            Back
          </button>
          {checkoutState === "success" ? (
            <button className="btn" disabled>Activating…</button>
          ) : step < 6 ? (
            <button className="btn" disabled={!canNext || busy} onClick={() => setStep((s) => s + 1)}>
              Continue
            </button>
          ) : (
            <button className="btn" disabled={busy || !canNext} onClick={submit}>
              {busy ? "Opening Stripe…" : "Start 14-day free trial"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
