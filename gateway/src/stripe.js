/* Stripe billing: signature-verified webhook → idempotent provisioning into the key store; Customer Portal sessions.
 *
 *   pricing page → Stripe-hosted Payment Link → subscription → POST /webhooks/stripe → key issuance / entitlement → dashboard
 *
 * KV records (namespace API_KEYS):
 *   stripe_event:<evt_id>        processed marker (idempotency, TTL)
 *   stripe_customer:<cus_id>     BillingRecord {stripe_customer_id, stripe_subscription_id, stripe_price_id, plan, subscription_status,
 *                                billing_state, current_period_end, cancel_at_period_end, api_key_id, customer_id, email, ...}
 *   checkout_session:<cs_id>     {stripe_customer_id, stripe_subscription_id, email, created_at}  (dashboard success lookup)
 *   pending_key:<cus_id>         raw key, revealed ONCE to the purchaser via the checkout session, then deleted (TTL)
 * Price id is the entitlement signal; metadata.plan is a consistency check. Disagreement → fail closed (review_required).
 */
import billing from "../../config/billing.json" with { type: "json" };
import { PLANS } from "./config.js";
import { GatewayError, ok } from "./envelope.js";
import { issueKey } from "./admin.js";
import { constantTimeEqual, loadCustomer, loadKeyRecord, saveCustomer, saveKeyRecord } from "./keys.js";

export const PRICE_TO_PLAN = billing.price_to_plan;
const WHITELIST = new Set(billing.metadata_plan_whitelist);
const POLICY = billing.status_policy;

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Verify a Stripe-Signature header against the raw body. Returns true/false; never throws on malformed input. */
export async function verifyStripeSignature(rawBody, header, secret, nowSeconds = Math.floor(Date.now() / 1000), tolerance = billing.webhook.tolerance_seconds) {
  if (!header || !secret) return false;
  const parts = Object.create(null);
  for (const kv of header.split(",")) { const [k, v] = kv.split("=").map((s) => s && s.trim()); if (!k || !v) continue; (parts[k] = parts[k] || []).push(v); }
  const t = parts.t && parts.t[0];
  const v1s = parts.v1 || [];
  if (!t || !/^\d+$/.test(t) || !v1s.length) return false;
  if (Math.abs(nowSeconds - Number(t)) > tolerance) return false;
  const expected = await hmacHex(secret, `${t}.${rawBody}`);
  return v1s.some((sig) => constantTimeEqual(sig, expected));
}

/** Resolve the plan from a subscription: price id is authoritative; metadata.plan must agree if present. */
export function planFromSubscription(sub) {
  const items = sub?.items?.data || [];
  const priceIds = [...new Set(items.map((i) => i?.price?.id).filter(Boolean))];
  if (priceIds.length !== 1) return { plan: null, price_id: priceIds[0] || null, reason: priceIds.length ? "multiple_prices" : "no_price" };
  const price_id = priceIds[0];
  const plan = PRICE_TO_PLAN[price_id] || null;
  if (!plan) return { plan: null, price_id, reason: "unknown_price" };
  const meta = (sub.metadata && sub.metadata.plan) ? String(sub.metadata.plan).toLowerCase() : null;
  if (meta && (!WHITELIST.has(meta) || meta !== plan)) return { plan: null, price_id, reason: "metadata_price_mismatch", metadata_plan: meta, price_plan: plan };
  return { plan, price_id, reason: null };
}

export function periodEnd(sub) {
  const v = sub?.current_period_end ?? sub?.items?.data?.[0]?.current_period_end ?? null;
  return v ? new Date(Number(v) * 1000).toISOString() : null;
}

export function policyFor(status) { return POLICY[status] || { key_status: null, billing_state: status || "unknown" }; }

export async function loadBilling(env, cus) { return env.API_KEYS.get(`stripe_customer:${cus}`, { type: "json" }); }
async function saveBilling(env, rec) { await env.API_KEYS.put(`stripe_customer:${rec.stripe_customer_id}`, JSON.stringify(rec)); }

