# Lodge

Lodge is a friend in iMessage. A student texts a question. Lodge reads a public page, sends a slip you can tap, reminds you when you asked, and only puts the week on a calendar if you approve Save. Heart a slip to pin it. A few internships, never an application — the longer list lives on FirstRole.

The iMessage thread is the product. The companion site is a dusk, helpful landing. A graphite iPhone plays Wednesday moment by moment in real Messages chrome so a student can see what to text, open a slip, and tap Save. Lodge uniqueness lives in the conversation, the wallpaper, and the rest of the site — not a remade phone shape. It is not a second chatbot.

Live companion: [coursesignal-bzb.pages.dev](https://coursesignal-bzb.pages.dev/)

## What a student can text

START, skip, what’s due this week, save the week, remind me Friday 5, any internships in Dubai, note that…, FORGET / FORGET CONFIRM. Ordinary words after START. Keep passwords and private school logins out of the thread.

Lodge never logs into an LMS, types into a form, applies, or adds a calendar event by itself.

## Companion website

`apps/web` is the dusk landing, the living iPhone day (`DayPhone`), hosted slips (`/slip`), the approve-the-week page (`/add`), and the calendar file (`/add.ics`). Technical architecture does not belong on the landing page. Generated dusk art is wallpaper, hero, mark, and atmosphere — compressed WebP/JPEG, never a 4K dump, and never a replacement for iPhone or Messages chrome. The day-sim plays one chapter at a time with `requestAnimationFrame`, commits only when the thread actually changes, and cancels on unmount.

`public/_redirects` must stay exactly:

```
/slip / 200
/add / 200
```

`public/_routes.json` invokes the uploaded `_worker.js` only for `/add.ics`. Pages Direct Upload asset keys are slash-prefixed URL paths (`/index.html`, not `index.html`).

## Architecture (engineers)

```text
iPhone
  -> Photon managed iMessage line
  -> Node.js Spectrum bridge
  -> durable research workflow
       -> TinyFish Search
       -> TinyFish Fetch
       -> TinyFish Agent only when a page must be opened
  -> reply back through Photon
```

- Optional OpenRouter/Gemma may rewrite only bounded evidence into a short student sentence. The extractive TinyFish answer is the fallback.
- Calendar files are built in `apps/web` (`text/calendar`). HMAC keys, conversation ids, and phone numbers never appear on slips or in the ICS query.
- `LODGE_MODE` stays off on Azure until the iPhone friend loop is confirmed. Do not put Photon, TinyFish, OpenRouter, Supabase, or HMAC secrets in `VITE_` variables.
- Deploy map, secret boundary, and release order: [`docs/deployment.md`](docs/deployment.md), [`docs/architecture.md`](docs/architecture.md), [`docs/security.md`](docs/security.md).

## Repository layout

- `apps/bridge` — Photon Spectrum process and local terminal proof
- `apps/web` — dusk desk, slips, `/add.ics` worker
- `packages/contracts` — shared product contracts
- `packages/tinyfish` — provider transport
- `packages/provider-control` — metering, reservation, retry, idempotency

## Local checks

```powershell
npm install
npm run check
```

```powershell
npm run proof:echo
```

```powershell
$env:TINYFISH_API_KEY = [Environment]::GetEnvironmentVariable('TINYFISH_API_KEY', 'User')
npm run proof:research -- "Explain conditional probability using reliable university sources"
```

No populated `.env` file, phone number, provider credential, or private conversation belongs in Git.
