import { createRoot } from "react-dom/client";
import { Widget, type WidgetConfig } from "./widget";

// Embed bootstrap — the file WordPress loads as widget.js.
//
// Usage in any site (WordPress included):
//   <script src="https://<your-cdn-or-supabase-storage>/widget.js"
//           data-chatbot-id="ivy-pearls"
//           data-api-url="https://<project-ref>.supabase.co/functions/v1"
//           data-brand-colour="#9c7b4f"
//           data-title="Ivy & Pearls"
//           data-customer-email="optional@email.com"
//           defer></script>
//
// The widget renders inside a Shadow DOM so the host site's CSS cannot
// affect it, and its own styles cannot leak out.

function readConfig(): WidgetConfig {
  const s = document.currentScript as HTMLScriptElement | null;
  const d = s?.dataset ?? {};
  const apiUrl =
    d.apiUrl ??
    (s?.getAttribute("data-api-url") ?? "") ??
    `${location.protocol}//${location.host}/functions/v1`;
  return {
    chatbotId: d.chatbotId ?? "ivy-pearls",
    apiUrl,
    brandColour: d.brandColour,
    title: d.title,
    subtitle: d.subtitle,
    quickActions: d.quickActions?.split("|").map((x) => x.trim()),
    customerEmail: d.customerEmail,
  };
}

function init() {
  const config = readConfig();
  const host = document.createElement("div");
  host.id = `zochat-${config.chatbotId}`;
  host.style.display = "contents";
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  const mount = document.createElement("div");
  shadow.appendChild(mount);
  createRoot(mount).render(<Widget config={config} />);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
