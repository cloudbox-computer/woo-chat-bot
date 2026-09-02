/// <reference types="vite/client" />

// Environment config for the dashboard app. The Supabase anon key is public —
// it is safe to commit. Override via VITE_* env vars for other projects.
const env = import.meta.env ?? {};

export const SUPABASE_URL: string =
  (env.VITE_SUPABASE_URL as string | undefined) ?? "https://xsegdfcqqktxoqlbazpl.supabase.co";

export const SUPABASE_ANON_KEY: string =
  (env.VITE_SUPABASE_ANON_KEY as string | undefined) ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhzZWdkZmNxcWt0eG9xbGJhenBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMzIzNjIsImV4cCI6MjEwMTgwODM2Mn0.sYZ4DchDZL9RefAyrDBs-L5ChJKMAFqNJ3XbDlbjLy8";

/** Edge function base URL (public endpoint, CORS enabled). */
export const FUNCTIONS_URL: string =
  (env.VITE_FUNCTIONS_URL as string | undefined) ??
  `${SUPABASE_URL}/functions/v1`;
