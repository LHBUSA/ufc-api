/* Authentication: direct API keys (KV), RapidAPI proxy traffic, admin token.
 * Produces one canonical identity regardless of channel so entitlement + metering code has a single path. */
import { PLANS, RAPIDAPI } from "./config.js";
import { GatewayError } from "./envelope.js";
import { constantTimeEqual, effectiveLimits, extractCredential, keyStatus, loadKeyRecord, parseKey, sha256Hex } from "./keys.js";

/**
 * @typedef Identity
 * @property {'direct'|'rapidapi'} kind
 * @property {string} subject        Durable Object name for metering (key id, or rapidapi:<user>)
 * @property {string|null} key_id
 * @property {string} plan
 * @property {string} channel        direct | rapidapi | enterprise | first_party | internal
 * @property {object} limits         effective limits (plan defaults + per-key overrides)
 * @property {boolean} enforce_quota
 * @property {boolean} enforce_rate
 * @property {object|null} record
 * @property {object} attribution    channel-specific analytics fields (rapidapi user / subscription)
 */

export async function authenticate(request, env) {
  if (RAPIDAPI.enabled && request.headers.has("x-rapidapi-proxy-secret")) return authenticateRapidApi(request, env);
  return authenticateDirect(request, env);
}

export async function authenticateDirect(request, env) {
  const raw = extractCredential(request);
  if (!raw) throw new GatewayError(401, "api_key_required", "An API key is required. Send `Authorization: Bearer <key>` or `X-API-Key: <key>`.", { docs: "/docs#authentication" });
  const parsed = parseKey(raw);
  if (!parsed) throw new GatewayError(401, "invalid_api_key", "The API key is invalid.");
  const record = await loadKeyRecord(env, parsed.key_id);
  if (!record) throw new GatewayError(401, "invalid_api_key", "The API key is invalid.");
  const hash = await sha256Hex(parsed.raw);
  if (!constantTimeEqual(hash, record.secret_hash)) throw new GatewayError(401, "invalid_api_key", "The API key is invalid.");
  const status = keyStatus(record);
  if (status === "expired") throw new GatewayError(401, "api_key_expired", "The API key has expired.", { expires_at: record.expires_at });
  if (status === "suspended") throw new GatewayError(401, "api_key_suspended", "The API key is suspended because its subscription is not active. Manage your subscription in the dashboard.", { billing_state: record.billing?.billing_state || null });
  if (status !== "active") throw new GatewayError(401, "api_key_revoked", "The API key has been revoked.");
  if (!PLANS.plans[record.plan]) throw new GatewayError(403, "plan_required", "The key's plan is not recognised.", { plan: record.plan });
  const limits = effectiveLimits(record);
  const channel = record.channel || "direct";
  const metered = !(channel === "first_party" || channel === "internal") && limits.limit_mode !== "none";
  return {
    kind: "direct", subject: record.id, key_id: record.id, plan: record.plan, channel, limits, record,
    enforce_quota: metered, enforce_rate: metered || limits.rate_limit_per_min !== null, customer_id: record.customer_id || null,
    attribution: {},
  };
}

/** RapidAPI adapter: trust only the proxy secret, then map subscriber + subscription to the canonical entitlement. */
export async function authenticateRapidApi(request, env) {
  const supplied = request.headers.get("x-rapidapi-proxy-secret") || "";
  if (!env.RAPIDAPI_PROXY_SECRET) throw new GatewayError(503, "rapidapi_not_configured", "RapidAPI distribution is not enabled on this gateway.");
  if (!constantTimeEqual(supplied, env.RAPIDAPI_PROXY_SECRET)) throw new GatewayError(401, "invalid_rapidapi_proxy_secret", "The RapidAPI proxy secret is invalid.");
  const user = (request.headers.get("x-rapidapi-user") || "").trim();
  const subscription = (request.headers.get("x-rapidapi-subscription") || "").trim();
  if (!user || !subscription) throw new GatewayError(401, "rapidapi_headers_missing", "X-RapidAPI-User and X-RapidAPI-Subscription are required.", { required: RAPIDAPI.required_headers });
  const plan = RAPIDAPI.subscription_to_plan[subscription.toUpperCase()] || null;
  if (!plan || !PLANS.plans[plan]) throw new GatewayError(403, "rapidapi_plan_unmapped", "This RapidAPI subscription is not mapped to a plan.", { subscription, mapped: Object.keys(RAPIDAPI.subscription_to_plan) });
  const p = PLANS.plans[plan];
  const mp = RAPIDAPI.marketplace_plans[plan] || {};
  const limits = { plan, included_requests: mp.requests_per_month ?? p.included_requests, rate_limit_per_min: mp.rate_limit_per_min ?? p.rate_limit_per_min, limit_mode: p.limit_mode, concurrency_limit: p.concurrency_limit };
  return {
    kind: "rapidapi", subject: `rapidapi:${user}`, key_id: null, plan, channel: "rapidapi", limits, record: null,
    enforce_quota: RAPIDAPI.enforce_monthly_quota_at_gateway === true, enforce_rate: RAPIDAPI.enforce_rate_limit_at_gateway !== false, customer_id: null,
    attribution: { rapidapi_user: user, rapidapi_subscription: subscription, rapidapi_host: request.headers.get("x-rapidapi-host") || null, rapidapi_version: request.headers.get("x-rapidapi-version") || null },
  };
}

export function requireAdmin(request, env) {
  if (!env.ADMIN_TOKEN) throw new GatewayError(503, "admin_not_configured", "ADMIN_TOKEN is not configured.");
  const supplied = extractCredential(request);
  if (!supplied || !constantTimeEqual(supplied, env.ADMIN_TOKEN)) throw new GatewayError(401, "admin_unauthorized", "Admin token required.");
  return true;
}
