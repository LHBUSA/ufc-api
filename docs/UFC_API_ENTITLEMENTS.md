# UFC Intelligence API — entitlement matrix

Generated from `config/plans.json` + `config/entitlements.json` by `scripts/build-entitlements-doc.mjs`. **Do not edit by hand**; change the config and re-run `npm run entitlements:doc`.

Upstream contract: LHBUSA/UFC@main `c2eaa8f571`, API version `2026-09-11.1`, Fight DNA definition version 1.

## Rules

1. The gateway exposes **only** the endpoints listed here. Any other `/v1/*` path is `404 route_not_found` at the gateway, without an upstream call.
2. A plan is entitled to an endpoint when its feature list contains the endpoint's feature. Higher plans are strict supersets of lower plans (tested).
3. Parameter gates deny specific query values (`403 plan_required` with `error.detail.parameter`) even when the base endpoint is allowed.
4. `first_party` and `internal` keys are never metered and are entitled to everything. They are issued only by the admin API (never self-serve).
5. `wire` (third-party headlines) is not sold on self-serve plans pending rights review (see `docs/UFC_API_COMMERCIAL_RIGHTS_MATRIX.md`).

## Plans, quotas and limits (initial configurable values)

| Plan | Price | Included requests / month (direct) | Requests / minute | Concurrency (reserved) | Limit mode | RapidAPI quota / min |
| --- | --- | --- | --- | --- | --- | --- |
| Developer | $79/mo | 25,000 | 60 | 4 | hard | 20,000 / 60 |
| Pro | $199/mo | 100,000 | 180 | 8 | hard | 80,000 / 180 |
| Ultra | $499/mo | 500,000 | 600 | 16 | hard | 400,000 / 600 |
| Scale | $1499/mo | 2,000,000 | 1200 | 32 | soft | 1,500,000 / 1200 |
| Enterprise | Let's talk | custom | custom | custom | custom | n/a |

`limit_mode`: **hard** = `429 quota_exceeded` at the quota; **soft** = allowed past the quota with `X-Quota-Status: over-quota-soft` (Scale, reviewed manually until metered billing exists); **custom** = per-contract; **none** = unmetered. Overage billing is architected (`overage.enabled`, `price_usd_per_1k`) but disabled on every plan. Concurrency limits are recorded in config but not enforced in v1.

## Features

| Feature | Meaning | Minimum plan |
| --- | --- | --- |
| `core` | Core UFC data: normalized, source-backed facts (events, cards, fighters, bouts, results, rankings, official weigh-ins, sourced availability and card changes) | Developer |
| `editorial` | PropBetEdge editorial | Developer |
| `media_metadata` | Fighter image metadata with license and attribution | Developer |
| `video_metadata` | Official video metadata: ids, official URLs, channel, links (no rehosting) | Developer |
| `dna_registry` | Fight DNA metric registry: definitions, confidence tiers, as-of semantics (definitions only, no values) | Developer |
| `round_stats_deep` | Computed career rates and per-bout round aggregates | Pro |
| `dna_fighter` | Fighter Fight DNA: stance, striking, grappling, finish, round, context | Pro |
| `dna_as_of` | As-of reconstruction of fighter snapshots (?as_of=) | Pro |
| `dna_matchup` | Matchup DNA: fighter-vs-fighter comparisons, stance context, threshold-gated insights | Ultra |
| `dna_query` | Cross-fighter Fight DNA query | Ultra |
| `fight_week` | Fight State Ledger and event intelligence (proprietary derived state) | Ultra |
| `bulk_media_lookup` | Bulk media lookups at Scale volumes | Scale |
| `wire` | Third-party headline wire (REVIEW REQUIRED; not on self-serve plans) | Enterprise |
| `priority_support` | Priority support (not an endpoint) | Scale |
| `custom` | Custom endpoints (Enterprise only) | Enterprise |

## Endpoint × plan

