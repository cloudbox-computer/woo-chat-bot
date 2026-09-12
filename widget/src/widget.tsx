import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Markdown } from "./Markdown";

export interface QuickAction {
  label: string;
  prompt: string;
}

export interface WidgetConfig {
  chatbotId: string;
  apiUrl: string;
  brandColour?: string;
  title?: string;
  /** Shown under the title in the widget header bar. */
  assistantHeaderMessage?: string;
  /** First chat bubble shown when the conversation is empty (welcome message). */
  subtitle?: string;
  quickActions?: QuickAction[];
  customerEmail?: string;
  /** GDPR: privacy-policy URL shown in the widget footer + consent line. */
  privacyUrl?: string;
}

interface ChatApiRequest {
  chatbotId: string;
  message: string;
  conversationId?: string;
  conversationToken?: string;
  customerEmail?: string;
  emailConsent?: boolean;
}

interface ChatApiResponse {
  reply: string;
  conversationId: string;
  conversationToken?: string;
  products?: Product[];
  requiresEmail?: boolean;
}

export interface Product {
  id: string | number;
  name: string;
  price: number;
  currency?: string;
  url?: string;
  imageUrl?: string;
  inStock?: boolean;
  description?: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  products?: Product[];
  error?: boolean;
}

const COLORS = {
  primary: "#9c7b4f",
  bg: "#ffffff",
  fg: "#1f1a14",
  muted: "#7a7268",
  border: "#e8e1d4",
  userBubble: "#9c7b4f",
  userText: "#ffffff",
  assistantBubble: "#f5f0e6",
  danger: "#c0392b",
};

/** Widget storage key for persisting customer email across page reloads */
const WIDGET_EMAIL_KEY = "zochat_customer_email";
const WIDGET_SESSION_PREFIX = "zochat_session_";

/**
 * Returns the appropriate text color (#000 or #fff) for readability on top
 * of the given brand color. White or light colors get dark text; dark colors
 * get white text.
 */
