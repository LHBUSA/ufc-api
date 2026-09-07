# Observability

Every gateway request writes one Analytics Engine data point to dataset `ufc_api_usage` (`gateway/src/telemetry.js`). No request bodies, no raw keys, no customer PII.

| Field | Column | Meaning |
| --- | --- | --- |
| index1 | `subject` | key id, `rapidapi:<user>`, or `anonymous` |
| blob1 | `request_id` | gateway request id |
| blob2 | `channel` | direct / rapidapi / enterprise / first_party / internal |
| blob3 | `plan` | developer / pro / ultra / scale / enterprise / first_party / internal |
| blob4 | `key_id` | direct key id (empty for RapidAPI) |
| blob5 | `route_key` | entitlement endpoint key (e.g. `fighter_dna`, `matchup_dna`) |
| blob6 | `method` | GET / HEAD |
| blob7 | `status_class` | 2xx / 4xx / 5xx |
| blob8 | `cache_status` | upstream CF-Cache-Status when present |
| blob9 | `colo` | Cloudflare colo |
| blob10 | `rapidapi_user` | RapidAPI subscriber |
| blob11 | `rapidapi_subscription` | RapidAPI plan name |
| blob12 | `denied_reason` | api_key_required / invalid_api_key / plan_required / rate_limited / quota_exceeded / … |
| blob13 | `path_template` | entitlement path template |
| double1 | `status` | HTTP status |
| double2 | `latency_ms` | gateway total |
| double3 | `upstream_latency_ms` | canonical API time |
| double4 | `allowed` | 1 / 0 |

Query with the Analytics Engine SQL API (`POST https://api.cloudflare.com/client/v4/accounts/<account>/analytics_engine/sql`, bearer token with Analytics read).

```sql
-- who is using the API (last 7 days)
SELECT blob2 AS channel, blob3 AS plan, index1 AS subject, SUM(_sample_interval) AS requests
FROM ufc_api_usage WHERE timestamp > NOW() - INTERVAL '7' DAY
GROUP BY channel, plan, subject ORDER BY requests DESC LIMIT 50;

-- popular endpoints
SELECT blob5 AS route, SUM(_sample_interval) AS requests, AVG(double2) AS avg_ms
FROM ufc_api_usage WHERE timestamp > NOW() - INTERVAL '7' DAY GROUP BY route ORDER BY requests DESC;

-- errors and denials
SELECT blob7 AS status_class, blob12 AS denied_reason, SUM(_sample_interval) AS n
FROM ufc_api_usage WHERE timestamp > NOW() - INTERVAL '1' DAY GROUP BY status_class, denied_reason ORDER BY n DESC;

-- upgrade signals: plan_required denials per key, by required surface
SELECT index1 AS subject, blob3 AS plan, blob5 AS route, SUM(_sample_interval) AS denied
FROM ufc_api_usage WHERE blob12 = 'plan_required' AND timestamp > NOW() - INTERVAL '30' DAY
GROUP BY subject, plan, route ORDER BY denied DESC;

-- RapidAPI analytics: requests by subscriber and plan, Fight DNA / Matchup DNA usage, error rate
SELECT blob10 AS rapidapi_user, blob11 AS subscription,
       SUM(_sample_interval) AS requests,
       SUM(IF(blob5 IN ('fighter_dna','fighter_splits','fighter_round_profile','fighter_finish_profile','fighter_position_profile'), _sample_interval, 0)) AS fight_dna,
       SUM(IF(blob5 = 'matchup_dna', _sample_interval, 0)) AS matchup_dna,
       SUM(IF(blob7 <> '2xx', _sample_interval, 0)) / SUM(_sample_interval) AS error_rate
FROM ufc_api_usage WHERE blob2 = 'rapidapi' AND timestamp > NOW() - INTERVAL '30' DAY
GROUP BY rapidapi_user, subscription ORDER BY requests DESC;
```

Per-key exact counters (month, minute, denials, recent requests) live in the key's Durable Object: `GET /admin/keys/<id>` or `GET /admin/usage/<subject>` with the admin token, and `GET /dashboard/api/me` for the customer. Worker logs (`observability.enabled = true`) carry unhandled errors with the request id; `npx wrangler tail --env production` streams them.
