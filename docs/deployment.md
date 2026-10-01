# Deployment map

CourseSignal uses three deliberately separate cloud jobs. Keeping them separate prevents the public website from receiving messaging or provider credentials.

| Job | Service | What it owns |
| --- | --- | --- |
| iMessage worker | One always-on Node 24 container or VM | Photon Spectrum connection, inbound handling, TinyFish research, optional Gemma composition, and replies |
| Durable control plane | Supabase Postgres | Consent, opaque conversation state, duplicate claims, evidence, watches, budgets, and the canonical outbox |
| Companion website | Cloudflare Pages | Sanitized receipts, watch and memory controls, reviewer instructions, and privacy explanations |

Cloudflare Pages and request-only functions must not host the Photon bridge. Spectrum needs one continuously running owner with graceful reconnect and shutdown behavior.

## Release order

1. Run `npm run check` and keep the real provider flags off.
2. Create a dedicated Supabase project in the intended region.
3. Apply every SQL file in `supabase/migrations` in filename order.
4. Put `COURSESIGNAL_STORE=supabase`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` only in the bridge host's secret manager.
5. Deploy exactly one bridge replica with persistent storage and a private `/healthz` check.
6. Prove restart recovery, duplicate suppression, renewed consent, `FORGET`, and a fresh iPhone round trip.
7. Build the companion with `npm run build --workspace @coursesignal/web`.
8. Publish `apps/web/dist` to the `coursesignal` Cloudflare Pages project. `npm run deploy:web` is the pinned manual direct-upload command.
9. Replace the clearly labelled fixture receipt with a sanitized receipt from the same real demonstration run before submission.
10. Time-box one judge identity in Photon, verify the live loop, and remove that access after review.

## Secret boundary

The web build must never receive Photon, TinyFish, OpenRouter, Supabase service-role, database-password, or HMAC secrets. In particular, do not create `VITE_` variables for them. Only sanitized receipt data may cross into the browser.

## Public-release boundary

Creating the cloud projects, publishing the site, publishing the source repository, enabling judge access, and submitting the bounty are external actions. Prepare them in advance, then perform them only as an explicit release step.
