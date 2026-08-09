// Bun-only fallback runner for the smoke tests (used when Deno isn't installed).
// Provides the tiny `Deno` global the tests reference, then runs tests/smoke.ts.
(globalThis as Record<string, unknown>).Deno = {
  exit(code: number) {
    process.exit(code);
  },
};
await import("../tests/smoke.ts");
