# Stripe configuration required (not created — no live Stripe objects were touched)

The consumer site (LHBUSA/UFC `web/lib/site.ts`) uses Stripe **Payment Links** for PropBetEdge Pro. No Stripe products exist for the API. Nothing here is a real Stripe id; create the objects below when authorized and record the ids in a secret store, not in this repo.

## Products and prices to create (Stripe Dashboard → Product catalog)

| Product name | Price (recurring, monthly, USD) | Lookup key (suggested) | Maps to plan |
| --- | --- | --- | --- |
| UFC Intelligence API — Developer | $79.00 | `ufc_api_developer_monthly` | `developer` |
| UFC Intelligence API — Pro | $199.00 | `ufc_api_pro_monthly` | `pro` |
| UFC Intelligence API — Ultra | $499.00 | `ufc_api_ultra_monthly` | `ultra` |
| UFC Intelligence API — Scale | $1,499.00 | `ufc_api_scale_monthly` | `scale` |

Enterprise is invoiced manually (no Stripe price).

Product metadata (set on each product): `plan=<key>`, `product=ufc_intelligence_api`, `included_requests=<from config/plans.json>`, `rate_limit_per_min=<from config>`.

## Checkout flow (v1, simplest)

1. Create four **Payment Links** (one per price) with "Collect customer email" on and a success URL `https://ufc.proptechusa.ai/dashboard?checkout=success`.
2. Put the links in `config/plans.json` as `checkout_url` per plan (field not yet present; add it) and switch the pricing CTAs from `mailto:` to the links.
3. Webhook (`checkout.session.completed` → issue key): a small Worker route `POST /billing/stripe/webhook` that verifies the signature (`STRIPE_WEBHOOK_SECRET`), reads `metadata.plan`, calls `issueKey()` with `customer_name` / `customer_email` from the session, and emails the key once. Stripe customer id goes into the key record (`customer.stripe_customer_id`).
4. `customer.subscription.deleted` / `invoice.payment_failed` → `status: suspended` on the customer's keys.

## Metered overage (later)

Plans carry `overage.enabled` and `price_usd_per_1k` in config. When enabling: create a metered price per plan, report usage from the Durable Object monthly counter (or Analytics Engine) via `usage_records`, and flip `overage.enabled`. Nothing in the gateway needs to change for enforcement semantics (soft limit already exists on Scale).

## Secrets needed on the Worker when billing is wired

`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`. Never commit them.
