# Review plan (October 2026)

Findings from a four-pass code review ahead of the TinyFish student bounty submission. Each item was traced or reproduced against the code unless marked PLAUSIBLE. Priorities: P0 blocks a good review, P1 is a confirmed stability or correctness bug, P2 is presentation and cleanup.

Decisions already taken:

- Collapse the `LODGE_MODE` split. TinyFish Search/Fetch, the roles finder, and page watches are always wired. Only the Gemma composer stays behind `OPENROUTER_ENABLED` plus a key.
- Make the README reviewer-first: bash commands, any browser, a quick-start at the top.
- Work lands on `claude/review-hardening` and is reviewed through one pull request.

## Done on this branch

- Node 24 pinned (`.nvmrc`, README). CI and the bridge image already used it.
- PGlite migration suite given a 60 s timeout; the WASM cold start alone exceeded the 5 s default.
- `reconnect.ts`: abort listener removed when `abortableSleep` resolves.
- `imessage.ts`: unhandled rejections and uncaught exceptions log, drain, and hard-exit after 15 s.
- `apps/web/functions/add.ics.js` removed. Pages ignores `functions/` when `_worker.js` exists, and the copy had drifted.
- Opt-in `deploy-web` job publishes to the `coursesignal` Pages project once `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets exist.

## P0

### 1. Default mode cannot run the scripted reviewer asks (effort M)

`scheduler.ts` `createLodgeBridgeStack` builds the default bridge without a TinyFish port, roles finder, `fetchReadable`, or roles watch. The landing page (`apps/web/src/data/fixtures.ts`, `day.ts`) and README script "what's due this week", "any internships in Dubai", and "what does this application ask?", none of which reach TinyFish in that mode. `tools.ts` returns `tinyfish_not_wired` for `whats_due`, and `find_roles` has no finder.

Plan:

- Delete `isLodgeModeEnabled` and the `lodgeMode` branch. Always construct `createLodgeTinyFishPort()`, the roles finder, `fetchReadable`, and `runRolesWatch`.
- Gate only `createAgent` (Gemma) on `OPENROUTER_ENABLED` and `OPENROUTER_API_KEY`. The existing `research.ts` path is the no-Gemma fallback.
- Remove `LODGE_MODE` from `.env.example`, `apps/bridge/README.md`, `docs/deployment.md`.
- Test: `apps/bridge/src/stack.default.test.ts` builds the stack with a mock TinyFish and no OpenRouter env, then asserts "what's due this week" calls `tinyfish.fetch` and "any internships in Dubai" calls `tinyfish.search`.

### 2. README phrases parse to the wrong command (effort S)

Verified with `parseCommand`:

| Text | Today | Expected |
| --- | --- | --- |
| `What’s due this week?` (iPhone curly apostrophe) | `research` | `whats_due` |
| `remind me Friday 5` (README example) | `when: "in 5 minutes"` | Friday 17:00 |
| `save the week` (README and day demo) | `research` | save-week command |
| `remind me at 5`, `tomorrow 9`, `snooze 2` | `Date.parse` yields May/September/February 2001, fires at once | clock parse |

Plan:

- Normalise `’` to `'` at the top of `parseCommand` (`commands.ts`).
- In `tools.ts` reminder parsing, run `parseClock` before `Date.parse`, only call `Date.parse` for ISO-looking input, and reject times in the past.
- Fix the "remind me <day> <hour>" grammar.
- Test: `apps/bridge/src/commands.docs.test.ts`, table-driven from every phrase in the README "What a student can text" section plus the `you`/`asked` strings in `day.ts` and `fixtures.ts`, in curly and straight forms.

### 3. Nothing runs without a TinyFish key (effort S–M)

`createTinyFishResearchService()` is called eagerly from `createLodgeBridgeStack`, so `npm run terminal` throws `TINYFISH_API_KEY is not configured` even for START, notes, and reminders. `npm run proof:echo` prints one string and exercises nothing. `docs/architecture.md` calls the terminal proof credentialless.

Plan:

- Construct the research service lazily on first research turn; reply with a clear "no TinyFish key configured" message instead of crashing.
- Add `npm run demo`: the terminal on an in-memory store using `createMockTinyFish` and `createMockGemma` from `eval.ts` with fixture pages for a syllabus and a listings page.
- Test: `apps/bridge/src/stack.nocreds.test.ts` deletes `TINYFISH_API_KEY`, builds the stack, and asserts START, note, and remind each produce one reply.

## P1

### 4. Reminders and proactive texts are lost after any reconnect or restart (effort M)

