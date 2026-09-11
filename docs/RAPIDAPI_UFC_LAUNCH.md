# RapidAPI launch package — PropTechUSA UFC Intelligence API

RapidAPI is a **distribution channel** for the same API. One data system, one Worker authority, one OpenAPI contract, one Fight DNA feature system, one entitlement model. The marketplace listing points at the commercial gateway; the gateway validates RapidAPI proxy traffic, maps the subscription to the canonical plan and returns the identical response body.

## Listing copy

**Product name**: PropTechUSA UFC Intelligence API

**Short description** (≤ 200 chars):
Developer-ready UFC events, fighters, fight cards, results and round-level statistics with proprietary PropBetEdge Fight DNA.

**Long description**:

UFC data built for developers. The PropTechUSA UFC Intelligence API delivers normalized UFC events, fighters, fight cards, results, round-level statistics, official rankings snapshots and fighter history through one versioned developer contract, and adds the proprietary PropBetEdge Fight DNA layer on top.

- **Normalized UFC events, cards and results** with one canonical identity per fighter, event and bout; lookups by UUID, UFCStats id or ESPN id.
- **Round-level statistics** from UFC Stats: significant strikes, takedowns, control time, knockdowns, submission attempts, head/body/leg and distance/clinch/ground splits, per round and per bout.
- **Official rankings** as a verified ufc.com snapshot with per-division champion and ranked entries.
- **Fighter history** with opponent, outcome and event context.
- **Fight DNA** (Pro and above): proprietary fighter intelligence derived from event-dated fight history: Stance DNA, Striking DNA, Grappling DNA, Finish DNA, Round DNA and Context DNA.
- **Matchup DNA** (Ultra and above): fighter-vs-fighter comparisons, stance-specific history, pace, target and phase mismatches, finish windows, with threshold-gated insights.
- **Sample-aware derived metrics**: every Fight DNA value is a MetricObject carrying value, unit, numerator, denominator, sample bouts, rounds and seconds, confidence tier, coverage status, definition version, origin and as-of date.
- **Confidence and provenance** on every derived number. Low samples are reported as low samples; a zero denominator is a null, never a fake zero.
- **As-of reconstruction**: `?as_of=YYYY-MM-DD` rebuilds what was knowable before a date, with exclusive semantics that never leak future bouts.
- **Truthful nulls**: missing facts are null or an explicit unavailable state. No fabricated rankings, odds, picks, probabilities or editorial facts.

PropTechUSA operates the infrastructure; PropBetEdge Fight DNA is the proprietary analytics engine. PropTechUSA and PropBetEdge are independent products and are not affiliated with, endorsed by, or sponsored by UFC, Zuffa LLC, TKO Group, ESPN or any sportsbook. Fight DNA values are PropBetEdge-derived analytics, not official UFC statistics.

**Category**: Sports · **Tags**: UFC, MMA, fighting, sports data, fight statistics, fighter stats, sports analytics, fight cards, rankings, matchup

**Website**: https://ufc.proptechusa.ai · **Docs**: https://ufc.proptechusa.ai/docs · **Terms**: https://ufc.proptechusa.ai/legal

## Base URL and authentication

- Base URL configured in the RapidAPI console: `https://ufc.proptechusa.ai`
- RapidAPI adds `X-RapidAPI-Proxy-Secret`, `X-RapidAPI-User`, `X-RapidAPI-Subscription` (and `X-RapidAPI-Host`, `X-RapidAPI-Version`) on every proxied request.
- The gateway (`gateway/src/auth.js → authenticateRapidApi`) requires the proxy secret to match the `RAPIDAPI_PROXY_SECRET` Worker secret (constant-time), requires user + subscription, maps the subscription name to the canonical plan (`config/rapidapi.json → subscription_to_plan`), and rejects anything else (`401 invalid_rapidapi_proxy_secret`, `401 rapidapi_headers_missing`, `403 rapidapi_plan_unmapped`).
- Subscribers do not need a PropTechUSA key; RapidAPI's own `X-RapidAPI-Key` is consumed by the RapidAPI proxy. The gateway never trusts a customer-supplied header for identity.

## Plans (same ladder as direct)

| RapidAPI plan name | Price | Requests / month (marketplace) | Rate limit | Maps to | Unlocks |
| --- | --- | --- | --- | --- | --- |
| DEVELOPER | $79 / month | 20,000 | 60 / min | `developer` | Core UFC data, media + video metadata, editorial, Fight DNA registry |
| PRO | $199 / month | 80,000 | 180 / min | `pro` | + Fighter Fight DNA, as-of, computed career rates, `include=stats` |
| ULTRA | $499 / month | 400,000 | 600 / min | `ultra` | + Matchup DNA, DNA query, Fight State Ledger, event intelligence |
| SCALE | $1,499 / month | 1,500,000 | 1,200 / min | `scale` | + production terms, priority support |

