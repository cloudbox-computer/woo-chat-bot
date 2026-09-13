# Chat tracing and timeout hardening — 2026-09-13

This release adds production-safe request tracing for the public chat pipeline without logging customer message contents, OAuth tokens, connector credentials, or full connector URLs/query strings.

## Added tracing

- `chat:*` stages: request start/body, rate limit, controls, quota, request log, conversation verification/control, agent, usage finalization, signing, completion.
- `agent:*` stages: assistant/tenant resolution, topic gate, runtime actions, conversation/history, knowledge, AI turns, tool execution, completion.
- `ai:*` stages: provider request start/done/error/timeout with model/provider and elapsed time.
- `connector:*` stages: approved action start, safe endpoint path, upstream status, duration, timeout/error, final action result.

## Timeout hardening

- AI HTTP calls now abort after 18 seconds instead of waiting indefinitely.
- Connector calls retain the existing 12-second abort but now emit explicit timeout logs.
- Chat responses include `X-Request-Id` and successful responses include `Server-Timing`.

## Small latency improvement

Monthly conversation-count and usage quota lookups now run in parallel rather than sequentially.

No database migration is required.