/** Public billing view for the dashboard, from a key record. */
export async function billingForKey(env, keyRecord) {
  const cus = keyRecord?.billing?.stripe_customer_id;
  if (!cus) return null;
  const b = await loadBilling(env, cus);
  if (!b) return null;
  return { provider: "stripe", subscription_status: b.subscription_status, billing_state: b.billing_state, plan: b.plan, current_period_end: b.current_period_end, cancel_at_period_end: !!b.cancel_at_period_end, last_paid_at: b.last_paid_at || null, last_payment_failed_at: b.last_payment_failed_at || null, manage_available: !!env.STRIPE_SECRET_KEY && billing.customer_portal.enabled };
}

/**
 * Core provisioning. Idempotent: same subscription state applied twice yields the same records and no duplicate key.
 * Returns { action, plan, key_id, billing_state }.
 */
export async function applySubscription(env, sub, opts = {}) {
  const cus = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  if (!cus) return { action: "ignored_no_customer" };
  const now = new Date().toISOString();
  const existing = (await loadBilling(env, cus)) || { stripe_customer_id: cus, created_at: now, events: [] };
  const email = opts.email || existing.email || sub.metadata?.email || null;
  const resolved = planFromSubscription(sub);
  const base = { ...existing, stripe_subscription_id: sub.id, stripe_price_id: resolved.price_id, subscription_status: sub.status, cancel_at_period_end: !!sub.cancel_at_period_end, current_period_end: periodEnd(sub), email, updated_at: now, last_event: opts.event_type || null };

  if (!resolved.plan) {
    console.error(`[stripe] FAIL CLOSED: ${resolved.reason} for ${sub.id} (${cus})`, JSON.stringify({ price_id: resolved.price_id, metadata_plan: resolved.metadata_plan }));
    await saveBilling(env, { ...base, billing_state: "review_required", review_reason: resolved.reason, review_detail: { price_id: resolved.price_id, metadata_plan: resolved.metadata_plan || null, price_plan: resolved.price_plan || null } });
    return { action: "review_required", reason: resolved.reason };
  }
  const policy = policyFor(sub.status);
  const rec = { ...base, plan: resolved.plan, billing_state: policy.billing_state, review_reason: null, review_detail: null };

  if (policy.key_status === null) { await saveBilling(env, rec); return { action: "recorded_no_entitlement", billing_state: rec.billing_state, plan: rec.plan }; }

  let key = rec.api_key_id ? await loadKeyRecord(env, rec.api_key_id) : null;
  let action;
  if (key && key.status !== "revoked") {
    const changed = key.plan !== resolved.plan || key.status !== policy.key_status;
    key.plan = resolved.plan; key.status = policy.key_status; key.channel = "direct";
    key.billing = { ...(key.billing || {}), provider: "stripe", stripe_customer_id: cus, stripe_subscription_id: sub.id, stripe_price_id: resolved.price_id, billing_state: policy.billing_state, current_period_end: rec.current_period_end, cancel_at_period_end: rec.cancel_at_period_end };
    key.updated_at = now;
    await saveKeyRecord(env, key);
    action = changed ? "entitlement_updated" : "unchanged";
  } else {
    if (policy.key_status !== "active") { await saveBilling(env, rec); return { action: "no_key_inactive_status", billing_state: rec.billing_state, plan: rec.plan }; }
    const issued = await issueKey(env, { customer_id: rec.customer_id || undefined, customer_name: rec.customer_name || email || `Stripe ${cus}`, customer_email: email, plan: resolved.plan, channel: "direct", label: "stripe subscription", notes: `stripe_customer_id=${cus}`, key_notes: `stripe_subscription_id=${sub.id}` });
    key = await loadKeyRecord(env, issued.record.id);
    key.billing = { provider: "stripe", stripe_customer_id: cus, stripe_subscription_id: sub.id, stripe_price_id: resolved.price_id, billing_state: policy.billing_state, current_period_end: rec.current_period_end, cancel_at_period_end: rec.cancel_at_period_end };
    await saveKeyRecord(env, key);
    const customer = await loadCustomer(env, issued.customer.id);
    if (customer) { customer.stripe_customer_id = cus; await saveCustomer(env, customer); }
    rec.customer_id = issued.customer.id; rec.customer_name = issued.customer.name; rec.api_key_id = key.id;
    await env.API_KEYS.put(`pending_key:${cus}`, issued.key, { expirationTtl: billing.webhook.pending_key_ttl_seconds });
    action = "key_issued";
  }
  rec.api_key_id = key.id;
  await saveBilling(env, rec);
  return { action, plan: resolved.plan, key_id: key.id, billing_state: rec.billing_state };
}

