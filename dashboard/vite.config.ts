import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Tenant dashboard (convo3.md). App URL: https://xsegdfcqqktxoqlbazpl.supabase.co/functions/v1/dashboard
// (deployed as a static site on your host — see README). In dev it proxies the
// edge functions to avoid CORS issues.
export default defineConfig({
  plugins: [react()],
  define: {
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "development"),
  },
  server: {
    port: 5174,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2020",
  },
});
