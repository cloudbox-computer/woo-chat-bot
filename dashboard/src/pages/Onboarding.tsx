import React from "react";
import { runOnboarding, analyzeWebsite, type OnboardingInput, type OnboardingResult } from "../lib/api";
import { supabase } from "../lib/supabase";
import { toast } from "../components/ui";

// 7-step onboarding wizard (convo3.md §Onboarding).
// Each step maps to a portion of the OnboardingInput payload; step 7 (Install)
// shows the embed script once onboarding completes.

const STEPS = [
  "Business",
  "Assistant",
  "Strict scope",
  "Knowledge",
  "Integrations",
  "Support",
  "Install",
];

const TOPICS = [
  { id: "products", label: "Products & catalogue" },
  { id: "orders", label: "Orders & shipping" },
  { id: "returns", label: "Returns & refunds" },
  { id: "support", label: "Support tickets" },
  { id: "hours", label: "Opening hours" },
  { id: "policies", label: "Store policies" },
];

const TONES = ["friendly", "professional", "playful", "helpful", "calm", "luxury"];
const SECURITY_LEVELS: Array<{ id: OnboardingInput["securityLevel"]; label: string; desc: string }> = [
  { id: "standard", label: "Standard", desc: "Answer most questions; refuse clearly off-topic ones." },
  { id: "strict", label: "Strict", desc: "Only answer on-topic questions; flag anything ambiguous." },
  { id: "extra-strict", label: "Extra strict", desc: "Maximum guardrails — best for retail." },
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
  securityLevel: OnboardingInput["securityLevel"];
  knowledge: Array<{ title: string; content: string }>;
  wooUrl: string;
  wooKey: string;
  wooSecret: string;
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
  allowedTopics: ["products", "orders", "returns", "support"],
  securityLevel: "strict",
  knowledge: [],
  wooUrl: "",
  wooKey: "",
  wooSecret: "",
  supportEmail: "",
  ticketPrefix: "",
  defaultTicketPriority: "normal",
  autoTicketCategories: [],
};

