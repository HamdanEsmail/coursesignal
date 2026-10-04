# CourseSignal

CourseSignal is an evidence-first student copilot that lives in iMessage. A student can send a public syllabus, course question, textbook request, campus-service question, scholarship query, event search, or deadline to verify; CourseSignal checks live sources and replies with a concise answer whose important claims have receipts.

## Product boundary

The iMessage conversation is the product. The companion web app is a receipt and control surface for evidence, explicit student memory, opt-in watches, privacy, and deletion. It is not a second chatbot.

CourseSignal may explain concepts, reconcile public course sources, find legitimate materials, and propose study plans. It never logs into an LMS, takes assessments, submits coursework, makes purchases, or contacts another person without a separate explicit confirmation.

Its answer pipeline keeps responsibilities explicit: TinyFish Search and Fetch find and verify public evidence; an optional fixed OpenRouter/Gemma composer turns only that bounded evidence into a short student-friendly explanation; TinyFish Agent is reserved for genuinely interactive pages. The extractive TinyFish answer remains the safe fallback whenever composition is disabled or cannot be verified.

## Repository layout

- `apps/bridge` — the Node.js Photon Spectrum process and local terminal proof.
- `apps/web` — the responsive evidence-receipt interface.
- `packages/contracts` — shared, runtime-validated product contracts.
- `packages/tinyfish` — the provider transport boundary (added after the proof is stable).
- `packages/provider-control` — metering, reservation, retry, and idempotency controls.
- `design/concepts` — accepted visual specifications generated for this project.

The production split and release order are documented in [`docs/deployment.md`](docs/deployment.md). The public companion is at [coursesignal-bzb.pages.dev](https://coursesignal-bzb.pages.dev/). It is a fixture receipt and control surface, not a second chatbot.

## Local checks

```powershell
npm install
npm run check
```

The non-network echo proof is:

```powershell
npm run proof:echo
```

The TinyFish proof deliberately reads `TINYFISH_API_KEY` only from the server process:

```powershell
$env:TINYFISH_API_KEY = [Environment]::GetEnvironmentVariable('TINYFISH_API_KEY', 'User')
npm run proof:research -- "Explain conditional probability using reliable university sources"
```

No populated `.env` file, phone number, provider credential, or private conversation belongs in Git.
