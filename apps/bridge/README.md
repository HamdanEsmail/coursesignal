# CourseSignal bridge

This process connects Photon Spectrum Cloud to CourseSignal's evidence policy. CourseSignal is a general student-life copilot specialized in course concepts, campus services and events, textbooks and legitimate resources, scholarships and opportunities, deadlines, and broader student research. It has no webhook or message-ingress HTTP route and never puts Photon or TinyFish credentials in browser code. An optional, read-only `/healthz` listener is available for an always-on container.

## Message lifecycle

1. Photon messages are converted to opaque HMAC keys before logging or persistence.
2. A durable claim suppresses delivery retries. Failed work releases its claim; completed work remains deduplicated.
3. New conversations must send `START` before any user text reaches TinyFish.
4. Short text bursts from one conversation are debounced into one request. Work remains serial within that conversation, while different conversations can progress concurrently.
5. Research sends an immediate acknowledgement, then TinyFish Search and Fetch. Short follow-ups stay on the last topic; a new question replaces it. Fetch requests up to three query-ranked Highlights capped at 700 characters; when Highlights explicitly returns `403` or an unsupported-feature response, the bridge makes one ordinary full-page Fetch compatibility call. If the student asked for an example and those pages contain none, the bridge makes one extra Search and Fetch for a worked problem. Interactive-page TinyFish Agent is an optional, bounded read-only escalation only when Fetch produced no readable evidence. A separately gated OpenRouter composer may turn the already-fetched evidence into one tutor-style answer; malformed, expensive, unsupported, off-topic, or failed synthesis falls back to the local extractive answer. OpenRouter is still called at most once.
6. A dropped Photon stream reconnects with exponential backoff. SIGINT/SIGTERM stop intake, drain in-flight work, flush state, and close Spectrum.

`ECHO`, `PING`, `STATUS`, `TEST`, and `HEALTH` are local diagnostics. They are available before consent and never invoke TinyFish.

## Commands

- `START` — grant consent for public-web research and per-chat course memory.
- `COURSE <name>` — remember and select a course.
- `COURSE LIST`, `COURSE USE <name>`, `COURSE REMOVE <name>` — manage explicit course context.
- `SOURCES` — show the latest evidence receipt without another provider call.
- `PLAN [goal]` — create a source-linked study plan.
- `WATCH [source or topic]` — save an opt-in watch preference.
- `STOP` — pause all proactive watches.
- `MEMORY` — show the bounded state retained for this chat.
- `EXAMPLE` — look again for a worked problem on the last topic.
- `FORGET`, then `FORGET CONFIRM` — erase course state, receipts, watches, and consent.

At the Photon edge, only genuine inbound human text is admitted. Outbound echoes, read/delivery receipts, typing, reactions, system/service events, group changes, attachments, and malformed/no-sender records are silently ignored so provider events can never create a reply loop. The transport-neutral core still returns a safe text-only explanation when another trusted adapter deliberately passes unsupported content. Nothing non-text is uploaded or analyzed.

## Configuration

`src/imessage.ts` loads the Git-ignored repository-root `.env.local` with Node's `process.loadEnvFile`. Existing process environment variables retain precedence. Required runtime variables are `SPECTRUM_PROJECT_ID`, `SPECTRUM_PROJECT_SECRET`, and `TINYFISH_API_KEY`. Supply them through the host or deployment platform's secret manager; never bake them into an image or commit an environment file. `OPENROUTER_API_KEY` is optional and follows the same server-only rule; it is never read by the web app.

Useful optional variables:

- `COURSESIGNAL_STATE_SECRET` — independent HMAC secret; defaults to the Photon project secret.
- `COURSESIGNAL_STORE` — durable state backend. Defaults to `json`; `supabase` is the only remote option and must be selected explicitly.
- `COURSESIGNAL_STATE_PATH` — absolute path, or path relative to the repository root.
- `COURSESIGNAL_DEBOUNCE_MS` — message-burst window; default `300`.
- `COURSESIGNAL_TIME_ZONE` — receipt display zone; default `Asia/Dubai`.
- `COURSESIGNAL_HEALTH_PORT` — enables `/healthz` on this port. Falls back to a platform-provided `PORT`; with neither value, HTTP stays disabled.
- `COURSESIGNAL_HEALTH_HOST` — bind address when health is enabled; default `0.0.0.0`.
- `TINYFISH_AGENT_ENABLED` — must be exactly `true` to permit interactive-page extraction when Fetch cannot read a page; default is disabled.
- `TINYFISH_AGENT_MAX_STEPS` — interactive-page extraction, clamped to `1..12`; default `8`.
- `TINYFISH_AGENT_MAX_SECONDS` — interactive-page extraction, clamped to `10..90`; default `45`.
- `OPENROUTER_ENABLED` — must be exactly `true` to permit optional answer composition; default is disabled. This flag is independent of `TINYFISH_AGENT_ENABLED`.
- `OPENROUTER_API_KEY` — server-only key for CourseSignal's bounded composer. Use a dedicated key with an account-side spending limit; never reuse or expose it in browser code.

