# Deployment — ufc.proptechusa.ai

One Cloudflare Worker (`proptechusa-ufc-api`, account `fd3a233edadd0a60916413c1199f71ee`) serves the portal (static assets) and the gateway. Two environments in `gateway/wrangler.toml`:

| Env | Command | Host | DNS change |
| --- | --- | --- | --- |
| preview (default) | `npm run deploy:preview` | `https://proptechusa-ufc-api.sales-fd3.workers.dev` | none |
| production | `npm run deploy:production` | `https://ufc.proptechusa.ai` (custom domain) | **creates the DNS record** — run only after the gate below |

## One-time setup

```bash
npm install
cd gateway
npx wrangler secret put ADMIN_TOKEN                 # preview
npx wrangler secret put RAPIDAPI_PROXY_SECRET       # preview (value from RapidAPI console; optional until listing exists)
npx wrangler secret put ADMIN_TOKEN --env production
npx wrangler secret put RAPIDAPI_PROXY_SECRET --env production
# optional, only after the canonical host enables REQUIRE_API_KEY:
npx wrangler secret put UPSTREAM_API_KEY --env production
```

KV namespace `UFC_API_KEYS` (`91103613c6e2490c928e35b7c7d35121`) is shared by preview and production so keys issued once work on both hosts. Durable Object usage counters are per-Worker-environment.

## Preview gate (must pass before production)

1. `npm test` — gateway + repo tests green.
2. `npm run openapi:lint` — commercial contract valid.
3. `npm run contract:check:live` — no upstream drift.
4. `npm run deploy:preview`.
5. Issue test keys on preview: `ADMIN_TOKEN=… node scripts/issue-key.mjs --host https://proptechusa-ufc-api.sales-fd3.workers.dev issue --customer "Smoke" --plan developer` (repeat for pro, ultra).
6. `node scripts/smoke.mjs --host https://proptechusa-ufc-api.sales-fd3.workers.dev --dev … --pro … --ultra …` — canonical parity, plan gates, as-of, unknown fighter, unavailable DNA, bad key, wrong plan, headers, portal pages.
7. Visual QA at 1440 and 390: `/`, `/pricing`, `/docs`, `/learn/fight-dna`, `/dashboard`. No broken images, no horizontal overflow.
8. Canonical host still healthy: `curl -sI https://ufc-api.propbetedge.ai/v1/ufc` (200, `X-API-Version` present). Nothing in this repo touches it.

## Production cutover — exact DNS steps for ufc.proptechusa.ai

`proptechusa.ai` is on Cloudflare DNS (nameservers `igor.ns.cloudflare.com`, `sunny.ns.cloudflare.com`). `ufc.proptechusa.ai` currently has **no record**. Two equivalent paths:

**Path A — Workers custom domain (recommended, automatic DNS):**

1. In `gateway/`, run `npx wrangler deploy --env production`. Wrangler registers the Custom Domain `ufc.proptechusa.ai` on the Worker; Cloudflare creates the proxied DNS record and issues the certificate automatically (the zone must be in the same account; if the zone lives in another account, use Path B).
2. Wait for the certificate (usually < 5 minutes): `curl -sI https://ufc.proptechusa.ai/health`.
3. Run the smoke against production: `node scripts/smoke.mjs --host https://ufc.proptechusa.ai --dev … --pro … --ultra …`.

**Path B — manual DNS + route (if the zone is in a different Cloudflare account):**

1. Cloudflare dashboard → zone `proptechusa.ai` → DNS → Add record: type `AAAA`, name `ufc`, content `100::`, proxied (orange cloud). (A placeholder target is standard for Workers routes.)
2. Workers & Pages → `proptechusa-ufc-api` → Settings → Domains & Routes → Add route `ufc.proptechusa.ai/*` (or add the Custom Domain from the same screen).
3. Remove `routes` from `[env.production]` in `wrangler.toml` if the domain is managed from the dashboard, then `npx wrangler deploy --env production`.
4. Verify as in Path A.

**Do not** change `ufc-api.propbetedge.ai` (canonical, stays on the upstream Worker) or `ufc.propbetedge.ai` (Vercel consumer site). No redirects are configured from the old host; both hosts serve the same contract.

## Rollback

`npx wrangler rollback --env production` (previous Worker version) or `npx wrangler deployments list --env production` to pick one. Removing the custom domain from the Worker removes the route; the DNS record is deleted with it.

## After cutover

- Update `config/gateway.json → commercial_host` only if the hostname ever changes (it drives OpenAPI servers and docs).
- Issue real customer keys with `scripts/issue-key.mjs --host https://ufc.proptechusa.ai`.
- Point the RapidAPI listing base URL at `https://ufc.proptechusa.ai` (docs/RAPIDAPI_UFC_LAUNCH.md).
- Add the consumer-site link (`Developers → UFC API`) on ufc.propbetedge.ai as a separate upstream change (see the final report).
