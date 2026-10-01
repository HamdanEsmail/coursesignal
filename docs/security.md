# Security posture

CourseSignal processes messaging identifiers and user-authored course questions, so its default posture is minimum collection and short retention.

## Trust boundaries

- Photon transports iMessage content to the Node bridge. The product must not describe the complete path as Apple end-to-end encrypted.
- The bridge stores no TinyFish key in browser code and never writes phone numbers or full message bodies to structured logs.
- TinyFish receives only the public URL and minimum research question required for the run.
- Public receipts are sanitized and disabled by default. Provider viewer URLs and secrets are never persisted in receipts.
- Consequential actions—submitting, purchasing, reserving, enrolling, or contacting someone—are outside the bounty MVP.

## Dependency audit

The October 1, 2026 install reports no high or critical advisories. It reports moderate advisories in OpenTelemetry packages pulled through Photon `spectrum-ts@12.10.1`. The registry's suggested automatic repair incorrectly points to an old Spectrum major and would break the current provider contract, so it is not applied blindly.

Until Photon updates the affected transitive exporter set:

- the first bridge exposes no public HTTP listener;
- untrusted W3C baggage headers are not accepted or forwarded by CourseSignal;
- CI fails on newly introduced high or critical production advisories;
- the audit is rechecked before any public deployment;
- the provider runtime remains isolated from the web frontend and control-plane secrets.

## Secret rules

- `.env` and every populated environment variant are Git-ignored.
- `SPECTRUM_PROJECT_SECRET` and `TINYFISH_API_KEY` are server-only.
- Phone numbers and OTP codes must be entered directly into Photon, never chat, source, fixtures, screenshots, or logs.
- Live-provider tests are opt-in and excluded from ordinary CI.
