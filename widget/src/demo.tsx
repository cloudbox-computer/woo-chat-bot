import { mountWidget } from "./widget";

// Dev/demo entry — mirrors what the embed does, but with an explicit config
// so `bun dev` shows the widget instantly against a local or remote API.
mountWidget(document.getElementById("root")!, {
  chatbotId: "ivy-pearls",
  apiUrl: import.meta.env.VITE_API_URL ?? "http://localhost:54321/functions/v1",
  brandColour: "#9c7b4f",
  title: "Ivy & Pearls",
  subtitle: "Hi! I can help you find jewellery, check an order, or recommend a gift. What are you looking for?",
});
