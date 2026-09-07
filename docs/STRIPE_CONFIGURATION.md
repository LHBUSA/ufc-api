# Stripe billing — live wiring

Stripe products and recurring monthly prices for **PropTechUSA UFC Intelligence API** already exist in live mode. Nothing here creates Stripe objects; the repo only references the public identifiers.

Flow (intentional, v1):

```
/pricing → Stripe-hosted Payment Link → subscription → POST /webhooks/stripe (signature verified)
        → provisioning into the key store (issue or update, idempotent) → /dashboard?checkout=success&session_id=…
        → key revealed once → Customer Portal for management
```

## Config — `config/billing.json` (single source of truth)

| Plan | Price | Stripe price id | Payment Link | Entitlement |
| --- | --- | --- | --- | --- |
| Developer | $79/month | `price_1UD2VSF3CaVzg4ORNqjkxSDS` | https://buy.stripe.com/8x2dR95IabuCg8d6wr7wA0t | `developer` |
| Pro | $199/month | `price_1UD2VaF3CaVzg4ORHLQsfjNT` | https://buy.stripe.com/8x2bJ16Me8iq6xD8Ez7wA0u | `pro` |
| Ultra | $499/month | `price_1UD2VhF3CaVzg4OR1UK7Dckp` | https://buy.stripe.com/bJebJ13A2eGO2hnbQL7wA0v | `ultra` |
| Scale | $1,499/month | `price_1UD2VqF3CaVzg4ORxXKNbBIC` | https://buy.stripe.com/cNi00j4E6buC3lr6wr7wA0w | `scale` |
| Enterprise | Let's talk | — | — (mailto) | `enterprise` |

The pricing page reads these through the generated `apps/web/src/generated/entitlements.json` (`billing` block); no Stripe URL is hard-coded in a component. `price_to_plan` is the server-side whitelist; `metadata_plan_whitelist` is the allowed metadata set. RapidAPI, enterprise and first-party keys are never billed through Stripe.

## Webhook — `POST /webhooks/stripe` (`gateway/src/stripe.js`)

- **Verification**: `Stripe-Signature` (`t`, `v1`) is checked with HMAC-SHA256 over `${t}.${rawBody}` using `STRIPE_WEBHOOK_SECRET`, constant-time compare, 300 s tolerance. Unsigned or bad → `400 invalid_signature`; secret missing → `503`.
- **Idempotency**: `stripe_event:<id>` is stored in KV (30-day TTL); a retried event returns `duplicate_ignored`. Re-applying the same subscription state returns `unchanged` and never issues a second key.
- **Test-mode guard**: `livemode:false` events are ignored on production unless `STRIPE_ALLOW_TEST_EVENTS=true`.

Events handled:

| Event | Effect |
| --- | --- |
| `checkout.session.completed` / `checkout.session.async_payment_succeeded` | stores `checkout_session:<cs_id>` (customer, subscription, email); if paid, fetches the subscription (`STRIPE_SECRET_KEY`) and provisions; otherwise waits for the subscription event |
| `customer.subscription.created` / `updated` | provisions from the subscription object: price → plan, status → entitlement (see policy), plan changes applied to the existing key |
| `customer.subscription.deleted` | billing state `ended`, key `suspended` (never deleted) |
| `invoice.paid` | records payment; `past_due` → `active` |
| `invoice.payment_failed` | billing state `past_due`; **key untouched** while Stripe retries |

**Price → plan is the entitlement signal.** `subscription.metadata.plan` is a consistency check: if present and different (or outside the whitelist) the event **fails closed** — billing record `review_required`, no key issued or changed, error logged, and the dashboard tells the customer it is under review.

**Status policy** (`status_policy` in config): `active`/`trialing` → key active; `past_due` → key active (billing `past_due`); `incomplete` → nothing provisioned; `unpaid`, `canceled`, `incomplete_expired`, `paused` → key `suspended` (`401 api_key_suspended`). Reactivation happens automatically when a later subscription event reports `active`.