Direct plans include more requests (25k / 100k / 500k / 2M) so direct customers are never worse off. Quotas and overage are enforced and billed by RapidAPI; the gateway enforces the per-minute limit as a backstop (`enforce_rate_limit_at_gateway: true`) and does **not** double-enforce the monthly quota (`enforce_monthly_quota_at_gateway: false`). Overage: disabled at launch (configure later per plan in the RapidAPI console if desired).

Plan names in the console must match `subscription_to_plan` keys (case-insensitive). If RapidAPI's default names (BASIC / PRO / ULTRA / MEGA) are used instead, they are already mapped.

## Endpoint inventory (39 operations, all GET; the generated source of truth is `docs/UFC_API_ENTITLEMENTS.md`)

Core (DEVELOPER+): `/v1/ufc`, `/v1/ufc/events`, `/v1/ufc/events/{id}`, `/v1/ufc/events/{id}/card`, `/v1/ufc/fighters`, `/v1/ufc/fighters/{id}`, `/v1/ufc/fighters/{id}/history`, `/v1/ufc/bouts/{id}`, `/v1/ufc/bouts/{id}/stats`, `/v1/ufc/results`, `/v1/ufc/rankings`, `/v1/ufc/search`, `/v1/ufc/counts`, `/v1/ufc/dna/metrics`
Weigh-ins & availability (DEVELOPER+, since API 2026-09-11.1): `/v1/ufc/weigh-ins`, `/v1/ufc/events/{id}/weigh-ins`, `/v1/ufc/injuries`, `/v1/ufc/events/{id}/card-changes`, `/v1/ufc/fighters/{id}/status`
Media / video metadata (DEVELOPER+): `/v1/ufc/fighters/media`, `/v1/ufc/videos`, `/v1/ufc/fighters/{id}/videos`, `/v1/ufc/events/{id}/videos`, `/v1/ufc/bouts/{id}/videos`
Editorial (DEVELOPER+): `/v1/ufc/news`, `/v1/ufc/articles/{slug}`, `/v1/ufc/events/{id}/articles`, `/v1/ufc/fighters/{id}/articles`
Fight DNA (PRO+): `/v1/ufc/fighters/{id}/stats`, `/v1/ufc/fighters/{id}/dna`, `/v1/ufc/fighters/{id}/splits`, `/v1/ufc/fighters/{id}/round-profile`, `/v1/ufc/fighters/{id}/finish-profile`, `/v1/ufc/fighters/{id}/position-profile`
Matchup + Fight Week (ULTRA+): `/v1/ufc/matchups/{fighterA}/{fighterB}/dna`, `/v1/ufc/dna/query`, `/v1/ufc/bouts/{id}/ledger`, `/v1/ufc/events/{id}/intelligence`
Not listed on RapidAPI: `/v1/ufc/wire` (third-party headlines; Enterprise / first-party only pending rights review).

Import `openapi/ufc-intelligence-api.yaml` into the RapidAPI console to create the endpoint definitions; every operation carries `x-plan`. The listing base URL is `servers[0]` in that file (the gateway on workers.dev), **not** the documentation site.

## Example requests

```bash
# Upcoming events
curl "https://ufc-intelligence-api.p.rapidapi.com/v1/ufc/events?status=upcoming&limit=3" \
  -H "X-RapidAPI-Key: $RAPIDAPI_KEY" -H "X-RapidAPI-Host: ufc-intelligence-api.p.rapidapi.com"

# Fighter Fight DNA (PRO+)
curl "https://ufc-intelligence-api.p.rapidapi.com/v1/ufc/fighters/ec94d296-2db3-4e0d-be6a-46de4f480672/dna" \
  -H "X-RapidAPI-Key: $RAPIDAPI_KEY" -H "X-RapidAPI-Host: ufc-intelligence-api.p.rapidapi.com"

# Matchup DNA (ULTRA+)
curl "https://ufc-intelligence-api.p.rapidapi.com/v1/ufc/matchups/ec94d296-2db3-4e0d-be6a-46de4f480672/9a3b2a15-27d8-4554-9217-42ef2dd5d25c/dna" \
  -H "X-RapidAPI-Key: $RAPIDAPI_KEY" -H "X-RapidAPI-Host: ufc-intelligence-api.p.rapidapi.com"
```

(The RapidAPI host name is assigned when the listing is created; replace accordingly.)

## Example responses

Verbatim live responses are stored in `upstream/fixtures/` and rendered in the OpenAPI examples. Representative MetricObject from `fighter_dna.json`:

