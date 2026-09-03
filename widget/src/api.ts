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


interface ChatResponse {
  reply: string;
  conversationId: string;
  conversationToken?: string;
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
  conversationToken?: string,
): Promise<ChatResponse> {
  return post<ChatResponse>(config, "/chat", {
    chatbotId: config.chatbotId,
    message,
    conversationId,
    conversationToken,
    customerEmail: config.customerEmail,
  });
}

export async function sendFeedback(
  config: WidgetConfig,
  conversationId: string,
  rating: 1 | -1,
  conversationToken?: string,
): Promise<void> {
  await post(config, "/feedback", { chatbotId: config.chatbotId, conversationId, conversationToken, rating });
}
