import { createRoot } from "react-dom/client";
import { Widget, type WidgetConfig } from "./widget";

interface PublicWidgetConfig {
  chatbotId: string;
  active: boolean;
  name: string;
  title: string;
  welcomeMessage?: string | null;
  assistantHeaderMessage?: string | null;
  subtitle?: string | null;
  brandColour?: string | null;
  storeUrl?: string | null;
  privacyPolicyUrl?: string | null;
}

function scriptElement(): HTMLScriptElement | null {
  return (
    (document.currentScript as HTMLScriptElement | null) ??
    document.querySelector<HTMLScriptElement>("script[data-chatbot]")
  );
}

function apiBaseFromScript(script: HTMLScriptElement | null): string {
  const explicit = script?.dataset.apiUrl ?? script?.getAttribute("data-api-url");
  if (explicit) return explicit.replace(/\/+$/, "");

  const src = script?.src;
  if (!src) return `${location.origin}`;
  const url = new URL(src, document.baseURI);
  let path = url.pathname.replace(/\/+$/, "");
  if (path.endsWith("/widget.js")) path = path.slice(0, -"/widget.js".length);
  else if (path.endsWith("/widget")) path = path.slice(0, -"/widget".length);
  return `${url.origin}${path}`.replace(/\/+$/, "");
}

async function loadConfig(apiBase: string, publicId: string): Promise<PublicWidgetConfig> {
  const url = `${apiBase}/widget-config?chatbot=${encodeURIComponent(publicId)}`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Widget configuration failed (${response.status})`);
  const config = (await response.json()) as PublicWidgetConfig;
  if (!config.active || !config.chatbotId) throw new Error("This chatbot is not available");
  return config;
}

function readPublicId(script: HTMLScriptElement | null): string {
  return script?.dataset.chatbot ?? script?.getAttribute("data-chatbot") ?? "";
}

function init(script: HTMLScriptElement | null) {
  const publicId = readPublicId(script);
  if (!publicId) {
    console.error("Chat widget requires data-chatbot");
    return;
  }

  const apiUrl = apiBaseFromScript(script);
  const host = document.createElement("div");
  host.id = `zochat-${publicId}`;
  host.style.display = "contents";
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  const mount = document.createElement("div");
  shadow.appendChild(mount);

  loadConfig(apiUrl, publicId)
    .then((remote) => {
      const data = script?.dataset ?? {};
      const config: WidgetConfig = {
        chatbotId: remote.chatbotId,
        apiUrl,
        brandColour: data.brandColour ?? remote.brandColour ?? undefined,
        title: data.title ?? remote.title,
        // Use the dedicated assistant header message when set; fall back to
        // subtitle/welcomeMessage for backwards-compatibility.
        assistantHeaderMessage:
          data.assistantHeaderMessage ?? remote.assistantHeaderMessage ?? (remote.subtitle ?? undefined),
        subtitle: data.subtitle ?? remote.subtitle ?? remote.welcomeMessage ?? undefined,
        quickActions: data.quickActions?.split("|").map((x) => x.trim()),
        customerEmail: data.customerEmail,
        // GDPR: explicit data-privacy-url wins; else the tenant privacy policy
        // from widget-config; else a sensible default on the store site.
        privacyUrl:
          data.privacyUrl ??
          remote.privacyPolicyUrl ??
          (remote.storeUrl ? `${remote.storeUrl.replace(/\/+$/, "")}/privacy-policy/` : undefined),
      };
      createRoot(mount).render(<Widget config={config} />);
    })
    .catch((error) => {
      console.error(error);
      mount.textContent = "The chat assistant is temporarily unavailable.";
      mount.style.cssText = "position:fixed;bottom:24px;right:24px;padding:12px 16px;background:#fff;border:1px solid #e8e1d4;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.15);font:14px system-ui,sans-serif;color:#1f1a14;z-index:2147483000";
    });
}

const bootScript = scriptElement();
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => init(bootScript), { once: true });
} else {
  init(bootScript);
}