```json
{
  "metric_key": "sig_landed_per_min", "value": 6.2327, "unit": "per_min",
  "numerator": 233, "denominator": 2243,
  "sample_bouts": 2, "sample_rounds": 8, "sample_seconds": 2243,
  "confidence": "medium", "coverage_status": "low",
  "definition_version": 1, "origin": "pbe_derived", "source_families": ["ufcstats"], "as_of_date": "2026-09-06"
}
```

## Error contract

Envelope `{ ok:false, data:null, error:{ code, message, detail? }, meta:{ request_id, version, gateway_version } }`.

| Status | Code | When |
| --- | --- | --- |
| 401 | `invalid_rapidapi_proxy_secret` / `rapidapi_headers_missing` | proxy misconfigured (never seen by a correctly proxied subscriber) |
| 403 | `rapidapi_plan_unmapped` | subscription name not in `subscription_to_plan` |
| 403 | `plan_required` | endpoint / parameter above the subscriber's plan (`detail.required_plan`, `upgrade_url`) |
| 404 | `route_not_found` | outside the commercial contract |
| 404 | `fighter_not_found`, `event_not_found`, `dna_not_available`, … | canonical API, passed through unchanged |
| 429 | `rate_limited` | per-minute backstop (`Retry-After`) |
| 503 | `rapidapi_not_configured` | `RAPIDAPI_PROXY_SECRET` missing on the gateway |
| 502 / 504 | `upstream_unavailable` / `upstream_timeout` | canonical API unreachable |

Headers: `X-Request-Id`, `X-Upstream-Request-Id`, `X-API-Version`, `X-Gateway-Version`, `X-Plan`, `X-RateLimit-Limit/Remaining/Reset`, `X-Quota-Limit/Remaining/Reset` (marketplace quota reported; RapidAPI is authoritative).

## Marketplace setup checklist

1. Create the API in the RapidAPI Provider Dashboard (Hub listing): name, category Sports, tags, logo (PropTechUSA), website, docs and terms links above.
2. Base URL `https://ufc.proptechusa.ai`. Copy the **Proxy Secret** from Settings and set it on the gateway: `cd gateway && npx wrangler secret put RAPIDAPI_PROXY_SECRET --env production` (and on preview for testing).
3. Import `openapi/ufc-intelligence-api.yaml`; remove `/v1/ufc/wire` from the listing; group endpoints by tag (Core, Weigh-ins & Availability, Media, Editorial, Fight DNA, Matchup DNA, Fight Week).
4. Create plans **DEVELOPER $79 / PRO $199 / ULTRA $499 / SCALE $1,499** with the monthly quotas and per-minute limits in the table above; leave overage off; mark plan objects as "Endpoints available per plan" using the `x-plan` values (Fight DNA endpoints hidden below PRO, Matchup below ULTRA).
5. Set "Request/response transformation": none. Do not enable RapidAPI-side caching.
6. Health check endpoint: `/health`.
7. Test from the Hub with a test subscription on each plan: `/v1/ufc/events` (all), `/v1/ufc/fighters/{id}/dna` (PRO+ 200, DEVELOPER 403), `/v1/ufc/matchups/{a}/{b}/dna` (ULTRA+ 200, PRO 403). Confirm `X-Plan` matches the subscription.
8. Verify attribution in Analytics Engine: `channel = 'rapidapi'` rows with `rapidapi_user` and `rapidapi_subscription` (docs/OBSERVABILITY.md).
9. Publish.

## Support

- Support email: sales@proptechusa.ai (RapidAPI "Contact Provider" routed here).
- Status: `https://ufc.proptechusa.ai/health`.
- Every response carries `X-Request-Id`; ask for it in tickets.

## Terms considerations

- Marketplace terms apply in addition to PropTechUSA terms (`/legal`). Formal ToS / data licence are pending counsel (portal states this).
- Media: metadata and attribution only; subscribers inherit each image's license. Do not describe images as relicensable.
- Video: identifiers and official links only; no rehosting.
- Wire: excluded.
- Rights review items are listed in `docs/UFC_API_COMMERCIAL_RIGHTS_MATRIX.md`.

## Launch checklist

- [ ] Gateway production deploy with custom domain live and smoke green (docs/DEPLOYMENT.md).
- [ ] `RAPIDAPI_PROXY_SECRET` set on production.
- [ ] Listing copy, plans and endpoint groups configured as above; wire excluded.
- [ ] Test subscriptions on all four plans verified (200 / 403 matrix + `X-Plan`).
- [ ] Analytics Engine shows `rapidapi` channel attribution.
- [ ] Rights review items signed off or listing scoped down accordingly (media, video).
- [ ] Support routing tested.
