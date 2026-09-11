# Deployment

## Who serves what (verified 2026-09-11)

| Hostname | Serves | Owned by | Deployed by |
| --- | --- | --- | --- |
| `ufc.proptechusa.ai` | the portal: `/`, `/docs`, `/pricing`, `/workspace`, `/dashboard`, `/legal`, `/openapi.json` | **Vercel** (project `ufc-api`, CNAME to `vercel-dns`) | git push / Vercel promotion |
| `https://proptechusa-ufc-api.sales-fd3.workers.dev` | the **API**: `/v1/ufc/*`, `/health`, `/admin/*`, `/dashboard/api/*` | **Cloudflare Worker** `proptechusa-ufc-api` (account `fd3a233e…`) | `npm run deploy:gateway` |
| `ufc-api.propbetedge.ai` | the canonical upstream API | LHBUSA/UFC | not this repo |
| `ufc.propbetedge.ai` | the consumer application | LHBUSA/UFC (Vercel) | not this repo |

**The workers.dev host is production.** Every paying customer, every copyable snippet in the docs and the
Workspace's own requests go to it. The `GATEWAY_ENV = "preview"` var in `wrangler.toml` is a historical
label, not a staging claim. There is no staging gateway.

`config/gateway.json` carries both hosts and nothing hard-codes either one:

- `api_base_url` — the gateway. OpenAPI `servers[0]`, the docs base URL, the cURL/JS/Python snippets and the
  portal's browser client all read it.
- `commercial_host` — the documentation and account site. Terms, docs and pricing links only.

### The hostname trap this repo used to contain

`gateway/wrangler.toml` had an `[env.production]` block with
`routes = [{ pattern = "ufc.proptechusa.ai", custom_domain = true }]`, and `package.json` had a
`deploy:production` script that used it. The zone `proptechusa.ai` is on Cloudflare DNS
(`igor`/`sunny.ns.cloudflare.com`) while the `ufc` record is a CNAME to Vercel, so running that command
would have registered the Custom Domain, **rewritten the DNS record, and moved the public site off
Vercel**. The environment and both scripts are removed, and
`tests/contract.test.mjs → "deployment safety"` fails the build if any of it returns.

Putting the API on a PropTechUSA hostname later is a deliberate DNS decision, not a deploy flag. The two
sane options, neither of which is done here: give the gateway its own name (e.g. `ufc-api.proptechusa.ai`)
and point `api_base_url` at it, or put a Vercel rewrite in front of `/v1` and accept Vercel in the
authenticated request path. Do not attach `ufc.proptechusa.ai` itself to a Worker.

### Changing `GATEWAY_ENV`

`gateway/src/stripe.js` ignores Stripe **test-mode** webhook events only when `GATEWAY_ENV === "production"`.
With the current `"preview"` value the live gateway still processes test-mode events. Flipping the value to
`"production"` is truthful but changes Stripe behaviour, so it is a deliberate change with its own
verification, not a cleanup.

## Gateway release

```bash
npm test && npm run openapi:lint && npm run contract:check:live     # gates
npx wrangler deployments list --config gateway/wrangler.toml        # capture the current version id = rollback
npm run deploy:gateway
```

Then prove the deployed Worker with real keys:

```bash
ADMIN_TOKEN=… node scripts/issue-key.mjs --host https://proptechusa-ufc-api.sales-fd3.workers.dev \
  issue --customer "Smoke" --plan developer            # repeat for pro, ultra
node scripts/smoke.mjs --host https://proptechusa-ufc-api.sales-fd3.workers.dev --dev … --pro … --ultra …
curl -s https://proptechusa-ufc-api.sales-fd3.workers.dev/health   # api_version_target + gateway_version
```

Rollback: `npx wrangler rollback <version-id> --config gateway/wrangler.toml`.

KV namespace `UFC_API_KEYS` (`91103613c6e2490c928e35b7c7d35121`) holds every issued key; Durable Object
usage counters live with the Worker. Secrets (`ADMIN_TOKEN`, `RAPIDAPI_PROXY_SECRET`,
`STRIPE_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY`, optional `UPSTREAM_API_KEY`) are set once with
`npx wrangler secret put <NAME>` from `gateway/`.

## Portal release

The portal is a separate deploy and must go **after** the gateway: it documents the routes the gateway
serves, so publishing it first would advertise endpoints that still answer `404 route_not_found`.

1. Merge to `ufc-intelligence-v1`. Every push builds a Vercel **preview** (protected by Vercel auth).
2. Production is only updated by promotion: `refresh-showcase.yml` reports
   `VERCEL_DEPLOY_HOOK_URL not set`, so no push promotes itself. Promote from the Vercel dashboard, or add
   the deploy hook as that secret.
3. Visual QA at 1440 and 390 on `/`, `/docs`, `/pricing`, `/workspace`, `/dashboard`: no broken images, no
   horizontal overflow.

`refresh-showcase.yml` also reports `CLOUDFLARE_API_TOKEN not set`, so a showcase commit does not deploy the
Worker either. Both publishing steps are manual today.

## Contract changes

`config/entitlements.json` is the gateway's route allow-list and it is **bundled into the Worker**. Adding
an endpoint there, or a new `upstream/ufc-contract.json`, only reaches customers on the next
`npm run deploy:gateway`. Ship the gateway first, the portal second.