export default function Onboarding() {
  const [step, setStep] = React.useState(0);
  const [state, setState] = React.useState<WizardState>(initial);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<OnboardingResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [analyzing, setAnalyzing] = React.useState(false);
  const [analyzeError, setAnalyzeError] = React.useState<string | null>(null);

  const set = <K extends keyof WizardState>(key: K, value: WizardState[K]) =>
    setState((s) => ({ ...s, [key]: value }));

  const toggleTopic = (id: string) =>
    setState((s) => ({
      ...s,
      allowedTopics: s.allowedTopics.includes(id)
        ? s.allowedTopics.filter((t) => t !== id)
        : [...s.allowedTopics, id],
    }));

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
      const input: OnboardingInput = {
        name: state.name,
        website: state.website || undefined,
        industry: state.industry || undefined,
        businessContext: state.businessContext || undefined,
        botName: state.botName || undefined,
        welcomeMessage: state.welcomeMessage || undefined,
        tone: state.tone,
        brandColour: state.brandColour,
        allowedTopics: state.allowedTopics,
        securityLevel: state.securityLevel,
        knowledge: state.knowledge.filter((k) => k.title.trim() && k.content.trim()).map((k) => ({
          title: k.title.trim(),
          content: k.content.trim(),
        })),
        integrations:
          state.wooUrl && state.wooKey && state.wooSecret
            ? [
                {
                  provider: "woocommerce",
                  credentials: {
                    url: state.wooUrl.trim(),
                    consumer_key: state.wooKey.trim(),
                    consumer_secret: state.wooSecret.trim(),
                  },
                },
              ]
            : [],
        supportEmail: state.supportEmail || undefined,
        ticketPrefix: state.ticketPrefix || undefined,
        defaultTicketPriority: state.defaultTicketPriority,
        autoTicketCategories: state.autoTicketCategories,
      };
      const res = await runOnboarding(input);
      setResult(res);
      setStep(6); // Install
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

  const canNext =
    step === 0 ? state.name.trim().length > 0 :
    step === 5 ? state.supportEmail.trim().length === 0 || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.supportEmail) :
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
              <label>Business name *</label>
              <input type="text" value={state.name} onChange={(e) => set("name", e.target.value)} placeholder="Ivy & Pearls" />
            </div>
            <div className="field">
              <label>Website</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="url"
                  value={state.website}
                  onChange={(e) => set("website", e.target.value)}
                  placeholder="https://ivyandpearls.co.uk"
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
              <label>Industry</label>
              <input type="text" value={state.industry} onChange={(e) => set("industry", e.target.value)} placeholder="Jewellery" />
            </div>
            <div className="field">
              <label>Anything the assistant should know?</label>
              <textarea
                value={state.businessContext}
                onChange={(e) => set("businessContext", e.target.value)}
                placeholder="e.g. Handmade jewellery, shipping UK-wide, 30-day returns…"
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
              <div className="chip-grid">
                {TOPICS.map((t) => (
                  <button
                    key={t.id}
                    className={`chip-option ${state.allowedTopics.includes(t.id) ? "active" : ""}`}
                    onClick={() => toggleTopic(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
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
            <h2>Connect your store</h2>
            <p className="step-desc">
              WooCommerce credentials let the assistant look up products, orders and manage carts. Optional — you can
              connect later.
            </p>
            <div className="field">
              <label>WooCommerce store URL</label>
              <input type="url" value={state.wooUrl} onChange={(e) => set("wooUrl", e.target.value)} placeholder="https://ivyandpearls.co.uk" />
            </div>
            <div className="field">
              <label>Consumer key</label>
              <input type="text" value={state.wooKey} onChange={(e) => set("wooKey", e.target.value)} placeholder="ck_…" />
            </div>
            <div className="field">
              <label>Consumer secret</label>
              <input type="password" value={state.wooSecret} onChange={(e) => set("wooSecret", e.target.value)} placeholder="cs_…" />
            </div>
            <p className="muted">
              Create these in WooCommerce → Settings → Advanced → REST API. The assistant needs read access for
              products/orders.
            </p>
          </>
        )}

        {step === 5 && (
          <>
            <h2>Support & tickets</h2>
            <p className="step-desc">Where support tickets go and how they're organised.</p>
            <div className="field">
              <label>Support email</label>
              <input type="email" value={state.supportEmail} onChange={(e) => set("supportEmail", e.target.value)} placeholder="support@yourstore.com" />
              <div className="hint">Tickets created by customers are emailed here.</div>
            </div>
            <div className="field">
              <label>Ticket reference prefix</label>
              <input type="text" value={state.ticketPrefix} onChange={(e) => set("ticketPrefix", e.target.value)} placeholder="IP" maxLength={4} />
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
              />
              <div className="hint">Comma-separated. The assistant categorises tickets automatically.</div>
            </div>
          </>
        )}

        {step === 6 && (
          <>
            <h2>Install on your site</h2>
            <p className="step-desc">
              {result ? "Your assistant is live! Paste this before the closing </body> tag." : "Processing your setup…"}
            </p>
            {result && (
              <>
                <div className="codeblock">{result.embedScript}</div>
                <p className="muted" style={{ marginTop: 12 }}>
                  Public chatbot ID <strong>{result.publicId}</strong>. This is the only tenant identifier included in the installation snippet.
                  The snippet is also shown in the dashboard under <strong>Install</strong>.
                </p>
                <a href="/" className="btn" style={{ marginTop: 12 }}>Open your dashboard</a>
              </>
            )}
          </>
        )}

        {error && step < 6 ? <div className="err" style={{ color: "var(--red)", marginTop: 8 }}>{error}</div> : null}

        <div className="wizard-nav">
          <button className="btn secondary" disabled={step === 0 || busy} onClick={() => setStep((s) => s - 1)}>
            Back
          </button>
          {step < 5 ? (
            <button className="btn" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>
              Continue
            </button>
          ) : (
            <button className="btn" disabled={busy || !canNext} onClick={submit}>
              {busy ? "Creating…" : "Create my assistant"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
