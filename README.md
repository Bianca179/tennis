# Matchplan — Your Coaches (Hub App)

One surface with tiles for each coach, an email-gated free trial, a paywall, and the
Markus intake — built on the same lightweight pattern as the Sam Menton app
(static page + Netlify functions → Anthropic API directly, prompt caching, token gate).

## Flow

1. **Onboarding** — welcome + email capture → starts a free trial (`trialDays`, default 7).
   The email is POSTed to `/api/subscribe`.
2. **Home** — tiles: **Markus** (performance & nutrition), **Sam** (mental), **Alex** (stretching &
   mobility, with his knowledge base), and a wide **Connect Whoop** tile. All three chat in the app.
3. **Markus intake** — first time entering Markus: age, height, weight, location, food
   intolerances → stored locally, sent as private context on every message.
4. **Chat** — talks to `/api/chat` with `{ coach, profile, token, email, messages }`.
5. **Paywall** — when the trial ends (and no purchase token / no `?paid=1`), a **selection
   screen** shows. The buyer ticks the coaches they want (or the bundle); the app POSTs the
   selection to `/api/checkout`, which builds a **Stripe Checkout Session for exactly that
   selection** (Voca-style — the link is generated from the app depending on what/how much is
   booked) and redirects there. On return, `?paid=1` unlocks the app on that device (MVP).
   A buyer can also open the app with `?key=THEIR_TOKEN` to unlock full access.

## Files

```
index.html                     → the whole hub UI (tiles, onboarding, intake, chat, paywall)
netlify/functions/chat.js      → coach proxy to Anthropic; COACHES map holds each coach's prompt
netlify/functions/subscribe.js → email / lead capture → Airtable Leads (Inbound) + Kontakte, tagged "App"
netlify/functions/checkout.js  → dynamic Stripe Checkout: selection → Stripe Price IDs → Session URL
netlify.toml                   → /api/chat, /api/subscribe, /api/checkout redirects
manifest.json                  → PWA (add to home screen)
```

## Deploy (one-time)

1. Push this folder to a GitHub repo.
2. Netlify → **Add new site → Import from Git**, pick the repo. `netlify.toml` is read automatically.
3. **Site settings → Environment variables:**
   - `ANTHROPIC_API_KEY` or `ANTHROPIC_KEY` (required) — your Claude API key.
   - `ALLOWED_ORIGINS` (before launch) — your live URL, e.g. `https://matchplan.netlify.app`.
   - `ACCESS_TOKENS` (optional) — comma-separated purchase tokens for paid users.
   - **Lead capture → Airtable "Steuerzentrale":**
     - `AIRTABLE_TOKEN` — Airtable Personal Access Token with `data.records:write` on the
       Steuerzentrale base. Signups are written to **Leads (Inbound)** with `Lead-Spur = "App"`
       and to **Kontakte** with `Tags = ["App"]`. `typecast:true` creates the "App" option
       automatically the first time.
     - `AIRTABLE_BASE` (optional) — defaults to `appqscSUAbAqQGMpk` (Steuerzentrale).
     - `LEADS_TABLE` / `CONTACTS_TABLE` (optional) — default `Leads (Inbound)` / `Kontakte`.
     - `SUBSCRIBE_WEBHOOK` (optional) — fallback only, used if `AIRTABLE_TOKEN` is unset.
       If neither is set, leads appear in the Netlify function log only.
   - **Stripe checkout:**
     - `STRIPE_SECRET_KEY` — best a restricted key (`rk_live_…`) with *Checkout Sessions: write* only.
     - Prices live in Stripe account "AIVa" and are set in `checkout.js` (public IDs):
       1 coach €12.90/month, all three €25.80/month ("3 for the price of 2"). Two coaches = bundle.
4. In `index.html` → `CFG.plans` / `CFG.bundle`, set the display names and price labels to taste
   (amounts themselves live in Stripe; the labels are display-only).
5. Deploy.

## Access unlocking (MVP vs production)

- **MVP (now):** after Stripe Checkout, `success_url` returns `?paid=1` and the app unlocks on
  that device (`cf_paid`). Good enough to pilot; not tied to a verified purchase.
- **Production:** add a Stripe webhook on `checkout.session.completed` that issues a per-buyer
  token and emails a `?key=TOKEN` link. Put that token in `ACCESS_TOKENS` (or a store) so access
  survives device changes and can be revoked. See the note at the top of `checkout.js`.

## Two things to finish the coaches

- **Markus voice:** `chat.js` → `MARKUS_PROMPT` is derived from Airtable
  *Personalübersicht → Team → Markus → Stellenbeschreibung* (the source of truth). Keep it in
  sync if you change the role definition there.
- **Sam:** v1 launches the existing Sam app (`sammenton.netlify.app`) from the Sam tile. To fold
  Sam fully into this hub, paste his system prompt (from the `Bianca179/Sam` repo,
  `netlify/functions/chat.js` → `SYSTEM_PROMPT`) into `COACHES.sam` here and set the tile to `mode:"chat"`.
- **Fitness coach:** add its prompt + knowledge base (RAG) later; the tile is stubbed "Soon".

## Notes

- User messages are **never logged** (only token-usage numbers, for cost tracking).
- Model: `claude-haiku-4-5` with prompt caching on each coach's system prompt.
- Legal before charging money: imprint, privacy, terms (incl. right of withdrawal), and a
  clear "not a doctor / not therapy" note — especially for the coaches.
