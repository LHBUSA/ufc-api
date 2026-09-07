# Architecture — PropTechUSA UFC Intelligence API

## Two repositories, two jobs

| | LHBUSA/UFC (`ufc-fight-dna-v1`) | LHBUSA/ufc-api (this repo) |
| --- | --- | --- |
| Owns | ingest, `ufc_*` data model, identity resolution, UFC Stats normalization, rankings ingest, Fight DNA builder and definitions, Matchup DNA, media provenance, canonical Worker API, consumer site | commercial gateway, portal, docs, pricing, entitlements, API keys, metering, telemetry, RapidAPI adapter, commercial OpenAPI, rights matrix |
| Computes UFC intelligence | yes | **never** |
| Reads Supabase | yes (service role, server-side) | **never** |
| Hosts | `ufc-api.propbetedge.ai`, `ufc.propbetedge.ai` | `ufc.proptechusa.ai` |

## Request path (`/v1/ufc/*`)

```
client ─► Worker fetch()
   1. authenticate      gateway/src/auth.js
        direct:   Authorization: Bearer pt_ufc_live_<id>_<secret>  → KV key:<id> → sha256 compare → plan/channel/limits
        rapidapi: X-RapidAPI-Proxy-Secret (secret compare) + X-RapidAPI-User + X-RapidAPI-Subscription → plan map
   2. entitle           gateway/src/entitlements.js  (config/entitlements.json × config/plans.json)
        route → endpoint key → feature → plan has feature?  + parameter gates (include=stats, as_of=)
        unknown route → 404 route_not_found (no upstream call)   not entitled → 403 plan_required
   3. meter             gateway/src/usage.js (Durable Object per subject, SQLite) using policy.js decide()
        per-minute fixed window + calendar-month quota; hard / soft / none per plan; RapidAPI: rate backstop only
        denied → 429 rate_limited | quota_exceeded (+ Retry-After)
   4. forward           gateway/src/upstream.js → UPSTREAM_BASE_URL + path + query (15 s timeout)
        body streamed back unchanged; upstream Cache-Control → private, max-age=N; cookies/CORS/CDN headers stripped
   5. headers           X-Request-Id, X-Upstream-Request-Id, X-API-Version (upstream), X-Gateway-Version, X-Plan,
                        X-RateLimit-*, X-Quota-*, CORS for the public API
   6. telemetry         Analytics Engine data point (channel, plan, key id, route, status, latency, denial reason)
                        + Durable Object recent-request log (direct keys) for the dashboard
```

## Storage

| Store | Contents | Notes |
| --- | --- | --- |
| KV `API_KEYS` | `key:<key_id>` → record {secret_hash, customer, plan, channel, status, expires_at, overrides}; `customer:<id>` | raw secrets never stored; key id is the lookup identifier |
| Durable Object `UsageCounter` | counters (`w:<minute>`, `m:<YYYY-MM>`, `denied:*`), recent requests, last_used_at | one object per key id or `rapidapi:<user>`; exact counts |
| Analytics Engine `ufc_api_usage` | one point per request | query with the SQL API (docs/OBSERVABILITY.md) |
| Static assets | `apps/web/dist` | portal, `/openapi.json` |

## Configuration (no scattered constants)

- `config/plans.json` — prices, quotas, rate limits, limit modes, features per plan, key prefix, channels.
- `config/entitlements.json` — every commercial endpoint → feature + origin; parameter gates.
- `config/rapidapi.json` — subscription → plan map, marketplace quotas, enforcement switches.
- `config/gateway.json` — hosts, timeouts, header policy, CORS.

Generated from config: `openapi/ufc-intelligence-api.yaml`, `apps/web/public/openapi.json`, `docs/UFC_API_ENTITLEMENTS.md`, `apps/web/src/generated/*.json`.

## Caching

The canonical API sets `Cache-Control: public` with short TTLs for upcoming cards, rankings, wire and fresh data, and longer TTLs for historical events, bouts and as-of DNA snapshots. The gateway's subrequest benefits from Cloudflare's cache on the canonical host; the gateway's own response is `private` so no shared cache ever stores an authenticated response, while clients keep the same freshness window. Auth and quota state are never cached.

## Security notes

- Keys: 12-char base62 id + 32-char base62 secret (190 bits); only `sha256(full key)` is stored; comparison is constant-time.
- Junk credentials never hit KV (format check first).
- Admin API requires `ADMIN_TOKEN` (constant-time compare), no CORS, returns the raw key once.
- Dashboard API is same-origin, key-scoped, separately rate-limited (30/min), never echoes the secret.
- RapidAPI traffic is trusted only via the provider-issued proxy secret; customer-supplied headers alone grant nothing.
- No Supabase credentials in this repo; the gateway talks HTTPS to the canonical host only.

## Reserved / not enforced in v1

- Concurrency limits (recorded in config, not enforced).
- Overage billing (`overage.enabled=false` everywhere; the shape exists for Stripe metering later).
- Enterprise custom endpoints.
