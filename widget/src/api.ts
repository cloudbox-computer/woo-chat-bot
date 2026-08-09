export interface WidgetConfig {
  chatbotId: string;
  apiUrl: string;
  brandColour?: string;
  title?: string;
  subtitle?: string;
  customerEmail?: string;
}

export interface Product {
  id: string | number;
  name: string;
  price: number;
  currency?: string;
  description?: string;
  url?: string;
  imageUrl?: string;
  inStock?: boolean;
  attributes?: Record<string, string>;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  products?: Product[];
}

export const QUICK_ACTIONS: Array<{ label: string; prompt: string }> = [
  { label: "Track my order", prompt: "Where is my order #4821? My email is {email}" },
  { label: "Gold necklaces under £100", prompt: "Do you have any gold necklaces under £100?" },
  { label: "Returns policy", prompt: "What is your returns policy?" },
  { label: "Gift ideas", prompt: "I need a gift for my wife, budget £150" },
];

interface ChatResponse {
  reply: string;
  conversationId: string;
  products?: Product[];
}

async function post<T>(config: WidgetConfig, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${config.apiUrl.replace(/\/+$/, "")}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text.slice(0, 200) || `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export async function sendChat(
  config: WidgetConfig,
  message: string,
  conversationId?: string,
): Promise<ChatResponse> {
  return post<ChatResponse>(config, "/chat", {
    chatbotId: config.chatbotId,
    message,
    conversationId,
    customerEmail: config.customerEmail,
  });
}

export async function sendFeedback(
  config: WidgetConfig,
  conversationId: string,
  rating: 1 | -1,
): Promise<void> {
  await post(config, "/feedback", { conversationId, rating });
}