**Plan changes**: whatever price Stripe reports on the subscription is applied (upgrade or downgrade). Downgrades scheduled for period end only change the price when Stripe applies them, so access is not removed early. **Cancellation**: `cancel_at_period_end=true` keeps the key active until `customer.subscription.deleted` arrives at period end.

**Provisioning records** (KV `API_KEYS`): `stripe_customer:<cus>` = `{ stripe_customer_id, stripe_subscription_id, stripe_price_id, plan, subscription_status, billing_state, current_period_end, cancel_at_period_end, api_key_id, customer_id, email, last_paid_at, last_payment_failed_at, review_reason }`; the key record carries `billing.{stripe_customer_id, stripe_subscription_id, stripe_price_id, billing_state, current_period_end, cancel_at_period_end}`. Rotation moves the billing link to the new key.

**Key reveal**: a newly issued key is stored as `pending_key:<cus>` (7-day TTL) and revealed exactly once through `GET /dashboard/api/checkout?session_id=cs_…` (the Checkout Session id from the success redirect is the purchaser's credential). No email delivery exists yet; if the purchaser closes the page before copying, issue a rotation or a new key from the admin API.

## Dashboard

`/dashboard?checkout=success&session_id={CHECKOUT_SESSION_ID}` shows **SUBSCRIPTION ACTIVE / being provisioned**, polls the checkout state (up to 10 × 3 s), then shows the plan and the one-time key, or "being activated, refresh in a moment", or the review message. Never a fake key. Loaded dashboards show PLAN, STATUS, USAGE, RENEWS, rate limit, key actions (copy, rotate, docs) and **Manage subscription** (Stripe Customer Portal session via `POST /dashboard/api/portal`). Keys without a Stripe link show **Choose a plan →**.

## Worker secrets (values never printed or committed)

```bash
cd gateway
npx wrangler secret put STRIPE_WEBHOOK_SECRET                    # preview
npx wrangler secret put STRIPE_SECRET_KEY                        # preview (restricted key is enough: Subscriptions read, Billing Portal write)
npx wrangler secret put STRIPE_WEBHOOK_SECRET --env production
npx wrangler secret put STRIPE_SECRET_KEY --env production
```

## Stripe Dashboard steps still required

1. **Webhook endpoint** (Developers → Webhooks → Add endpoint): URL `https://ufc.proptechusa.ai/webhooks/stripe` (production) — and optionally the preview host for testing — with events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`. Copy its signing secret into `STRIPE_WEBHOOK_SECRET`.
2. **Restricted API key** (Developers → API keys → Create restricted key): Subscriptions *read*, Billing portal *write* (Customer portal sessions). Put it in `STRIPE_SECRET_KEY`.
3. **Customer Portal** (Settings → Billing → Customer portal): enable update payment method, invoice history, cancel subscription (at period end), and switching between the four prices if plan changes should be self-serve.
4. Tax: automatic Stripe Tax stays **off** on the Payment Links until registrations are reviewed; Tax ID collection stays on. Do not change silently.
5. Do not promote the purchase CTAs to public traffic until `ufc.proptechusa.ai` resolves and `/dashboard` works there (the Payment Links redirect there).

## Testing

`gateway/test/stripe.test.mjs` signs fixture events with a test secret and exercises: signature validity, price/metadata mapping, Developer purchase → Developer key revealed once, Pro/Ultra/Scale entitlements, duplicate events, replayed state (no duplicate key), metadata mismatch fail-closed, payment failure (past_due, key kept), invoice recovery, cancel at period end (access kept), subscription deleted (suspended, 401), unpaid → suspended → active, upgrades/downgrade on the same key, rotation keeping the billing link, portal session, test-mode guard. No live charges are made.

For an end-to-end rehearsal without charges: Stripe test mode with a **test** webhook endpoint pointing at the preview host and `STRIPE_ALLOW_TEST_EVENTS=true` on preview, then `stripe trigger checkout.session.completed` from the Stripe CLI.
