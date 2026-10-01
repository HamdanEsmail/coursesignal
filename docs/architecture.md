# Architecture

```text
iPhone
  -> Photon managed iMessage line
  -> Node.js Spectrum bridge
  -> idempotent inbound event
  -> durable research workflow
       -> TinyFish Search
       -> TinyFish Fetch
       -> TinyFish Agent only when interaction is necessary
  -> evidence and reply outbox
  -> Spectrum bridge
  -> iMessage reply
```

The bridge owns messaging transport, not research policy. The control plane owns provider admission, evidence, memory, watches, and budgets. The browser-facing web app receives only sanitized receipt data and never receives Photon or TinyFish credentials.

The default bridge runtime store is a private local JSON file. An explicit `COURSESIGNAL_STORE=supabase` deployment uses `bridge_runtime_state` for bounded consent/course/latest-receipt memory and `bridge_inbound_claims` for token-protected delivery leases. It maps only edge-generated HMAC keys into the normalized `principals`/`conversations` model. Research, evidence, budgets, and outbound messages remain authoritative in their existing normalized tables; the bridge migration does not create a competing outbox.

The initial proof intentionally uses Spectrum's credentialless terminal transport before swapping in the managed iMessage provider. This isolates message handling and TinyFish research from Photon provisioning.