| Endpoint | Origin | Feature | Developer | Pro | Ultra | Scale | Enterprise | First-party | Minimum plan |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `GET /v1/ufc` | SOURCE_FACT | core | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | Developer |
| `GET /v1/ufc/events` | SOURCE_FACT | core | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | Developer |
| `GET /v1/ufc/events/{id}` | SOURCE_FACT | core | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | Developer |
| `GET /v1/ufc/events/{id}/card` | SOURCE_FACT | core | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | Developer |
| `GET /v1/ufc/events/{id}/articles` | EDITORIAL | editorial | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | Developer |
| `GET /v1/ufc/events/{id}/videos` | THIRD_PARTY_LINK | video_metadata | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | Developer |
| `GET /v1/ufc/events/{id}/intelligence` | PBE_DERIVED | fight_week | — | — | ✔ | ✔ | ✔ | ✔ | Ultra |
| `GET /v1/ufc/fighters` | SOURCE_FACT | core | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | Developer |
| `GET /v1/ufc/fighters/media` | MEDIA | media_metadata | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | Developer |
| `GET /v1/ufc/fighters/{id}` | SOURCE_FACT | core | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | Developer |
| `GET /v1/ufc/fighters/{id}/history` | SOURCE_FACT | core | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | Developer |
| `GET /v1/ufc/fighters/{id}/stats` | PBE_DERIVED | round_stats_deep | — | ✔ | ✔ | ✔ | ✔ | ✔ | Pro |
| `GET /v1/ufc/fighters/{id}/articles` | EDITORIAL | editorial | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | Developer |
| `GET /v1/ufc/fighters/{id}/videos` | THIRD_PARTY_LINK | video_metadata | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | Developer |
| `GET /v1/ufc/fighters/{id}/dna` | PBE_DERIVED | dna_fighter | — | ✔ | ✔ | ✔ | ✔ | ✔ | Pro |
| `GET /v1/ufc/fighters/{id}/splits` | PBE_DERIVED | dna_fighter | — | ✔ | ✔ | ✔ | ✔ | ✔ | Pro |
| `GET /v1/ufc/fighters/{id}/round-profile` | PBE_DERIVED | dna_fighter | — | ✔ | ✔ | ✔ | ✔ | ✔ | Pro |
| `GET /v1/ufc/fighters/{id}/finish-profile` | PBE_DERIVED | dna_fighter | — | ✔ | ✔ | ✔ | ✔ | ✔ | Pro |
| `GET /v1/ufc/fighters/{id}/position-profile` | LICENSED | dna_fighter | — | ✔ | ✔ | ✔ | ✔ | ✔ | Pro |
| `GET /v1/ufc/bouts/{id}` | SOURCE_FACT | core | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | Developer |
| `GET /v1/ufc/bouts/{id}/stats` | SOURCE_FACT | core | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | Developer |
| `GET /v1/ufc/bouts/{id}/videos` | THIRD_PARTY_LINK | video_metadata | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | Developer |
| `GET /v1/ufc/bouts/{id}/ledger` | PBE_DERIVED | fight_week | — | — | ✔ | ✔ | ✔ | ✔ | Ultra |
| `GET /v1/ufc/matchups/{fighterA}/{fighterB}/dna` | PBE_DERIVED | dna_matchup | — | — | ✔ | ✔ | ✔ | ✔ | Ultra |
| `GET /v1/ufc/results` | SOURCE_FACT | core | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | Developer |
| `GET /v1/ufc/rankings` | SOURCE_FACT | core | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | Developer |
| `GET /v1/ufc/weigh-ins` | SOURCE_FACT | core | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | Developer |
| `GET /v1/ufc/events/{id}/weigh-ins` | SOURCE_FACT | core | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | Developer |
| `GET /v1/ufc/injuries` | SOURCE_FACT | core | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | Developer |
| `GET /v1/ufc/events/{id}/card-changes` | SOURCE_FACT | core | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | Developer |
| `GET /v1/ufc/fighters/{id}/status` | SOURCE_FACT | core | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | Developer |
| `GET /v1/ufc/news` | EDITORIAL | editorial | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | Developer |
| `GET /v1/ufc/articles/{slug}` | EDITORIAL | editorial | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | Developer |
| `GET /v1/ufc/wire` | THIRD_PARTY_LINK | wire | — | — | — | — | ✔ | ✔ | Enterprise |
| `GET /v1/ufc/search` | SOURCE_FACT | core | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | Developer |
| `GET /v1/ufc/counts` | SOURCE_FACT | core | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | Developer |
| `GET /v1/ufc/videos` | THIRD_PARTY_LINK | video_metadata | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | Developer |
| `GET /v1/ufc/dna/metrics` | PBE_DERIVED | dna_registry | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | Developer |
| `GET /v1/ufc/dna/query` | PBE_DERIVED | dna_query | — | — | ✔ | ✔ | ✔ | ✔ | Ultra |

## Parameter gates

| Endpoint | Parameter | Feature | Minimum plan | Note |
| --- | --- | --- | --- | --- |
| `/v1/ufc/events/{id}/card` | `include=stats` | round_stats_deep | Pro | adds round_stats[] and stat_totals to every bout |
| `/v1/ufc/fighters/{id}` | `include=stats` | round_stats_deep | Pro | adds computed career rates to the fighter composite |
| `/v1/ufc/fighters/{id}/dna` | `as_of=…` | dna_as_of | Pro | historical as-of reconstruction |
| `/v1/ufc/fighters/{id}/splits` | `as_of=…` | dna_as_of | Pro | historical as-of reconstruction |
| `/v1/ufc/fighters/{id}/round-profile` | `as_of=…` | dna_as_of | Pro | historical as-of reconstruction |
| `/v1/ufc/fighters/{id}/finish-profile` | `as_of=…` | dna_as_of | Pro | historical as-of reconstruction |
| `/v1/ufc/fighters/{id}/position-profile` | `as_of=…` | dna_as_of | Pro | historical as-of reconstruction |

## Channels

| Channel | Who | Entitlement source | Metering |
| --- | --- | --- | --- |
| `direct` | PropTechUSA direct customers | key record plan (+ per-key overrides) | gateway: per-minute + monthly, hard/soft per plan |
| `rapidapi` | RapidAPI subscribers | `X-RapidAPI-Subscription` → `config/rapidapi.json` mapping | RapidAPI bills and enforces quota; gateway enforces the per-minute backstop and attributes usage |
| `enterprise` | contract customers | key record (plan `enterprise`, custom overrides) | per contract (`limit_mode: custom`) |
| `first_party` | PropBetEdge consumer products | key record plan `first_party` | none |
| `internal` | smoke tests, monitoring | key record plan `internal` | rate backstop only |
