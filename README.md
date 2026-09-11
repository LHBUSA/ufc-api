# PropTechUSA UFC Intelligence API

**UFC data infrastructure for developers — not another odds feed.** Normalized events, fighters, cards, results, rankings and round-level statistics; official weigh-ins, sourced availability and card changes; plus proprietary **PropBetEdge Fight DNA**, **Matchup DNA** and the **Fight State Ledger**, delivered through one commercial developer API at **https://ufc.proptechusa.ai**.

This repository is the **commercial product**: the gateway, developer portal, pricing, entitlements, metering, RapidAPI packaging and commercial documentation. It is **not** a UFC data repository. It consumes the canonical UFC intelligence system and never recomputes it.

| | |
| --- | --- |
| Portal (docs, pricing, workspace, dashboard) | `https://ufc.proptechusa.ai` — **Vercel**; serves no API routes |
| Commercial API base URL | `https://proptechusa-ufc-api.sales-fd3.workers.dev` — Cloudflare Worker `proptechusa-ufc-api`; **this is production** |
| Canonical / first-party API | `https://ufc-api.propbetedge.ai` (unchanged, keeps working) |
| Consumer demonstration | `https://ufc.propbetedge.ai` (PropBetEdge UFC) |
| Upstream authority | [LHBUSA/UFC](https://github.com/LHBUSA/UFC) `main` @ `c2eaa8f` — see [`upstream/ufc-contract.json`](upstream/ufc-contract.json) |
| Data contract targeted | `2026-09-11.1`, Fight DNA definition version `1` |

## Architecture

```
                 LHBUSA/UFC  (main)
        ingest · ufc_* data model · identity · UFC Stats normalization
        rankings · Fight DNA builder + definitions · media provenance
                              │
                     canonical Worker API
                  https://ufc-api.propbetedge.ai
                              │  HTTPS (body passes through unchanged)
                              ▼
   ┌──────────────────── LHBUSA/ufc-api ──────────────────────┐
   │  gateway/   Cloudflare Worker  proptechusa-ufc-api        │
   │    authenticate (KV keys | RapidAPI proxy secret)         │
   │    entitle   (config/entitlements.json × config/plans.json)│
   │    meter     (Durable Object: per-minute + monthly)        │
   │    attribute (Analytics Engine: channel / plan / route)    │
   │    forward   → canonical API, add commercial headers      │
   └───────────────┬─────────────────┬─────────────────┬───────┘
                   ▼                 ▼                 ▼
   proptechusa-ufc-api           RapidAPI        Enterprise / direct
     .sales-fd3.workers.dev   (same API,        (custom keys, overrides)
     /v1/ufc/*  /health        channel-mapped
     /admin/*  /dashboard/api      plans)

   ┌──────────────────── apps/web (Astro) ────────────────────┐
   │  built to apps/web/dist and deployed to VERCEL           │
   │  ufc.proptechusa.ai  /  /docs  /pricing  /workspace      │
   │  /learn/fight-dna  /dashboard  /openapi.json  /legal     │
   │  calls the gateway cross-origin (config api_base_url)    │
   └──────────────────────────────────────────────────────────┘
```

Layers stay separate on purpose: Fight DNA computes intelligence (upstream), the canonical API serves it (upstream), this gateway authenticates and meters access, Stripe / RapidAPI charge customers.

## Products and tiers

| Plan | Price | Requests / month | Requests / minute | Unlocks |
| --- | --- | --- | --- | --- |
| Developer | $79 | 25,000 | 60 | Core UFC data: events, cards, fighters, results, rankings, search, history, bout round stats, official weigh-ins (with source history), sourced injuries / availability, card changes, fighter status, media + video metadata, editorial, Fight DNA registry |
| Pro | $199 | 100,000 | 180 | + Fighter Fight DNA (stance, striking, grappling, finish, round, context), as-of snapshots, computed career rates, `include=stats` |
| Ultra | $499 | 500,000 | 600 | + Matchup DNA, cross-fighter DNA query, Fight State Ledger, event intelligence (derived fight-week state) |
| Scale | $1,499 | 2,000,000 (soft) | 1,200 | + production terms, priority support, bulk/custom review |
| Enterprise | custom | custom | custom | dedicated infrastructure, custom endpoints, licensing, partnerships, wire |

Prices are final. Quotas are initial configurable values in [`config/plans.json`](config/plans.json). The full endpoint × plan matrix is generated to [`docs/UFC_API_ENTITLEMENTS.md`](docs/UFC_API_ENTITLEMENTS.md).

## Repository layout

```
gateway/            Cloudflare Worker: src/{index,auth,entitlements,keys,usage,policy,upstream,admin,dashboard,telemetry,envelope,config}.js
gateway/test/       node:test suites (policy, entitlements, keys, end-to-end gateway with fakes)
apps/web/           Astro static portal (landing, docs, reference, pricing, learn/fight-dna, dashboard, legal)
config/             plans.json · entitlements.json · rapidapi.json · gateway.json  ← single source of truth
openapi/            ufc-intelligence-api.yaml (GENERATED commercial contract) + redocly.yaml
upstream/           ufc-contract.json (provenance) · openapi.ufc-v1.yaml (upstream snapshot) · fixtures/ (verbatim live responses)
scripts/            snapshot-upstream · check-upstream-contract · build-openapi · build-entitlements-doc · issue-key · smoke
docs/               ARCHITECTURE · DEPLOYMENT · RAPIDAPI_UFC_LAUNCH · UFC_API_ENTITLEMENTS · UFC_API_COMMERCIAL_RIGHTS_MATRIX · STRIPE_CONFIGURATION · OBSERVABILITY
tests/              repo-level tests (contract sync, config integrity)
```

## Environment

Worker bindings (`gateway/wrangler.toml`): `API_KEYS` (KV), `USAGE_COUNTER` (Durable Object, SQLite), `USAGE` (Analytics Engine dataset `ufc_api_usage`), `ASSETS` (portal).

| Variable / secret | Where | Purpose |
| --- | --- | --- |
| `UPSTREAM_BASE_URL` | var | canonical API origin (`https://ufc-api.propbetedge.ai`) |
| `PUBLIC_HOST` | var | this deployment's public origin (the workers.dev gateway) |
| `GATEWAY_ENV` | var | historical label, currently `preview`, on what is in fact the production gateway. Read by `stripe.js` (test-mode events) — see docs/DEPLOYMENT.md before changing |
| `ADMIN_TOKEN` | secret | admin key-issuance API (`/admin/*`) and `scripts/issue-key.mjs` |
| `RAPIDAPI_PROXY_SECRET` | secret | value from the RapidAPI provider console; enables the RapidAPI channel |
| `UPSTREAM_API_KEY` | secret (optional) | forwarded as `X-API-Key` once the canonical host enables `REQUIRE_API_KEY` |
| `STRIPE_WEBHOOK_SECRET` | secret | signing secret for `POST /webhooks/stripe` (every event is signature-verified) |
| `STRIPE_SECRET_KEY` | secret | restricted key: read subscriptions, create Customer Portal sessions |

Local development reads `gateway/.dev.vars` (gitignored). No Supabase credentials exist anywhere in this repo.

## Local development

```bash
npm install
npm run generate          # OpenAPI + entitlement doc + portal data from config + upstream snapshot
npm run build             # + Astro portal → apps/web/dist
npm run dev               # wrangler dev on http://127.0.0.1:8787 (local KV/DO; forwards to the live canonical API)

# issue a local key (ADMIN_TOKEN from gateway/.dev.vars)
ADMIN_TOKEN=dev-admin-token node scripts/issue-key.mjs --host http://127.0.0.1:8787 issue --customer "Local" --plan pro
curl -H "Authorization: Bearer pt_ufc_live_…" "http://127.0.0.1:8787/v1/ufc/fighters/ec94d296-2db3-4e0d-be6a-46de4f480672/dna"
```

## Tests and gates

```bash
npm test                  # gateway unit + end-to-end (fakes) and repo tests
npm run openapi:lint      # Redocly validation of the commercial contract
npm run contract:check    # static drift guard: commercial contract ⊆ upstream snapshot, schemas identical
npm run contract:check:live   # + live probe of the canonical API (version, endpoints, MetricObject, definition version)
npm run smoke -- --host https://<deployment> --dev <key> --pro <key> --ultra <key>   # deployed smoke + canonical parity
```

CI (`.github/workflows/ci.yml`) runs tests, lint, the static drift guard and the build on every push; the live drift guard runs nightly.

## Upstream contract sync

1. `node scripts/snapshot-upstream.mjs --sha <upstream sha>` refreshes `upstream/ufc-contract.json` and `upstream/fixtures/`.
2. Copy the upstream `docs/openapi.ufc-v1.yaml` to `upstream/openapi.ufc-v1.yaml`.
3. `npm run generate` regenerates the commercial OpenAPI, entitlement doc and portal data.
4. `npm run contract:check` must pass. Adding a new upstream endpoint to the commercial product is a deliberate edit to `config/entitlements.json`.

The drift guard fails on: endpoint removed or renamed, required response field removed, MetricObject shape change, Fight DNA definition version change, API version change, or a commercial schema that diverges from upstream.

## RapidAPI

RapidAPI is a distribution channel for the same API. The RapidAPI proxy calls the gateway with `X-RapidAPI-Proxy-Secret`, `X-RapidAPI-User` and `X-RapidAPI-Subscription`; the gateway validates the secret, maps the subscription to the canonical plan (`config/rapidapi.json`), applies entitlements and the per-minute backstop, attributes usage to the `rapidapi` channel, and returns the identical response body. Launch package: [`docs/RAPIDAPI_UFC_LAUNCH.md`](docs/RAPIDAPI_UFC_LAUNCH.md).

## Deployment

Two independent deploys, gateway first: `npm run deploy:gateway` ships the Worker (this is production — there is no staging gateway), and the portal ships to Vercel by merge + promotion. `ufc.proptechusa.ai` is a Vercel hostname and must never be attached to the Worker; a test fails the build if that configuration returns. Full runbook: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Legal

PropTechUSA and PropBetEdge are independent products and are not affiliated with, endorsed by, or sponsored by UFC, Zuffa LLC, TKO Group, ESPN or any sportsbook. Rights classification per field: [`docs/UFC_API_COMMERCIAL_RIGHTS_MATRIX.md`](docs/UFC_API_COMMERCIAL_RIGHTS_MATRIX.md).