- `imessage.ts` calls `spaces.forgetAllLive()` on every connect.
- `space-registry.ts` `reopenFromSpectrumClient` probes `getSpace`, `openSpace`, `spaceById`, `reopen`. None exist on `SpectrumInstance` in `spectrum-ts` 12.10.1 (`@spectrum-ts/core` types expose `messages`, `stop`, `send`, `edit`, `responding`). Production always gets `setReopen(undefined)`. The test "uses getSpace on the existing client" passes only against a fake.
- `scheduler.ts` marks a reminder `fired` at enqueue, not after `markOutboxSent`. `MemoryOutboxStore.claimOutbox` counts every `SPACE_UNAVAILABLE` park as an attempt, so a row dies after 20 ticks (about ten minutes). The outbox is in-process with the JSON store, so a restart loses it.

Plan:

- Implement reopen with the real SDK surface (verify `space.get(id)` against Photon docs).
- Do not count `SPACE_UNAVAILABLE` toward attempts.
- Set `fired` only after `markOutboxSent`; logical-key dedup already prevents double enqueue.
- Persist the outbox inside the JSON store's `PersistedState`.
- On a conversation going live, re-run `#enqueueForConversation`.
- Test: `apps/bridge/src/scheduler.reconnect.test.ts` parks for 25 ticks, goes live, asserts exactly one delivery and `scheduled` until sent.

### 5. Supabase backend never delivers proactive texts (effort S)

`claim_outbox_messages` (`supabase/migrations/20261001000100_coursesignal_core.sql`) returns `conversation_id` as the `conversations.id` UUID. `scheduler.ts` `#deliver` passes it to `store.getConversation`, which requires a 64-hex opaque key and throws. The whole tick fails every 30 s and rows burn attempts.

Plan: return `conversations.provider_conversation_ref_hash` from the RPC (or add `conversation_key` to `OutboxClaim`) and map it. Test: drive `LodgeScheduler` through `SupabaseBridgeStore` with a fake RPC client.

### 6. Lost updates and a FORGET race (effort M)

`#scanAndEnqueue` reads memory, awaits TinyFish fetches (up to 20 links at 45 s each, plus the roles watch), then writes the stale snapshot with `putConversation`. Reproduced: a note added mid-fetch is erased; `FORGET CONFIRM` during a roles watch is undone and consent returns. Same pattern in `tools.ts` `whats_due` and `handler.ts` `#runResearch`. `SpaceRegistry.#persistHandle` does get-then-put for every Photon event, including ignored echoes, before the human filter runs.

Plan:

- Add `updateConversation(key, mutator)` to `BridgeStore`. JSON store re-reads inside `#mutate`; Supabase uses a version check. The mutator is a no-op when the conversation was deleted.
- Do network calls before the mutator, never inside it.
- Register the live space only after `filterHumanIMessage` accepts the event.
- Test: `apps/bridge/src/scheduler.forget-race.test.ts`.

### 7. Reply ordering and failure handling in the handler (effort S–M)

- `#runResearch` persists before sending; a store failure after a paid TinyFish call yields "I could not verify that from live sources".
- The merged-burst path (`handler.ts` around line 201) has no try/catch: one research call, zero replies, both claims released, so redelivery pays again.
- A Photon send failure on the second bubble is swallowed and the event is marked complete.
- `#emitTool` reports store-cap errors on note or remind as "A TinyFish check failed".
- `#consume` reads the conversation outside its try, so a corrupt state file means no reply at all.
- `reconnect.ts` registers the abort listener only after `connect()` resolves; SIGTERM during connect hangs until the next message.
- `reconnect.ts` awaits all in-flight handlers before reconnecting, so a long turn keeps the bridge disconnected.

Plan: send first, persist best-effort with a log (as `#runAgent` does); wrap the merged path; distinguish "work done, send failed" (complete claim, log `reply.uncertain`) from "work not done" (release); honest error copy; check `signal.aborted` right after connect; keep the in-flight set at outer scope and only await it on shutdown with a 15 s cap. Test: `apps/bridge/src/handler.failures.test.ts` and new cases in `reconnect.test.ts`.

### 8. ICS correctness in `apps/web/src/lib/calendar.ts` (effort S)

- `allday=1` with a datetime start emits `DTSTART:…T080000Z` with `DTEND;VALUE=DATE`, mixed value types (live on the site).
- `+04:00` offsets are accepted but emitted as floating local time.
- A lone `\r` is not escaped, allowing property injection (`title=Meeting%0DATTENDEE:…`). Same gap in the bridge copy.
- `foldLine` folds by UTF-16 code units, splitting surrogate pairs and exceeding 75 octets for non-ASCII. The bridge's `foldIcsLine` already does it correctly.