### Supabase durable state

`COURSESIGNAL_STORE=supabase` replaces only the bridge's JSON consent/course/latest-receipt state and leased inbound-event claims. The adapter maps the already-HMACed conversation key into the existing `principals` and `conversations` tables. It rejects non-HMAC event/conversation identifiers and persists only the same bounded `ConversationMemory` already retained by the JSON store; raw Photon transport payloads and credentials are not accepted.

Before enabling it, apply every checked-in migration in `supabase/migrations` to the target Supabase project, then provide both values through the bridge host's secret manager:

- `SUPABASE_URL` — the project URL.
- `SUPABASE_SERVICE_ROLE_KEY` — the server-only service-role key. Never prefix it with `VITE_`, expose it to `apps/web`, commit it, or use it from a browser.

If either value is missing or `COURSESIGNAL_STORE` has an unknown value, startup fails closed. There is no automatic fallback from a requested Supabase backend to a local file. With `COURSESIGNAL_STORE` unset or set to `json`, the existing `JsonFileBridgeStore` and `COURSESIGNAL_STATE_PATH` behavior are unchanged.

The same adapter exposes enqueue, claim, sent, and uncertain operations over the existing normalized `outbox_messages` table; no parallel bridge queue is created. A separate Spectrum delivery worker still needs provider-supported conversation reopening plus stable logical reply keys before delayed outbox delivery can be enabled. Until that worker is wired and tested, the current live Spectrum handler continues to send replies through the active conversation port.

## Bounded answer composition

The default retrieval path remains TinyFish Search → TinyFish Fetch Highlights. Ranked Highlight passages are kept verbatim apart from whitespace compaction and the documented 700-character cap, so the composer sees the most relevant fetched evidence rather than navigation-heavy full pages. TinyFish SDK transport retries are disabled; only the single explicit Highlights-compatibility fallback described above is allowed. When OpenRouter composition is explicitly enabled, the bridge makes at most one completion attempt with these immutable choices:

- Model: `google/gemma-4-26b-a4b-it`.
- Provider: `nextbit/bf16` only.
- Provider fallbacks: disabled.
- Completion timeout: 55 seconds; automatic retries: none.
- Output limit: 600 tokens and a strict JSON Schema.
- Rate ceilings: $0.10 input and $0.40 output per million tokens.

Before inference, CourseSignal reads OpenRouter's endpoint metadata and fails closed unless the exact model/provider supports JSON Schema structured output and remains under both rate ceilings. A successful proof is cached in memory for at most six hours; the completion request still carries the verified `max_price`, exact provider allowlist, `require_parameters`, zero-data-retention, and data-collection-denial constraints.

The composer receives only the current sanitized question, its broad student-intent category, and at most three 700-character evidence excerpts produced by TinyFish Fetch. A short follow-up’s question may already include the topic of the last answer; that is not the earlier transcript. It does not receive the Photon sender, phone number, conversation identifier, saved course memory, prior messages, source URLs, credentials, or TinyFish Agent output. Email addresses, phone-like strings, student-ID patterns, and URLs are redacted from the prompt.

Every composed explanation and takeaway is a claim-local evidence block containing its text, one allowed source ID, and a short exact support quotation; a worked example is either the same complete block or `null`. This wire shape deliberately avoids parallel claim and quotation arrays, so the JSON grammar cannot pair a null example with an orphan example quote or omit the takeaway's support. The server maps valid blocks back to the existing public answer type, verifies each quotation against the mapped TinyFish evidence, and requires semantic term overlap between each claim and quote. For that overlap only, conventional probability notation is interpreted narrowly (`Pr`/`P` as probability, `∩` as intersection, `/` as division, and `|` as given/conditional); the quote must still occur exactly in the evidence and all other grounding checks still apply. The validator rejects invented numeric/date/currency tokens, checks requested-component gaps against source evidence rather than model prose, and then hides the quotations from the short iMessage answer. Output is accepted only when every key, type, field length, source ID, support quote, and `actionTaken: false` invariant matches the local contract. URLs, email addresses, phone numbers, bare domains, instruction-like text, external-action claims, unexpected fields, malformed JSON, partial responses, tool calls, cache hits, timeouts, metadata drift, and provider errors are rejected.

