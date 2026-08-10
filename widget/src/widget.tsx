import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Markdown } from "./Markdown";

export interface WidgetConfig {
  chatbotId: string;
  apiUrl: string;
  brandColour?: string;
  title?: string;
  subtitle?: string;
  quickActions?: string[];
  customerEmail?: string;
}

interface ChatApiRequest {
  chatbotId: string;
  message: string;
  conversationId?: string;
  customerEmail?: string;
}

interface ChatApiResponse {
  reply: string;
  conversationId: string;
  products?: Product[];
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
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [sentFeedback, setSentFeedback] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  const brand = config.brandColour ?? COLORS.primary;
  const title = config.title ?? "Chat with us";
  const quickActions = config.quickActions?.length
    ? config.quickActions
    : ["Track my order", "Gold necklaces under £100", "What's your returns policy?", "Anniversary gift ideas"];

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading, open]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
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
          customerEmail: config.customerEmail,
        } satisfies ChatApiRequest),
      });
      if (!res.ok) throw new Error(`chat failed: ${res.status}`);
      const data = (await res.json()) as ChatApiResponse;
      setConversationId(data.conversationId);
      // Debug guard: server should return a normal assistant reply. If we
      // unexpectedly receive a tool marker or an empty reply, log it and
      // show a friendly fallback so users don't see raw tool strings.
      let assistantContent = data.reply ?? "";
      if (!assistantContent || assistantContent.startsWith("tool:")) {
        console.warn("Unexpected assistant reply from /chat:", data);
        assistantContent = "Sorry — I couldn't form a reply from the assistant. Please try again.";
      }
      setMessages((m) => [...m, { role: "assistant", content: assistantContent, products: data.products }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", content: "Sorry — I couldn't reach the assistant right now. Please try again in a moment.", error: true }]);
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function sendFeedback(rating: number) {
    if (!conversationId || sentFeedback.has(conversationId)) return;
    setSentFeedback((s) => new Set(s).add(conversationId));
    try {
      await fetch(`${config.apiUrl.replace(/\/+$/, "")}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, rating }),
      });
    } catch {
      // feedback is best-effort
    }
  }

  const s: Record<string, React.CSSProperties> = {
    root: { fontFamily: "Inter, system-ui, -apple-system, sans-serif", position: "fixed", bottom: 24, right: 24, zIndex: 2147483000, colorScheme: "light" },
    launcher: { width: 60, height: 60, borderRadius: 30, background: brand, color: "#fff", border: "none", cursor: "pointer", boxShadow: "0 6px 20px rgba(0,0,0,0.22)", display: "flex", alignItems: "center", justifyContent: "center", transition: "transform .15s ease" },
    panel: { position: "fixed", bottom: 96, right: 24, width: 380, maxWidth: "calc(100vw - 32px)", height: 560, maxHeight: "calc(100vh - 120px)", background: COLORS.bg, borderRadius: 16, boxShadow: "0 12px 48px rgba(0,0,0,0.25)", display: "flex", flexDirection: "column", overflow: "hidden", border: `1px solid ${COLORS.border}` },
    header: { background: brand, color: "#fff", padding: "14px 16px", display: "flex", alignItems: "center", gap: 10 },
    headerText: { flex: 1 },
    title: { margin: 0, fontSize: 15, fontWeight: 600, letterSpacing: 0.2 },
    subtitle: { margin: "2px 0 0", fontSize: 12, opacity: 0.9 },
    close: { background: "transparent", border: "none", color: "#fff", cursor: "pointer", fontSize: 18, padding: 4 },
    body: { flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 10, background: "#faf8f4" },
    bubble: { maxWidth: "82%", padding: "10px 13px", borderRadius: 14, fontSize: 14, lineHeight: 1.45, wordBreak: "break-word" },
    user: { background: brand, color: "#fff", alignSelf: "flex-end", borderBottomRightRadius: 4, whiteSpace: "pre-wrap" },
    assistant: { background: COLORS.assistantBubble, color: COLORS.fg, alignSelf: "flex-start", borderBottomLeftRadius: 4 },
    error: { background: "#fdecea", color: COLORS.danger, whiteSpace: "pre-wrap" },
    card: { background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 10, display: "flex", gap: 10, maxWidth: "82%", alignSelf: "flex-start" },
    cardImg: { width: 52, height: 52, borderRadius: 8, objectFit: "cover", background: "#f0ebe0", flexShrink: 0 },
    cardName: { fontSize: 13, fontWeight: 600, color: COLORS.fg, margin: 0 },
    cardPrice: { fontSize: 13, color: brand, fontWeight: 600, margin: "3px 0 0" },
    cardActions: { display: "flex", gap: 8, marginTop: 6 },
    cardBtn: { fontSize: 12, border: "none", borderRadius: 8, padding: "5px 10px", cursor: "pointer", background: brand, color: "#fff" },
    cardLink: { fontSize: 12, color: brand, textDecoration: "none", alignSelf: "center" },
    chips: { display: "flex", flexWrap: "wrap", gap: 6, padding: "0 14px 10px", background: "#faf8f4" },
    chip: { fontSize: 12, border: `1px solid ${COLORS.border}`, background: "#fff", color: COLORS.fg, borderRadius: 999, padding: "6px 11px", cursor: "pointer" },
    inputRow: { display: "flex", gap: 8, padding: 10, borderTop: `1px solid ${COLORS.border}`, background: "#fff" },
    input: { flex: 1, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "9px 12px", fontSize: 14, outline: "none" },
    send: { background: brand, color: "#fff", border: "none", borderRadius: 10, padding: "0 16px", fontSize: 14, fontWeight: 600, cursor: "pointer" },
    typing: { fontSize: 12, color: COLORS.muted, padding: "4px 2px" },
    feedback: { fontSize: 11, color: COLORS.muted, padding: "2px 0 0", display: "flex", gap: 8, alignItems: "center" },
    feedbackBtn: { background: "none", border: "none", cursor: "pointer", fontSize: 13, padding: 0 },
    dot: { display: "inline-block", width: 6, height: 6, marginRight: 4, borderRadius: 3, background: COLORS.muted, animation: "zochatPulse 1.2s infinite" },
  };

  return (
    <div style={s.root}>
      <style>{`
        @keyframes zochatPulse { 0%,100% { opacity: .35 } 50% { opacity: 1 } }
        .zochat-dot:nth-child(2) { animation-delay: .2s } .zochat-dot:nth-child(3) { animation-delay: .4s }
        .zochat-md { font-size: 14px; line-height: 1.5; word-break: break-word; }
        .zochat-md > :first-child { margin-top: 0; }
        .zochat-md > :last-child { margin-bottom: 0; }
        .zochat-md p { margin: 0 0 8px; }
        .zochat-md h1, .zochat-md h2, .zochat-md h3, .zochat-md h4, .zochat-md h5, .zochat-md h6 { margin: 10px 0 6px; font-weight: 700; line-height: 1.3; }
        .zochat-md h1 { font-size: 16px; } .zochat-md h2 { font-size: 15px; } .zochat-md h3 { font-size: 14px; }
        .zochat-md ul, .zochat-md ol { margin: 0 0 8px; padding-left: 20px; }
        .zochat-md li { margin: 2px 0; }
        .zochat-md a { color: ${brand}; text-decoration: underline; }
        .zochat-md strong { font-weight: 700; }
        .zochat-md em { font-style: italic; }
        .zochat-md del { color: ${COLORS.muted}; }
        .zochat-md code { background: rgba(0,0,0,.06); border-radius: 4px; padding: 1px 4px; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px; }
        .zochat-md pre { background: #f0ebe0; border-radius: 8px; padding: 8px 10px; overflow-x: auto; margin: 0 0 8px; }
        .zochat-md pre code { background: none; padding: 0; font-size: 12px; }
        .zochat-md blockquote { border-left: 3px solid #d8cfc0; margin: 0 0 8px; padding: 2px 0 2px 10px; color: ${COLORS.muted}; }
        .zochat-md table { border-collapse: collapse; width: 100%; margin: 0 0 8px; font-size: 13px; }
        .zochat-md th, .zochat-md td { border: 1px solid #e8e1d4; padding: 5px 8px; text-align: left; }
        .zochat-md th { background: #f5f0e6; font-weight: 700; }
        .zochat-md tr:nth-child(even) td { background: #faf8f4; }
        .zochat-md hr { border: none; border-top: 1px solid #e8e1d4; margin: 10px 0; }
        .zochat-md input[type="checkbox"] { margin-right: 6px; }
        .zochat-md img { max-width: 100%; border-radius: 8px; }
      `}</style>
      {open && (
        <div style={s.panel}>
          <div style={s.header}>
            <div style={s.headerText}>
              <p style={s.title}>{title}</p>
              {config.subtitle ? <p style={s.subtitle}>{config.subtitle}</p> : null}
            </div>
            <button style={s.close} onClick={() => setOpen(false)} aria-label="Close chat">✕</button>
          </div>
          <div style={s.body} ref={scrollRef}>
            {messages.length === 0 && !loading && (
              <div style={{ ...s.bubble, ...s.assistant }}>
                {config.subtitle ?? "Hi! How can I help you today?"}
              </div>
            )}
            {(() => {
              const nodes: React.ReactNode[] = [];
              for (let i = 0; i < messages.length; i++) {
                const m = messages[i];

                // Detect assistant tool invocation markers of the form:
                //   tool:NAME:JSON
                if (m.role === "assistant" && typeof m.content === "string" && m.content.startsWith("tool:")) {
                  const payload = m.content.slice("tool:".length);
                  const colon = payload.indexOf(":");
                  const toolName = colon === -1 ? payload : payload.slice(0, colon);
                  let args: any = {};
                  if (colon !== -1) {
                    try {
                      args = JSON.parse(payload.slice(colon + 1));
                    } catch {
                      args = {};
                    }
                  }

                  // The next message is expected to be the tool output (role: user)
                  const next = messages[i + 1];
                  const toolOutput = next && next.role === "user" ? next.content : undefined;

                  nodes.push(
                    <div key={`tool-${i}`} style={s.card}>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{toolName}</div>
                      <div style={{ marginTop: 8, color: COLORS.muted, fontSize: 13 }}>{JSON.stringify(args)}</div>
                      <div style={{ marginTop: 10 }}>{toolOutput ?? "(no result)"}</div>
                    </div>,
                  );

                  if (next && next.role === "user") i++; // skip the tool output message, we've shown it
                  continue;
                }

                // Normal message. When the reply is itself the catalogue
                // listing, the product cards below already show name + price,
                // so we render the cards only (no duplicate text bubble).
                const productListing = m.role === "assistant" && isProductListing(m.content, m.products);
                nodes.push(
                  <div key={i}>
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
                      <div key={String(p.id)} style={s.card}>
                        {p.imageUrl ? <img src={p.imageUrl} alt={p.name} style={s.cardImg} /> : null}
                        <div style={{ flex: 1 }}>
                          <p style={s.cardName}>{p.name}</p>
                          <p style={s.cardPrice}>{sym(p.currency)}{p.price.toFixed(2)}</p>
                          <div style={s.cardActions}>
                            <button
                              style={s.cardBtn}
                              onClick={() => send(`Add ${p.name} (product ${p.id}) to my cart`)}
                            >
                              Add to cart
                            </button>
                            {p.url ? <a style={s.cardLink} href={p.url} target="_blank" rel="noreferrer">View →</a> : null}
                          </div>
                        </div>
                      </div>
                    ))}
                    {m.role === "assistant" && conversationId && !m.error && (
                      <div style={s.feedback}>
                        Was this helpful?
                        <button style={s.feedbackBtn} onClick={() => sendFeedback(1)} aria-label="Helpful">👍</button>
                        <button style={s.feedbackBtn} onClick={() => sendFeedback(-1)} aria-label="Not helpful">👎</button>
                      </div>
                    )}
                  </div>,
                );
              }
              return nodes;
            })()}
            {loading && (
              <div style={{ ...s.bubble, ...s.assistant, ...s.typing }}>
                <span className="zochat-dot" style={s.dot} />
                <span className="zochat-dot" style={s.dot} />
                <span className="zochat-dot" style={s.dot} />
              </div>
            )}
          </div>
          {messages.length === 0 && (
            <div style={s.chips}>
              {quickActions.map((qa) => (
                <button key={qa} style={s.chip} onClick={() => send(qa)}>{qa}</button>
              ))}
            </div>
          )}
          <div style={s.inputRow}>
            <input
              style={s.input}
              value={input}
              placeholder="Ask about products, orders, delivery…"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send(input)}
            />
            <button style={s.send} onClick={() => send(input)} disabled={loading || !input.trim()}>Send</button>
          </div>
        </div>
      )}
      <button style={s.launcher} onClick={() => setOpen((o) => !o)} aria-label="Open chat">
        {open ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M6 6l12 12M18 6L6 18" /></svg>
        ) : (
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>
        )}
      </button>
    </div>
  );
}