function getTextColorForBrand(hex: string): string {
  const clean = hex.replace("#", "");
  let r: number, g: number, b: number;
  if (clean.length === 3) {
    r = parseInt(clean[0] + clean[0], 16);
    g = parseInt(clean[1] + clean[1], 16);
    b = parseInt(clean[2] + clean[2], 16);
  } else if (clean.length === 6) {
    r = parseInt(clean.substring(0, 2), 16);
    g = parseInt(clean.substring(2, 4), 16);
    b = parseInt(clean.substring(4, 6), 16);
  } else {
    return "#ffffff";
  }
  // Relative luminance (WCAG formula)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#000000" : "#ffffff";
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const normalized = clean.length === 3
    ? clean.split("").map((c) => c + c).join("")
    : clean;
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return `rgba(156,123,79,${alpha})`;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// GDPR: used to surface the email-consent box when a customer shares an email.
const EMAIL_RE = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i;

function sym(currency?: string): string {
  if (currency === "GBP") return "£";
  if (currency === "USD") return "$";
  if (currency === "EUR") return "€";
  return currency ? `${currency} ` : "£";
}

/**
 * True when the assistant's text reply is itself the catalogue listing
 * (it names most of the returned products). In that case the product cards
 * below already show name + price, so we hide the redundant text and render
 * the cards only.
 */
function isProductListing(content: string, products?: Product[]): boolean {
  if (!products?.length || !content) return false;
  const lower = content.toLowerCase();
  let matched = 0;
  for (const p of products) {
    if (p.name && lower.includes(p.name.toLowerCase())) matched++;
  }
  return matched >= 2 && matched >= Math.ceil(products.length / 2);
}

export function mountWidget(el: HTMLElement, config: WidgetConfig) {
  createRoot(el).render(<Widget config={config} />);
}

export function Widget({ config }: { config: WidgetConfig }) {
  const sessionKey = `${WIDGET_SESSION_PREFIX}${config.chatbotId}`;
  const initialSession = (() => {
    try {
      return JSON.parse(localStorage.getItem(sessionKey) || "{}") as {
        conversationId?: string;
        conversationToken?: string;
        messages?: Message[];
        lastSyncAt?: string;
      };
    } catch {
      return {};
    }
  })();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>(initialSession.messages ?? []);
  const [conversationId, setConversationId] = useState<string | undefined>(initialSession.conversationId);
  const [conversationToken, setConversationToken] = useState<string | undefined>(initialSession.conversationToken);
  const seenAgentMessages = useRef<Set<string>>(new Set());
  const lastSyncAt = useRef<string>(initialSession.lastSyncAt ?? new Date(0).toISOString());
  const [sentFeedback, setSentFeedback] = useState<Set<string>>(new Set());
  // GDPR: consent box appears once the customer shares an email; when checked,
  // their explicit consent is sent to /chat and stored on the conversation.
  const [emailConsent, setEmailConsent] = useState(false);
  const [askConsent, setAskConsent] = useState(false);
  // Email prompt for cart/checkout when user hasn't provided email yet
  const [showEmailPrompt, setShowEmailPrompt] = useState(false);
  const [pendingEmailAction, setPendingEmailAction] = useState<string | null>(null);
  const [emailInput, setEmailInput] = useState("");

  // Load persisted customer email from localStorage on mount
  const [storedEmail, setStoredEmail] = useState<string>(() => {
    try {
      return localStorage.getItem(WIDGET_EMAIL_KEY) || "";
    } catch {
      return "";
    }
  });

  // Use stored email as the effective customerEmail
  const effectiveEmail = config.customerEmail || storedEmail;

  const scrollRef = useRef<HTMLDivElement>(null);

  const brand = config.brandColour ?? COLORS.primary;
  const brandTextColor = getTextColorForBrand(brand);
  const title = config.title ?? "Chat with us";
  // Starter chips are tenant configuration. No industry-specific defaults live
  // in the widget bundle. Tenants with no configured actions simply show none.
  const quickActions = config.quickActions ?? [];
  const brandSoft = hexToRgba(brand, 0.10);
  const brandSofter = hexToRgba(brand, 0.055);
  const brandRing = hexToRgba(brand, 0.22);
  const brandShadow = hexToRgba(brand, 0.28);

  useEffect(() => {
    if (open) setUnread(0);
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading, open]);

  useEffect(() => {
    if (!conversationId || !conversationToken) return;
    try { localStorage.setItem(sessionKey, JSON.stringify({ conversationId, conversationToken, messages: messages.slice(-100), lastSyncAt: lastSyncAt.current })); } catch { /* ignore */ }
  }, [conversationId, conversationToken, sessionKey, messages]);

  useEffect(() => {
    if (!conversationId || !conversationToken) return;
    let stopped = false;
    const sync = async () => {
      try {
        const res = await fetch(`${config.apiUrl.replace(/\/+$/, "")}/conversation-sync`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatbotId: config.chatbotId, conversationId, conversationToken, since: lastSyncAt.current }),
        });
        if (!res.ok || stopped) return;
        const data = await res.json() as { mode?: string; messages?: Array<{id:string;content:string;created_at:string}> };
        const fresh = (data.messages ?? []).filter((m) => !seenAgentMessages.current.has(m.id));
        if (fresh.length) {
          for (const m of fresh) seenAgentMessages.current.add(m.id);
          setMessages((old) => [...old, ...fresh.map((m) => ({ role: "assistant" as const, content: m.content }))]);
          if (!open) setUnread((count) => Math.min(9, count + fresh.length));
          lastSyncAt.current = fresh[fresh.length - 1].created_at;
        }
      } catch { /* transient sync failures are non-fatal */ }
    };
    void sync();
    const timer = window.setInterval(sync, 3000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [conversationId, conversationToken, config.apiUrl, config.chatbotId, open]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    // GDPR: if the customer is sharing an email, surface the consent box once.
    if (EMAIL_RE.test(trimmed) && !askConsent) setAskConsent(true);
    // Auto-persist email if user mentions it in chat
    const emailMatch = trimmed.match(EMAIL_RE);
    if (emailMatch && !effectiveEmail) {
      try {
        localStorage.setItem(WIDGET_EMAIL_KEY, emailMatch[0]);
        setStoredEmail(emailMatch[0]);
      } catch {
        // ignore storage failures
      }
    }
    setInput("");
    setMessages((m) => [...m, { role: "user", content: trimmed }]);
    setLoading(true);
    try {
      const res = await fetch(`${config.apiUrl.replace(/\/+$/, "")}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatbotId: config.chatbotId,
          message: trimmed,
          conversationId,
          conversationToken,
          customerEmail: effectiveEmail,
          emailConsent: emailConsent || undefined,
        } satisfies ChatApiRequest),
      });
      if (!res.ok) throw new Error(`chat failed: ${res.status}`);
      const data = (await res.json()) as ChatApiResponse;
      setConversationId(data.conversationId);
      setConversationToken(data.conversationToken);
      // Debug guard: server should return a normal assistant reply. If we
      // unexpectedly receive a tool marker or an empty reply, log it and
      // show a friendly fallback so users don't see raw tool strings.
      let assistantContent = data.reply ?? "";
      if (!assistantContent || assistantContent.startsWith("tool:")) {
        console.warn("Unexpected assistant reply from /chat:", data);
        assistantContent = "Sorry — I couldn't form a reply from the assistant. Please try again.";
      }
      // If the backend requires an email for cart actions, show prompt
      if (data.requiresEmail) {
        setShowEmailPrompt(true);
        setPendingEmailAction(trimmed);
      }
      setMessages((m) => [...m, { role: "assistant", content: assistantContent, products: data.products }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", content: "Sorry — I couldn't reach the assistant right now. Please try again in a moment.", error: true }]);
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  function handleAddToCart(product: Product) {
    // Check if user has email configured or stored
    if (!effectiveEmail) {
      setPendingEmailAction(`Add ${product.name} (product ${product.id}) to my cart`);
      setShowEmailPrompt(true);
      return;
    }
    send(`Add ${product.name} (product ${product.id}) to my cart`);
  }

  function handleSubmitEmail(email: string) {
    setShowEmailPrompt(false);
    setEmailInput("");
    // Persist email to localStorage for this conversation
    try {
      localStorage.setItem(WIDGET_EMAIL_KEY, email);
    } catch {
      // ignore storage failures
    }
    setStoredEmail(email);
    if (pendingEmailAction) {
      // Re-attempt the original action with the provided email
      send(`${pendingEmailAction}. My email is ${email}`);
    }
  }

  function handleCancelEmailPrompt() {
    setShowEmailPrompt(false);
    setEmailInput("");
    setPendingEmailAction(null);
  }

  async function sendFeedback(rating: number) {
    if (!conversationId || sentFeedback.has(conversationId)) return;
    setSentFeedback((s) => new Set(s).add(conversationId));
    try {
      await fetch(`${config.apiUrl.replace(/\/+$/, "")}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatbotId: config.chatbotId, conversationId, conversationToken, rating }),
      });
    } catch {
      // feedback is best-effort
    }
  }

  const s: Record<string, React.CSSProperties> = {
    root: {
      fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      position: "fixed",
      bottom: 24,
      right: 24,
      zIndex: 2147483000,
      colorScheme: "light",
      WebkitFontSmoothing: "antialiased",
    },
    launcher: {
      width: 58,
      height: 58,
      borderRadius: 20,
      background: brand,
      color: brandTextColor,
      border: "1px solid rgba(255,255,255,.24)",
      cursor: "pointer",
      boxShadow: `0 14px 36px ${brandShadow}, 0 5px 14px rgba(15,23,42,.16)`,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      position: "relative",
      overflow: "visible",
    },
    panel: {
      position: "fixed",
      bottom: 96,
      right: 24,
      width: 392,
      maxWidth: "calc(100vw - 32px)",
      height: 590,
      maxHeight: "calc(100vh - 124px)",
      background: COLORS.bg,
      borderRadius: 24,
      boxShadow: "0 30px 80px rgba(15,23,42,.22), 0 10px 30px rgba(15,23,42,.10)",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      border: "1px solid rgba(15,23,42,.08)",
      transformOrigin: "bottom right",
    },
    header: {
      background: `linear-gradient(135deg, ${brand} 0%, ${brand} 68%, ${hexToRgba(brand, 0.82)} 100%)`,
      color: brandTextColor,
      padding: "17px 18px 16px",
      display: "flex",
      alignItems: "center",
      gap: 12,
      position: "relative",
      overflow: "hidden",
    },
    avatar: {
      width: 42,
      height: 42,
      borderRadius: 14,
      background: "rgba(255,255,255,.17)",
      border: "1px solid rgba(255,255,255,.30)",
      display: "grid",
      placeItems: "center",
      flexShrink: 0,
      boxShadow: "inset 0 1px 0 rgba(255,255,255,.18)",
    },
    headerText: { flex: 1, minWidth: 0 },
    title: { margin: 0, fontSize: 15, fontWeight: 750, letterSpacing: -0.1, lineHeight: 1.25 },
    subtitle: { margin: "4px 0 0", fontSize: 12, opacity: 0.88, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
    close: {
      width: 34,
      height: 34,
      borderRadius: 11,
      display: "grid",
      placeItems: "center",
      background: "rgba(255,255,255,.12)",
      border: "1px solid rgba(255,255,255,.16)",
      color: brandTextColor,
      cursor: "pointer",
      padding: 0,
    },
    body: {
      flex: 1,
      overflowY: "auto",
      padding: "18px 16px 14px",
      display: "flex",
      flexDirection: "column",
      gap: 11,
      background: `linear-gradient(180deg, ${brandSofter} 0, #fbfbfc 120px, #fbfbfc 100%)`,
      scrollBehavior: "smooth",
      overscrollBehavior: "contain",
    },
    bubble: {
      maxWidth: "84%",
      padding: "11px 14px",
      borderRadius: 17,
      fontSize: 14,
      lineHeight: 1.5,
      wordBreak: "break-word",
    },
    user: {
      background: brand,
      color: brandTextColor,
      alignSelf: "flex-end",
      borderBottomRightRadius: 6,
      whiteSpace: "pre-wrap",
      boxShadow: `0 5px 14px ${hexToRgba(brand, 0.16)}`,
    },
    assistant: {
      background: "#ffffff",
      color: COLORS.fg,
      alignSelf: "flex-start",
      borderBottomLeftRadius: 6,
      border: "1px solid rgba(15,23,42,.065)",
      boxShadow: "0 4px 16px rgba(15,23,42,.055)",
    },
    error: { background: "#fff4f2", color: COLORS.danger, whiteSpace: "pre-wrap", border: "1px solid #fbd5cf" },
    card: {
      background: "#fff",
      border: "1px solid rgba(15,23,42,.075)",
      borderRadius: 17,
      padding: 10,
      display: "flex",
      gap: 11,
      maxWidth: "88%",
      alignSelf: "flex-start",
      boxShadow: "0 7px 22px rgba(15,23,42,.06)",
    },
    cardImg: { width: 64, height: 64, borderRadius: 12, objectFit: "cover", background: "#f1f2f4", flexShrink: 0 },
    cardName: { fontSize: 13, fontWeight: 700, color: COLORS.fg, margin: 0, lineHeight: 1.35 },
    cardPrice: { fontSize: 13, color: brand, fontWeight: 750, margin: "4px 0 0" },
    cardActions: { display: "flex", gap: 8, marginTop: 8 },
    cardBtn: { fontSize: 12, border: "none", borderRadius: 9, padding: "6px 10px", cursor: "pointer", background: brand, color: brandTextColor, fontWeight: 650 },
    cardLink: { fontSize: 12, color: brand, textDecoration: "none", alignSelf: "center", fontWeight: 650 },
    chips: { display: "flex", flexWrap: "wrap", gap: 7, padding: "0 14px 12px", background: "#fbfbfc" },
    chip: { fontSize: 12, border: `1px solid ${brandRing}`, background: brandSoft, color: COLORS.fg, borderRadius: 999, padding: "7px 11px", cursor: "pointer", fontWeight: 600 },
    inputShell: { padding: "10px 12px 11px", borderTop: "1px solid rgba(15,23,42,.07)", background: "rgba(255,255,255,.96)" },
    inputRow: {
      display: "flex",
      gap: 8,
      alignItems: "flex-end",
      padding: 5,
      border: "1px solid rgba(15,23,42,.11)",
      background: "#fff",
      borderRadius: 16,
      boxShadow: "0 3px 12px rgba(15,23,42,.04)",
    },
    input: {
      flex: 1,
      border: "none",
      background: "transparent",
      borderRadius: 10,
      padding: "9px 9px 8px",
      fontSize: 14,
      lineHeight: 1.35,
      outline: "none",
      resize: "none",
      minHeight: 38,
      maxHeight: 90,
      fontFamily: "inherit",
      color: COLORS.fg,
    },
    send: {
      width: 38,
      height: 38,
      minWidth: 38,
      background: brand,
      color: brandTextColor,
      border: "none",
      borderRadius: 12,
      display: "grid",
      placeItems: "center",
      cursor: "pointer",
      padding: 0,
      boxShadow: `0 5px 12px ${hexToRgba(brand, 0.20)}`,
    },
    typing: { fontSize: 12, color: COLORS.muted, padding: "12px 14px" },
    feedback: { fontSize: 11, color: COLORS.muted, padding: "5px 2px 0", display: "flex", gap: 7, alignItems: "center" },
    feedbackBtn: { background: "none", border: "none", cursor: "pointer", fontSize: 13, padding: "2px 3px", borderRadius: 6 },
    dot: { display: "inline-block", width: 6, height: 6, marginRight: 4, borderRadius: 3, background: brand, animation: "zochatPulse 1.15s infinite ease-in-out" },
    unread: {
      position: "absolute",
      top: -5,
      right: -5,
      minWidth: 20,
      height: 20,
      borderRadius: 999,
      padding: "0 5px",
      background: "#ef4444",
      color: "#fff",
      border: "2px solid #fff",
      fontSize: 10,
      fontWeight: 800,
      display: "grid",
      placeItems: "center",
      lineHeight: 1,
      boxShadow: "0 3px 8px rgba(0,0,0,.18)",
    },
  };

  const commonStyles = `
    @keyframes zochatPulse { 0%,100% { opacity:.28; transform:translateY(0) } 50% { opacity:1; transform:translateY(-2px) } }
    @keyframes zochatMessageIn { from { opacity:0; transform:translateY(9px) scale(.985) } to { opacity:1; transform:translateY(0) scale(1) } }
    @keyframes zochatHalo { 0%,100% { transform:scale(.92); opacity:.30 } 50% { transform:scale(1.18); opacity:0 } }
    @keyframes zochatSpark { 0%,100% { transform:rotate(0deg) scale(1); opacity:.85 } 50% { transform:rotate(10deg) scale(1.08); opacity:1 } }
    .zochat-panel { opacity:0; visibility:hidden; pointer-events:none; transform:translateY(18px) scale(.955); transition:opacity .22s ease, transform .38s cubic-bezier(.2,.9,.25,1.15), visibility .22s; }
    .zochat-panel.is-open { opacity:1; visibility:visible; pointer-events:auto; transform:translateY(0) scale(1); }
    .zochat-launcher { transition:transform .22s cubic-bezier(.2,.8,.2,1), box-shadow .22s ease, border-radius .22s ease; }
    .zochat-launcher:hover { transform:translateY(-2px) scale(1.035); }
    .zochat-launcher:active { transform:scale(.95); }
    .zochat-launcher::before { content:""; position:absolute; inset:-7px; border-radius:25px; border:1px solid ${brandRing}; pointer-events:none; animation:zochatHalo 2.8s ease-out infinite; }
    .zochat-launcher.is-open::before { display:none; }
    .zochat-header-glow { position:absolute; width:150px; height:150px; border-radius:50%; right:-72px; top:-95px; background:rgba(255,255,255,.13); pointer-events:none; }
    .zochat-message { animation:zochatMessageIn .28s cubic-bezier(.2,.8,.2,1) both; }
    .zochat-chip, .zochat-product-btn, .zochat-close, .zochat-send, .zochat-feedback-btn { transition:transform .16s ease, filter .16s ease, background .16s ease, box-shadow .16s ease; }
    .zochat-chip:hover { transform:translateY(-1px); background:${hexToRgba(brand, .15)}; }
    .zochat-product-btn:hover, .zochat-send:hover:not(:disabled) { transform:translateY(-1px); filter:brightness(.96); }
    .zochat-close:hover { background:rgba(255,255,255,.20) !important; transform:rotate(3deg); }
    .zochat-feedback-btn:hover { background:rgba(15,23,42,.06) !important; transform:scale(1.08); }
    .zochat-send:disabled { opacity:.38; cursor:not-allowed; box-shadow:none !important; }
    .zochat-input-row:focus-within { border-color:${hexToRgba(brand,.48)} !important; box-shadow:0 0 0 4px ${hexToRgba(brand,.08)} !important; }
    .zochat-body::-webkit-scrollbar { width:6px; }
    .zochat-body::-webkit-scrollbar-thumb { background:rgba(15,23,42,.12); border-radius:999px; }
    .zochat-dot:nth-child(2) { animation-delay:.15s } .zochat-dot:nth-child(3) { animation-delay:.30s }
    .zochat-spark { animation:zochatSpark 3s ease-in-out infinite; transform-origin:center; }
    .zochat-md { font-size:14px; line-height:1.5; word-break:break-word; }
    .zochat-md > :first-child { margin-top:0; }
    .zochat-md > :last-child { margin-bottom:0; }
    .zochat-md p { margin:0 0 8px; }
    .zochat-md h1,.zochat-md h2,.zochat-md h3,.zochat-md h4,.zochat-md h5,.zochat-md h6 { margin:10px 0 6px; font-weight:700; line-height:1.3; }
    .zochat-md h1 { font-size:16px; } .zochat-md h2 { font-size:15px; } .zochat-md h3 { font-size:14px; }
    .zochat-md ul,.zochat-md ol { margin:0 0 8px; padding-left:20px; }
    .zochat-md li { margin:2px 0; }
    .zochat-md a { color:${brand}; text-decoration:underline; text-underline-offset:2px; }
    .zochat-md strong { font-weight:700; }
    .zochat-md em { font-style:italic; }
    .zochat-md del { color:${COLORS.muted}; }
    .zochat-md code { background:rgba(0,0,0,.055); border-radius:5px; padding:1px 4px; font-family:ui-monospace,"SF Mono",Menlo,monospace; font-size:12px; }
    .zochat-md pre { background:#f3f4f6; border-radius:10px; padding:9px 10px; overflow-x:auto; margin:0 0 8px; }
    .zochat-md pre code { background:none; padding:0; font-size:12px; }
    .zochat-md blockquote { border-left:3px solid ${brandRing}; margin:0 0 8px; padding:2px 0 2px 10px; color:${COLORS.muted}; }
    .zochat-md table { border-collapse:collapse; width:100%; margin:0 0 8px; font-size:13px; }
    .zochat-md th,.zochat-md td { border:1px solid #e5e7eb; padding:5px 8px; text-align:left; }
    .zochat-md th { background:#f7f7f8; font-weight:700; }
    .zochat-md tr:nth-child(even) td { background:#fbfbfc; }
    .zochat-md hr { border:none; border-top:1px solid #e5e7eb; margin:10px 0; }
    .zochat-md input[type="checkbox"] { margin-right:6px; }
    .zochat-md img { max-width:100%; border-radius:10px; }
    @media (max-width: 520px) {
      .zochat-panel { right:12px !important; bottom:86px !important; width:calc(100vw - 24px) !important; max-width:none !important; height:min(680px, calc(100dvh - 104px)) !important; max-height:none !important; border-radius:22px !important; }
      .zochat-root { right:14px !important; bottom:14px !important; }
    }
    @media (prefers-reduced-motion: reduce) {
      .zochat-panel,.zochat-launcher,.zochat-message,.zochat-chip,.zochat-product-btn,.zochat-close,.zochat-send,.zochat-feedback-btn { animation:none !important; transition:none !important; }
      .zochat-launcher::before,.zochat-spark,.zochat-dot { animation:none !important; }
    }
  `;

  return (
    <div className="zochat-root" style={s.root}>
      <style>{commonStyles}</style>
      <div
        className={`zochat-panel${open ? " is-open" : ""}`}
        style={s.panel}
        aria-hidden={!open}
      >
        <div style={s.header}>
          <div className="zochat-header-glow" />
          <div style={s.avatar} aria-hidden="true">
            <svg className="zochat-spark" width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v3M12 18v3M3 12h3M18 12h3" opacity=".65" />
              <path d="M12 7.5c.65 2.15 2.35 3.85 4.5 4.5-2.15.65-3.85 2.35-4.5 4.5-.65-2.15-2.35-3.85-4.5-4.5 2.15-.65 3.85-2.35 4.5-4.5Z" fill="currentColor" fillOpacity=".16" />
            </svg>
          </div>
          <div style={s.headerText}>
            <p style={s.title}>{title}</p>
            {config.assistantHeaderMessage ? <p style={s.subtitle}>{config.assistantHeaderMessage}</p> : null}
          </div>
          <button className="zochat-close" style={s.close} onClick={() => setOpen(false)} aria-label="Close chat">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>

        <div className="zochat-body" style={s.body} ref={scrollRef}>
          {messages.length === 0 && !loading && (
            <div className="zochat-message" style={{ ...s.bubble, ...s.assistant }}>
              {config.subtitle ?? "Hi! How can I help you today?"}
            </div>
          )}
          {(() => {
            const nodes: React.ReactNode[] = [];
            for (let i = 0; i < messages.length; i++) {
              const m = messages[i];

              if (m.role === "assistant" && typeof m.content === "string" && m.content.startsWith("tool:")) {
                const payload = m.content.slice("tool:".length);
                const colon = payload.indexOf(":");
                const toolName = colon === -1 ? payload : payload.slice(0, colon);
                let args: any = {};
                if (colon !== -1) {
                  try { args = JSON.parse(payload.slice(colon + 1)); } catch { args = {}; }
                }
                const next = messages[i + 1];
                const toolOutput = next && next.role === "user" ? next.content : undefined;
                nodes.push(
                  <div key={`tool-${i}`} className="zochat-message" style={s.card}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{toolName}</div>
                    <div style={{ marginTop: 8, color: COLORS.muted, fontSize: 13 }}>{JSON.stringify(args)}</div>
                    <div style={{ marginTop: 10 }}>{toolOutput ?? "(no result)"}</div>
                  </div>,
                );
                if (next && next.role === "user") i++;
                continue;
              }

              const productListing = m.role === "assistant" && isProductListing(m.content, m.products);
              nodes.push(
                <div key={i} className="zochat-message">
                  {m.role === "assistant" ? (
                    !productListing && (
                      <div style={{ ...s.bubble, ...(m.error ? s.error : s.assistant) }}>
                        <Markdown>{m.content}</Markdown>
                      </div>
                    )
                  ) : (
                    <div style={{ ...s.bubble, ...s.user }}>{m.content}</div>
                  )}
                  {m.products?.map((p) => (
                    <div key={String(p.id)} style={{ ...s.card, marginTop: productListing ? 0 : 8 }}>
                      {p.imageUrl ? <img src={p.imageUrl} alt={p.name} style={s.cardImg} /> : null}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={s.cardName}>{p.name}</p>
                        <p style={s.cardPrice}>{sym(p.currency)}{p.price.toFixed(2)}</p>
                        <div style={s.cardActions}>
                          <button className="zochat-product-btn" style={s.cardBtn} onClick={() => handleAddToCart(p)}>Add to cart</button>
                          {p.url ? <a style={s.cardLink} href={p.url} target="_blank" rel="noreferrer">View →</a> : null}
                        </div>
                      </div>
                    </div>
                  ))}
                  {m.role === "assistant" && conversationId && !m.error && (
                    <div style={s.feedback}>
                      Helpful?
                      <button className="zochat-feedback-btn" style={s.feedbackBtn} onClick={() => sendFeedback(1)} aria-label="Helpful">👍</button>
                      <button className="zochat-feedback-btn" style={s.feedbackBtn} onClick={() => sendFeedback(-1)} aria-label="Not helpful">👎</button>
                    </div>
                  )}
                </div>,
              );
            }
            return nodes;
          })()}
          {loading && (
            <div className="zochat-message" style={{ ...s.bubble, ...s.assistant, ...s.typing }} aria-label="Assistant is typing">
              <span className="zochat-dot" style={s.dot} />
              <span className="zochat-dot" style={s.dot} />
              <span className="zochat-dot" style={s.dot} />
            </div>
          )}
        </div>

        {messages.length === 0 && quickActions.length > 0 && (
          <div style={s.chips}>
            {quickActions.map((qa, index) => (
              <button key={`${qa.label}-${index}`} className="zochat-chip" style={s.chip} onClick={() => send(qa.prompt)}>
                {qa.label}
              </button>
            ))}
          </div>
        )}

        {askConsent && (
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "8px 13px", borderTop: "1px solid rgba(15,23,42,.07)", background: "#fff", fontSize: 11, color: COLORS.muted, lineHeight: 1.45, cursor: "pointer" }}>
            <input type="checkbox" checked={emailConsent} onChange={(e) => setEmailConsent(e.target.checked)} style={{ marginTop: 1 }} />
            <span>
              I agree to {title} storing my email to help with this enquiry.
              {config.privacyUrl ? <> <a href={config.privacyUrl} target="_blank" rel="noreferrer" style={{ color: brand, textDecoration: "underline" }}>Privacy policy</a></> : null}
            </span>
          </label>
        )}

        {showEmailPrompt && (
          <div style={{ padding: "12px 14px", borderTop: "1px solid rgba(15,23,42,.07)", background: "#fff" }}>
            <p style={{ fontSize: 13, color: COLORS.fg, margin: "0 0 8px" }}>To add items to cart, please provide your email address:</p>
            <div style={{ display: "flex", gap: 8 }}>
              <input style={{ flex: 1, minWidth: 0, border: "1px solid rgba(15,23,42,.12)", borderRadius: 10, padding: "9px 10px", fontSize: 13, outline: "none" }} placeholder="your@email.com" value={emailInput} onChange={(e) => setEmailInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && emailInput.trim() && handleSubmitEmail(emailInput.trim())} />
              <button className="zochat-product-btn" style={{ ...s.cardBtn, padding: "7px 11px" }} onClick={() => emailInput.trim() && handleSubmitEmail(emailInput.trim())} disabled={!emailInput.trim()}>Save</button>
              <button style={{ ...s.cardBtn, padding: "7px 11px", background: "#eef0f2", color: COLORS.fg }} onClick={handleCancelEmailPrompt}>Cancel</button>
            </div>
          </div>
        )}

        <div style={s.inputShell}>
          <div className="zochat-input-row" style={s.inputRow}>
            <textarea
              style={s.input}
              rows={1}
              value={input}
              placeholder="Message…"
              aria-label="Message"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
            />
            <button className="zochat-send" style={s.send} onClick={() => send(input)} disabled={loading || !input.trim()} aria-label="Send message">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
            </button>
          </div>
        </div>

        {config.privacyUrl && (
          <div style={{ padding: "0 14px 9px", background: "#fff", fontSize: 9.5, color: COLORS.muted, lineHeight: 1.45, textAlign: "center" }}>
            🔒 Your details are used only to respond to your enquiry. <a href={config.privacyUrl} target="_blank" rel="noreferrer" style={{ color: brand, textDecoration: "none", fontWeight: 650 }}>Privacy</a>
          </div>
        )}
      </div>

      <button
        className={`zochat-launcher${open ? " is-open" : ""}`}
        style={s.launcher}
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close chat" : "Open chat"}
        aria-expanded={open}
      >
        {open ? (
          <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
        ) : (
          <svg width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /><path d="M8 11.5h.01M12 11.5h.01M16 11.5h.01" strokeWidth="2.5" /></svg>
        )}
        {!open && unread > 0 ? <span style={s.unread}>{unread > 9 ? "9+" : unread}</span> : null}
      </button>
    </div>
  );
}