async function stripeGet(env, path) {
  if (!env.STRIPE_SECRET_KEY) return null;
  const res = await fetch(`https://api.stripe.com/v1${path}`, { headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
  if (!res.ok) { console.error(`[stripe] GET ${path} → ${res.status}`); return null; }
  return res.json();
}

async function stripePost(env, path, form) {
  if (!env.STRIPE_SECRET_KEY) throw new GatewayError(503, "billing_not_configured", "Stripe is not configured on this gateway.");
  const res = await fetch(`https://api.stripe.com/v1${path}`, { method: "POST", headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form).toString() });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { console.error(`[stripe] POST ${path} → ${res.status}`, JSON.stringify(body.error || {})); throw new GatewayError(502, "billing_provider_error", "Stripe request failed.", { status: res.status }); }
  return body;
}

/** Route one verified event. */
export async function handleStripeEvent(env, event) {
  const type = event.type;
  const obj = event.data?.object || {};
  switch (type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      if (obj.mode && obj.mode !== "subscription") return { action: "ignored_non_subscription_checkout" };
      const cus = typeof obj.customer === "string" ? obj.customer : obj.customer?.id;
      const subId = typeof obj.subscription === "string" ? obj.subscription : obj.subscription?.id;
      const email = obj.customer_details?.email || obj.customer_email || null;
      if (obj.id) await env.API_KEYS.put(`checkout_session:${obj.id}`, JSON.stringify({ stripe_customer_id: cus || null, stripe_subscription_id: subId || null, email, payment_status: obj.payment_status || null, created_at: new Date().toISOString() }), { expirationTtl: billing.webhook.pending_key_ttl_seconds });
      if (type === "checkout.session.completed" && obj.payment_status && obj.payment_status !== "paid" && obj.payment_status !== "no_payment_required") return { action: "awaiting_async_payment" };
      if (!subId) return { action: "awaiting_subscription_event" };
      const sub = await stripeGet(env, `/subscriptions/${subId}`);
      if (!sub) return { action: "awaiting_subscription_event" };
      return applySubscription(env, sub, { email, event_type: type });
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
      return applySubscription(env, obj, { event_type: type });
    case "customer.subscription.deleted": {
      const cus = typeof obj.customer === "string" ? obj.customer : obj.customer?.id;
      const rec = cus ? await loadBilling(env, cus) : null;
      if (!rec) return { action: "ignored_unknown_customer" };
      rec.subscription_status = "canceled"; rec.billing_state = "ended"; rec.ended_at = new Date().toISOString(); rec.current_period_end = periodEnd(obj) || rec.current_period_end; rec.last_event = type; rec.updated_at = rec.ended_at;
      await saveBilling(env, rec);
      const key = rec.api_key_id ? await loadKeyRecord(env, rec.api_key_id) : null;
      if (key && key.status === "active") { key.status = "suspended"; key.billing = { ...(key.billing || {}), billing_state: "ended" }; key.updated_at = rec.updated_at; await saveKeyRecord(env, key); return { action: "access_disabled", key_id: key.id }; }
      return { action: "ended_no_active_key" };
    }
    case "invoice.paid": {
      const cus = typeof obj.customer === "string" ? obj.customer : obj.customer?.id;
      const rec = cus ? await loadBilling(env, cus) : null;
      if (!rec) return { action: "ignored_unknown_customer" };
      rec.last_paid_at = new Date().toISOString(); rec.last_invoice_id = obj.id || null; rec.last_event = type; rec.updated_at = rec.last_paid_at;
      if (rec.billing_state === "past_due") rec.billing_state = "active";
      await saveBilling(env, rec);
      return { action: "invoice_recorded", billing_state: rec.billing_state };
    }
    case "invoice.payment_failed": {
      const cus = typeof obj.customer === "string" ? obj.customer : obj.customer?.id;
      const rec = cus ? await loadBilling(env, cus) : null;
      if (!rec) return { action: "ignored_unknown_customer" };
      rec.billing_state = "past_due"; rec.last_payment_failed_at = new Date().toISOString(); rec.last_failed_invoice_id = obj.id || null; rec.last_event = type; rec.updated_at = rec.last_payment_failed_at;
      await saveBilling(env, rec);
      /* Key deliberately untouched: Stripe retries; suspension only follows the final subscription status (unpaid/canceled). */
      return { action: "marked_past_due", key_untouched: true };
    }
    default:
      return { action: "ignored_event_type" };
  }
}

export async function stripeWebhook(request, env, ctx) {
  if (!env.STRIPE_WEBHOOK_SECRET) throw new GatewayError(503, "billing_not_configured", "STRIPE_WEBHOOK_SECRET is not configured.");
  const raw = await request.text();
  const valid = await verifyStripeSignature(raw, request.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET);
  if (!valid) throw new GatewayError(400, "invalid_signature", "Stripe signature verification failed.");
  let event;
  try { event = JSON.parse(raw); } catch { throw new GatewayError(400, "invalid_json", "Webhook body is not JSON."); }
  if (!event || typeof event.id !== "string" || typeof event.type !== "string") throw new GatewayError(400, "invalid_event", "Not a Stripe event.");
  if (event.livemode === false && env.GATEWAY_ENV === "production" && env.STRIPE_ALLOW_TEST_EVENTS !== "true") return ok(ctx, { received: true, action: "ignored_test_mode_event", event: event.id }, {}, {}, "private");
  const seen = await env.API_KEYS.get(`stripe_event:${event.id}`);
  if (seen) return ok(ctx, { received: true, action: "duplicate_ignored", event: event.id }, {}, {}, "private");
  const result = await handleStripeEvent(env, event);
  await env.API_KEYS.put(`stripe_event:${event.id}`, JSON.stringify({ type: event.type, processed_at: new Date().toISOString(), action: result.action }), { expirationTtl: billing.webhook.processed_event_ttl_seconds });
  console.log(`[stripe] ${event.type} ${event.id} → ${result.action}`);
  return ok(ctx, { received: true, event: event.id, type: event.type, ...result }, {}, {}, "private");
}

/** Dashboard: state of a checkout session (the session id is the purchaser's credential; the key is revealed once). */
export async function checkoutState(env, sessionId) {
  if (!sessionId || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) throw new GatewayError(400, "invalid_session_id", "session_id must be a Stripe Checkout Session id.");
  const session = await env.API_KEYS.get(`checkout_session:${sessionId}`, { type: "json" });
  if (!session) return { status: "provisioning", session_known: false, message: "Your API access is being activated. Refresh in a moment." };
  const rec = session.stripe_customer_id ? await loadBilling(env, session.stripe_customer_id) : null;
  if (!rec) return { status: "provisioning", session_known: true, email: session.email, message: "Your API access is being activated. Refresh in a moment." };
  if (rec.billing_state === "review_required") return { status: "review_required", email: rec.email, message: "Your payment succeeded but the plan could not be confirmed automatically. We are reviewing it and will email you." };
  if (!rec.api_key_id) return { status: rec.billing_state === "incomplete" ? "incomplete" : "provisioning", plan: rec.plan || null, email: rec.email, message: "Your API access is being activated. Refresh in a moment." };
  const key = await loadKeyRecord(env, rec.api_key_id);
  const pending = await env.API_KEYS.get(`pending_key:${rec.stripe_customer_id}`);
  if (pending) await env.API_KEYS.delete(`pending_key:${rec.stripe_customer_id}`);
  return { status: "active", plan: rec.plan, plan_name: PLANS.plans[rec.plan]?.name || rec.plan, email: rec.email, key: pending || null, key_display: key?.display || null, key_id: key?.id || null, key_status: key?.status || null, billing_state: rec.billing_state, current_period_end: rec.current_period_end, revealed_before: !pending };
}

/** Dashboard: Stripe Customer Portal session for the key's customer. */
export async function portalSession(env, keyRecord, returnUrl) {
  if (!billing.customer_portal.enabled) throw new GatewayError(503, "billing_not_configured", "Customer Portal is disabled.");
  const cus = keyRecord?.billing?.stripe_customer_id;
  if (!cus) throw new GatewayError(404, "no_subscription", "This key is not linked to a Stripe subscription.");
  const session = await stripePost(env, "/billing_portal/sessions", { customer: cus, return_url: returnUrl });
  return { url: session.url };
}