The request explicitly disables OpenRouter's `web`, `response-healing`, `context-compression`, `fusion`, and `auto-router` plugins and sends `X-OpenRouter-Cache: false`. The response is rejected if it reports a cache hit or tool call. Before deployment, the dedicated OpenRouter workspace must also have every default plugin off with no administrator-enforced override, logging disabled, ZDR/guardrails enabled, and a spending cap; request-level settings cannot overrule an administrator-forced default.

OpenRouter is therefore a presentation layer, not the evidence source or browser automation engine. TinyFish Agent remains reserved for genuinely interactive public pages that Search + Fetch cannot read. If OpenRouter is disabled or rejects a response, CourseSignal sends its existing concise extractive answer from the same TinyFish evidence.

Consent is versioned. Conversations that accepted the earlier TinyFish-only disclosure must send `START` again before the current multi-provider research path can run; their existing course memory is preserved during renewal.

With the default JSON backend, the state file lives under Git-ignored `private-handoff/` and includes an opaque project-derived suffix, so terminal/dev and separate Photon projects cannot silently share consent. The Supabase backend stores the same bounded runtime memory as JSON, uses token-protected five-minute inbound leases, and makes completed opaque event claims eligible for bounded opportunistic cleanup after seven days. Configure a scheduled database purge as well if the deployment requires cleanup to continue during periods with no inbound traffic.

## Health endpoint

The optional server implements only `GET /healthz` and `HEAD /healthz`. Every other path returns `404`; every other method returns `405`. It is not a Photon webhook and cannot receive messages.

The JSON response contains only:

- Service name.
- Coarse state: `ok`, `degraded`, or `stopping`.
- Photon transport state.
- Whether the process is currently accepting messages.
- Process uptime rounded down to seconds.

It never returns message contents, identifiers, source URLs, environment values, project details, credentials, budget data, or error text. Temporary Photon reconnects report `degraded` but retain HTTP `200`, allowing the process's internal backoff loop to recover instead of triggering a container restart storm.

## Container deployment

Build from the repository root so the workspace lockfile and local packages are available:

```powershell
docker build --file apps/bridge/Dockerfile --tag coursesignal-bridge .
```

`Dockerfile.dockerignore` is colocated with the Dockerfile for root-context builds; `apps/bridge/.dockerignore` provides the equivalent exclusions for bridge-local tooling. Both exclude environment files, local state, logs, test output, and dependencies from the build context. The Dockerfile copies only explicit manifests and bridge/runtime package source.

Run with secrets from a protected external environment file or the platform's secret manager—not literal values in shell history:

```powershell
docker run --detach --name coursesignal-bridge `
  --env-file C:\secure\coursesignal.env `
  --mount source=coursesignal-state,target=/data `
  --publish 127.0.0.1:8787:8787 `
  coursesignal-bridge
```

The image defaults to `/data/bridge-state.json`, health port `8787`, a non-root `node` user, `SIGTERM` shutdown, and a Docker health check. Keep the health port private to the platform or bind it to loopback unless an external load balancer must probe it.

Deployment constraints:

- Use an always-on Node 24 container or VM. A request-only function, scale-to-zero service, or Cloudflare Worker cannot own Photon's long-lived outbound Spectrum connection.
- Allow outbound DNS, HTTPS, and Photon gRPC/HTTP2 traffic. No inbound Photon webhook port is required.
- Run one active bridge replica per Photon project while using the file store. Supabase supplies shared transactional claims/state, but Photon connection ownership and delayed outbox delivery still require an explicit single-owner/worker design; a shared volume alone is never sufficient.
- Mount persistent storage at `/data`, or set `COURSESIGNAL_STATE_PATH` to another durable writable path. Ephemeral state loses consent, course context, watch preferences, and completed-event deduplication on replacement.
- Give `SIGTERM` enough grace time for in-flight research to finish and the bridge to drain; allow at least the configured TinyFish timeout plus a small shutdown margin.
- Keep `TINYFISH_AGENT_ENABLED` and `OPENROUTER_ENABLED` unset/false until their separate deployment budgets are approved. Enabling one never enables the other.
- Do not expose another HTTP route from this process. Product pages, evidence receipts, webhooks, and administrative controls belong in separate services.

## Verification

```powershell
npm run typecheck --workspace @coursesignal/bridge
npm run test --workspace @coursesignal/bridge
```

The unit suite uses fake TinyFish, Agent, metadata, and completion transports. It never creates a live paid Agent or OpenRouter run.
