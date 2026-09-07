/* Dashboard API (same-origin, key-scoped). The dashboard page authenticates with the customer's API key;
 * there is no separate account system yet. Secrets are only ever returned by /rotate (once) and by /checkout
 * (the purchaser's one-time reveal, keyed by the Stripe Checkout Session id). */
import { GATEWAY, PLANS } from "./config.js";
import { authenticateDirect } from "./auth.js";
import { GatewayError, ok } from "./envelope.js";
import { effectiveLimits, loadCustomer, publicKeyView, saveKeyRecord } from "./keys.js";
import { issueKey } from "./admin.js";
import { usageStub } from "./usage.js";
import { planFeatures } from "./entitlements.js";
import { billingForKey, checkoutState, portalSession } from "./stripe.js";
import billing from "../../config/billing.json" with { type: "json" };
import upstreamContract from "../../upstream/ufc-contract.json" with { type: "json" };

async function guardDashboardRate(env, subject) {
  const d = await usageStub(env, subject).hit({ limits: { rate_limit_per_min: GATEWAY.dashboard_rate_limit_per_min, included_requests: null, limit_mode: "none" }, scope: "dashboard" });
  if (!d.allowed) throw new GatewayError(429, "rate_limited", "Too many dashboard requests.", { retry_after_seconds: Math.max(1, d.minute.reset - Math.floor(Date.now() / 1000)) }, { "Retry-After": String(Math.max(1, d.minute.reset - Math.floor(Date.now() / 1000))) });
}

export async function dashboardRouter(request, env, ctx, url) {
  const path = url.pathname.replace(/\/+$/, "");

  /* Post-checkout state: authenticated by the Checkout Session id (only the purchaser has it). Rate-limited per session id. */
  if (path === "/dashboard/api/checkout" && request.method === "GET") {
    const sessionId = url.searchParams.get("session_id") || "";
    await guardDashboardRate(env, `checkout:${sessionId.slice(0, 40)}`);
    return ok(ctx, await checkoutState(env, sessionId), { self_serve_checkout: billing.self_serve_checkout }, {}, "private");
  }

  const identity = await authenticateDirect(request, env);
  await guardDashboardRate(env, identity.subject);
  const record = identity.record;
  const plan = PLANS.plans[record.plan];
  const limits = effectiveLimits(record);

  if (path === "/dashboard/api/me" && request.method === "GET") {
    const usage = await usageStub(env, record.id).summary({ recent: 25 });
    const customer = record.customer_id ? await loadCustomer(env, record.customer_id) : null;
    const bill = await billingForKey(env, record);
    return ok(ctx, {
      key: { id: record.id, display: record.display, label: record.label, plan: record.plan, channel: record.channel, status: record.status, created_at: record.created_at, expires_at: record.expires_at, rotated_from: record.rotated_from, last_used_at: usage.last_used_at },
      customer: customer ? { id: customer.id, name: customer.name, keys: customer.keys.length } : null,
      plan: { key: record.plan, name: plan.name, price_usd_month: plan.price_usd_month, tagline: plan.tagline, features: [...planFeatures(record.plan)], limits },
      billing: bill,
      usage: {
        month: usage.month, used: usage.month_used, quota: limits.included_requests, remaining: limits.included_requests === null ? null : Math.max(0, limits.included_requests - usage.month_used),
        limit_mode: limits.limit_mode, month_reset: usage.month_reset, minute: { limit: limits.rate_limit_per_min, used: usage.minute_used, reset: usage.minute_reset },
        months: usage.months, denied: usage.denied,
      },
      recent_requests: usage.recent,
      api: { version: upstreamContract.api_version, gateway_version: GATEWAY.gateway_version, fight_dna_definition_version: upstreamContract.fight_dna_definition_version, base_url: env.PUBLIC_HOST || GATEWAY.commercial_host },
      links: { docs: "/docs", pricing: "/pricing", openapi: "/openapi.json", support: `mailto:${GATEWAY.support_email}` },
    }, {}, {}, "private");
  }

  if (path === "/dashboard/api/rotate" && request.method === "POST") {
    const issued = await issueKey(env, { customer_id: record.customer_id, plan: record.plan, channel: record.channel, label: record.label, expires_at: record.expires_at, overrides: record.overrides, rotated_from: record.id });
    record.status = "revoked"; record.rotated_to = issued.record.id; record.revoked_at = new Date().toISOString();
    await saveKeyRecord(env, record);
    /* carry the billing link to the new key so Stripe events keep updating the right entitlement */
    if (record.billing) {
      const fresh = await env.API_KEYS.get(`key:${issued.record.id}`, { type: "json" });
      fresh.billing = record.billing; await saveKeyRecord(env, fresh);
      const cus = record.billing.stripe_customer_id;
      const bill = cus ? await env.API_KEYS.get(`stripe_customer:${cus}`, { type: "json" }) : null;
      if (bill) { bill.api_key_id = issued.record.id; bill.updated_at = new Date().toISOString(); await env.API_KEYS.put(`stripe_customer:${cus}`, JSON.stringify(bill)); }
    }
    return ok(ctx, { key: issued.key, record: issued.record, previous: publicKeyView(record), warning: "Store the new key now. The old key stopped working immediately." }, {}, {}, "private");
  }

  if (path === "/dashboard/api/portal" && request.method === "POST") {
    const returnUrl = (env.PUBLIC_HOST || GATEWAY.commercial_host).replace(/\/$/, "") + billing.customer_portal.return_path;
    return ok(ctx, await portalSession(env, record, returnUrl), {}, {}, "private");
  }

  throw new GatewayError(404, "route_not_found", "Dashboard route not found.");
}
