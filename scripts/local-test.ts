// Local test runner: executes the end-to-end smoke test.
// Prefers Deno (as the Edge Functions runtime), falls back to Bun if Deno
// isn't installed (scripts/run-smoke-bun.ts provides the tiny Deno shim).
// Usage: bun run test   (or: deno run --allow-all tests/smoke.ts)
import { spawnSync } from "node:child_process";

const hasDeno = spawnSync("deno", ["--version"], { stdio: "ignore" }).status === 0;

const cmd = hasDeno
  ? ["deno", "run", "--allow-all", "tests/smoke.ts"]
  : ["bun", "scripts/run-smoke-bun.ts"];

const proc = Bun.spawn(cmd, {
  stdout: "inherit",
  stderr: "inherit",
  cwd: import.meta.dir + "/..",
});
const code = await proc.exited;
process.exit(code);