Plan: coerce start and end to date stamps when `allDay`; convert offsets to UTC or reject; strip `[\r\n\u0000-\u001f]` from every text field; fold by `TextEncoder` octets. Add cases to `calendar.test.ts`.

### 9. No per-conversation spend cap and no turn deadline (effort S–M)

The bridge uses nothing from `packages/provider-control` except `shouldDeliverWatch`. A judge number can drive unlimited TinyFish and OpenRouter spend. Worst-case turn (search, fetch, example retry, agent, metadata, compose) approaches the 5-minute claim lease, and `withTimeout` does not abort the underlying request.

Plan: per-conversation budget via `reserveBudget`/`consumeBudget` (for example 20 research turns per hour, 3 Agent runs per day) with a friendly reply; one 90 s `AbortSignal` per turn threaded into the provider calls. Test: `apps/bridge/src/research.budget.test.ts`.

### 10. Scheduler tick structure (effort M)

One serial tick runs the slow scan (page fetches, roles watch) before delivery, so a due reminder waits behind every fetch. `stop()` does not await the in-flight tick while `imessage.ts` drains and closes the store. `MemoryOutboxStore` never prunes sent rows.

Plan: a fast delivery loop and a separate watch loop with a per-tick budget (5 fetches, concurrency 2); prune sent rows after 24 h; `stop()` returns and awaits the tick promise before `drain()`.

### 11. Docs and naming (effort M)

- README now says Lodge; the package, workspaces, env vars, health `service` name, and 44 files say CourseSignal. Add one line: "repo and env prefix are CourseSignal, product is Lodge".
- `apps/bridge/README.md` documents `COURSE <name>`, `COURSE LIST/USE/REMOVE`, and `EXAMPLE`, which do not exist as commands. Regenerate the list from `HELP_REPLY`.
- `docs/product.md`, `docs/architecture.md`, and `docs/deployment.md` describe the earlier receipts product and claim a wired budget control plane and outbox. Fold into the README or rewrite.
- README describes `packages/tinyfish` as the transport, but no app imports it, and `provider-control` as metering, but only quiet-hours logic is used.
- Replace PowerShell blocks with bash and add a "For reviewers (5 minutes)" section: demo link, what to text, `npm ci && npm run check && npm run demo`, and a TinyFish usage map with file references for Search, Fetch, and Agent.
- Remove the output rewrite hacks in `handler.ts` (CourseSignal to Lodge, "STAT 210" to "your course") and the prompt line in `openrouter.ts`.

## P2

- Delete `design/concepts/` (4.7 MB of old dashboard PNGs) and `artifacts/screenshots/coursesignal-*`.
- Delete unused code: `apps/web/src/components/PhoneReplay.tsx`, `Ledger.tsx`, `apps/bridge/src/bootstrap.ts` (move its tests onto `createLodgeBridgeStack`), `replyForText`, and the test-only exports `LODGE_MODE_DEFAULT`, `lodgeToolList`, `CHECK_IN_STEPS`, `LODGE_EVENT_QUERY_KEYS`, `createRolesFinder`, `TINYFISH_DESK`, `namedSlipLink`, `parseSlipQuery` (bridge), `buildIcsBody`, `parseLodgeEventQuery`, `buildLodgeWeekIcsUrl`, `isLodgeEventQueryKey`. Verify each with grep before removal.
- `tools/pages-direct-upload.mjs` hardcodes the account ID and duplicates wrangler and the CI job; remove it and its test from root `npm test`.
- Move the slip and calendar query encode/parse rules into `packages/contracts`; keep ICS rendering only in `apps/web`; delete `apps/bridge/src/calendar.ts`. Add a round-trip test from bridge encoder to web parser.
- `eval.ts` "offline Gemma gate" compares a regex against itself. Rename it an agent-loop contract test and add an opt-in `npm run eval:live`.
- Container: `CMD ["node","--import","tsx","apps/bridge/src/imessage.ts"]` with `--init` so SIGTERM reaches the process directly; fsync the JSON temp file before rename; quarantine a corrupt state file instead of failing every message; report `degraded` in `/healthz` on store errors.
- Extract `runIMessageBridge(deps)` from `imessage.ts` so the crash handlers, reconnect wiring, and shutdown order get tests.

## Suggested order

1. Items 1, 2, 3 together (one PR section): they make the reviewer path work and expose items 4–7 by default.
2. Items 5, 7, 8 (small, confirmed, each with a test).
3. Items 4, 6, 10 (scheduler and store rework, one design).
4. Item 9, then item 11 docs, then P2 cleanup.
