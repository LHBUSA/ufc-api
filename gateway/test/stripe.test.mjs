/* Stripe webhook + provisioning tests with signed fixture events (no live Stripe calls). */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { verifyStripeSignature, planFromSubscription } from "../src/stripe.js";
import billing from "../../config/billing.json" with { type: "json" };
import { execCtx, makeEnv } from "./fakes.mjs";
import fighterDna from "../../upstream/fixtures/fighter_dna.json" with { type: "json" };

const SECRET = "whsec_test_secret";
const S = "ec94d296-2db3-4e0d-be6a-46de4f480672", D = "9a3b2a15-27d8-4554-9217-42ef2dd5d25c";
const PRICE = Object.fromEntries(Object.entries(billing.price_to_plan).map(([id, plan]) => [plan, id]));
let counter = 0;
const evtId = () => `evt_${String(++counter).padStart(6, "0")}`;

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function signed(env, event, { secret = SECRET, t = Math.floor(Date.now() / 1000) } = {}) {
  const body = JSON.stringify(event);
  const sig = `t=${t},v1=${await hmac(secret, `${t}.${body}`)}`;
  const res = await worker.fetch(new Request("https://gateway.test/webhooks/stripe", { method: "POST", headers: { "stripe-signature": sig, "content-type": "application/json" }, body }), env, execCtx);
  return { status: res.status, body: await res.json() };
}
const sub = (id, cus, plan, { status = "active", cancel_at_period_end = false, metadata = {}, priceId } = {}) => ({ id, object: "subscription", customer: cus, status, cancel_at_period_end, current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400, metadata, items: { data: [{ price: { id: priceId || PRICE[plan] } }] } });
const event = (type, object, id = evtId()) => ({ id, object: "event", type, livemode: true, data: { object } });
const req = (path, headers = {}, method = "GET") => new Request("https://gateway.test" + path, { method, headers });
const bearer = (k) => ({ authorization: `Bearer ${k}` });

const subs = {};
const realFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = async (url, init) => {
    const u = new URL(url);
    if (u.host === "api.stripe.com") {
      const m = u.pathname.match(/^\/v1\/subscriptions\/(.+)$/);
      if (m) return new Response(JSON.stringify(subs[m[1]] || { error: { message: "no such subscription" } }), { status: subs[m[1]] ? 200 : 404, headers: { "content-type": "application/json" } });
      if (u.pathname === "/v1/billing_portal/sessions") { const form = new URLSearchParams(init.body); return new Response(JSON.stringify({ url: `https://billing.stripe.com/p/session/test_${form.get("customer")}`, return_url: form.get("return_url") }), { status: 200, headers: { "content-type": "application/json" } }); }
      return new Response("{}", { status: 404 });
    }
    if (u.host === "upstream.test") return new Response(JSON.stringify(u.pathname.includes("/matchups/") ? { ok: true, data: { comparisons: [] }, meta: {} } : u.pathname.endsWith("/dna") ? fighterDna.body : { ok: true, data: { fighters: 1 }, meta: {} }), { status: 200, headers: { "content-type": "application/json; charset=utf-8", "x-api-version": "2026-09-06.3", "x-request-id": "up-1", "cache-control": "public, max-age=60" } });
    return new Response("{}", { status: 500 });
  };
});
after(() => { globalThis.fetch = realFetch; });

const stripeEnv = (over = {}) => makeEnv({ STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_SECRET_KEY: "sk_test_x", ...over });

test("signature verification: valid, tampered, stale, missing secret", async () => {
  const body = '{"id":"evt_1","type":"x"}';
  const t = Math.floor(Date.now() / 1000);
  const good = `t=${t},v1=${await hmac(SECRET, `${t}.${body}`)}`;
  assert.equal(await verifyStripeSignature(body, good, SECRET), true);
  assert.equal(await verifyStripeSignature(body + " ", good, SECRET), false);
  assert.equal(await verifyStripeSignature(body, good, "whsec_other"), false);
  assert.equal(await verifyStripeSignature(body, `t=${t - 1000},v1=${await hmac(SECRET, `${t - 1000}.${body}`)}`, SECRET), false, "outside tolerance");
  assert.equal(await verifyStripeSignature(body, good, ""), false);
  assert.equal(await verifyStripeSignature(body, "garbage", SECRET), false);
  const env = stripeEnv();
  const bad = await worker.fetch(new Request("https://gateway.test/webhooks/stripe", { method: "POST", headers: { "stripe-signature": "t=1,v1=00" }, body }), env, execCtx);
  assert.equal(bad.status, 400); assert.equal((await bad.json()).error.code, "invalid_signature");
  const nosec = await worker.fetch(new Request("https://gateway.test/webhooks/stripe", { method: "POST", body }), makeEnv(), execCtx);
  assert.equal(nosec.status, 503);
  assert.equal((await worker.fetch(req("/webhooks/stripe"), env, execCtx)).status, 405);
});

test("price → plan whitelist; metadata must agree; unknown price fails closed", () => {
  assert.equal(planFromSubscription(sub("s", "c", "pro")).plan, "pro");
  assert.equal(planFromSubscription(sub("s", "c", "pro", { metadata: { plan: "pro" } })).plan, "pro");
  const mm = planFromSubscription(sub("s", "c", "pro", { metadata: { plan: "ultra" } }));
  assert.equal(mm.plan, null); assert.equal(mm.reason, "metadata_price_mismatch");
  assert.equal(planFromSubscription(sub("s", "c", "pro", { priceId: "price_unknown" })).reason, "unknown_price");
  assert.equal(planFromSubscription(sub("s", "c", "pro", { metadata: { plan: "enterprise" } })).plan, null, "enterprise is never self-serve");
});

test("Developer purchase: checkout.session.completed → subscription fetched → Developer key issued, revealed once via session", async () => {
  const env = stripeEnv();
  subs.sub_dev = sub("sub_dev", "cus_dev", "developer", { metadata: { plan: "developer" } });
  const r = await signed(env, event("checkout.session.completed", { id: "cs_test_dev", object: "checkout.session", mode: "subscription", customer: "cus_dev", subscription: "sub_dev", payment_status: "paid", customer_details: { email: "dev@example.test" } }));
  assert.equal(r.status, 200); assert.equal(r.body.data.action, "key_issued"); assert.equal(r.body.data.plan, "developer");
  const st = await (await worker.fetch(req("/dashboard/api/checkout?session_id=cs_test_dev"), env, execCtx)).json();
  assert.equal(st.data.status, "active"); assert.match(st.data.key, /^pt_ufc_live_/); assert.equal(st.data.plan, "developer"); assert.equal(st.data.email, "dev@example.test");
  const again = await (await worker.fetch(req("/dashboard/api/checkout?session_id=cs_test_dev"), env, execCtx)).json();
  assert.equal(again.data.key, null); assert.equal(again.data.revealed_before, true);
  const api = await worker.fetch(req("/v1/ufc/counts", bearer(st.data.key)), env, execCtx);
  assert.equal(api.status, 200); assert.equal(api.headers.get("x-plan"), "developer"); assert.equal(api.headers.get("x-quota-limit"), "25000");
  const dna = await worker.fetch(req(`/v1/ufc/fighters/${S}/dna`, bearer(st.data.key)), env, execCtx);
  assert.equal(dna.status, 403);
  const me = await (await worker.fetch(req("/dashboard/api/me", bearer(st.data.key)), env, execCtx)).json();
  assert.equal(me.data.billing.subscription_status, "active"); assert.equal(me.data.billing.plan, "developer"); assert.ok(me.data.billing.current_period_end);
  const unknown = await (await worker.fetch(req("/dashboard/api/checkout?session_id=cs_nope"), env, execCtx)).json();
  assert.equal(unknown.data.status, "provisioning");
});

test("Pro / Ultra / Scale purchases via subscription.created → correct entitlements", async () => {
  const env = stripeEnv();
  const keyFor = async (plan) => { const r = await signed(env, event("customer.subscription.created", sub(`sub_${plan}`, `cus_${plan}`, plan))); assert.equal(r.body.data.action, "key_issued"); return env.API_KEYS.get(`pending_key:cus_${plan}`); };
  const pro = await keyFor("pro"), ultra = await keyFor("ultra"), scale = await keyFor("scale");
  assert.equal((await worker.fetch(req(`/v1/ufc/fighters/${S}/dna`, bearer(pro)), env, execCtx)).status, 200, "pro → Fight DNA");
  assert.equal((await worker.fetch(req(`/v1/ufc/matchups/${S}/${D}/dna`, bearer(pro)), env, execCtx)).status, 403);
  assert.equal((await worker.fetch(req(`/v1/ufc/matchups/${S}/${D}/dna`, bearer(ultra)), env, execCtx)).status, 200, "ultra → Matchup DNA");
  const sc = await worker.fetch(req("/v1/ufc/counts", bearer(scale)), env, execCtx);
  assert.equal(sc.headers.get("x-quota-limit"), "2000000"); assert.equal(sc.headers.get("x-plan"), "scale");
});

test("idempotency: duplicate event id ignored; replayed state → no duplicate key", async () => {
  const env = stripeEnv();
  const ev = event("customer.subscription.created", sub("sub_i", "cus_i", "pro"));
  const a = await signed(env, ev); assert.equal(a.body.data.action, "key_issued");
  const b = await signed(env, ev); assert.equal(b.body.data.action, "duplicate_ignored");
  const c = await signed(env, event("customer.subscription.updated", sub("sub_i", "cus_i", "pro"))); assert.equal(c.body.data.action, "unchanged");
  const list = await env.API_KEYS.list({ prefix: "key:" });
  assert.equal(list.keys.length, 1, "exactly one key for the customer");
  const bill = await env.API_KEYS.get("stripe_customer:cus_i", { type: "json" });
  assert.equal(bill.api_key_id, list.keys[0].name.slice(4));
});

test("metadata / price mismatch fails closed: no key, review_required, checkout state explains", async () => {
  const env = stripeEnv();
  subs.sub_mm = sub("sub_mm", "cus_mm", "pro", { metadata: { plan: "scale" } });
  const r = await signed(env, event("checkout.session.completed", { id: "cs_mm", mode: "subscription", customer: "cus_mm", subscription: "sub_mm", payment_status: "paid", customer_details: { email: "mm@example.test" } }));
  assert.equal(r.body.data.action, "review_required");
  assert.equal((await env.API_KEYS.list({ prefix: "key:" })).keys.length, 0);
  const st = await (await worker.fetch(req("/dashboard/api/checkout?session_id=cs_mm"), env, execCtx)).json();
  assert.equal(st.data.status, "review_required");
});

test("payment failure → past_due, key keeps working; invoice.paid → active again", async () => {
  const env = stripeEnv();
  await signed(env, event("customer.subscription.created", sub("sub_pf", "cus_pf", "pro")));
  const key = await env.API_KEYS.get("pending_key:cus_pf");
  const f = await signed(env, event("invoice.payment_failed", { id: "in_1", object: "invoice", customer: "cus_pf", subscription: "sub_pf" }));
  assert.equal(f.body.data.action, "marked_past_due"); assert.equal(f.body.data.key_untouched, true);
  assert.equal((await env.API_KEYS.get("stripe_customer:cus_pf", { type: "json" })).billing_state, "past_due");
  assert.equal((await worker.fetch(req(`/v1/ufc/fighters/${S}/dna`, bearer(key)), env, execCtx)).status, 200, "still entitled while Stripe retries");
  await signed(env, event("customer.subscription.updated", sub("sub_pf", "cus_pf", "pro", { status: "past_due" })));
  assert.equal((await worker.fetch(req("/v1/ufc/counts", bearer(key)), env, execCtx)).status, 200, "past_due status keeps access");
  const p = await signed(env, event("invoice.paid", { id: "in_2", object: "invoice", customer: "cus_pf", subscription: "sub_pf" }));
  assert.equal(p.body.data.billing_state, "active");
});

test("cancel_at_period_end keeps access; subscription.deleted disables it; unpaid suspends", async () => {
  const env = stripeEnv();
  await signed(env, event("customer.subscription.created", sub("sub_c", "cus_c", "ultra")));
  const key = await env.API_KEYS.get("pending_key:cus_c");
  const c = await signed(env, event("customer.subscription.updated", sub("sub_c", "cus_c", "ultra", { cancel_at_period_end: true })));
  assert.equal(c.body.data.action, "unchanged");
  const me = await (await worker.fetch(req("/dashboard/api/me", bearer(key)), env, execCtx)).json();
  assert.equal(me.data.billing.cancel_at_period_end, true); assert.equal(me.data.key.status, "active");
  assert.equal((await worker.fetch(req(`/v1/ufc/matchups/${S}/${D}/dna`, bearer(key)), env, execCtx)).status, 200, "paid time remaining → access retained");
  const d = await signed(env, event("customer.subscription.deleted", sub("sub_c", "cus_c", "ultra", { status: "canceled" })));
  assert.equal(d.body.data.action, "access_disabled");
  const after = await worker.fetch(req("/v1/ufc/counts", bearer(key)), env, execCtx);
  assert.equal(after.status, 401); assert.equal((await after.json()).error.code, "api_key_suspended");
  const rec = await env.API_KEYS.get(`key:${d.body.data.key_id}`, { type: "json" });
  assert.equal(rec.status, "suspended", "suspended, never deleted");

  await signed(env, event("customer.subscription.created", sub("sub_u", "cus_u", "pro")));
  const k2 = await env.API_KEYS.get("pending_key:cus_u");
  await signed(env, event("customer.subscription.updated", sub("sub_u", "cus_u", "pro", { status: "unpaid" })));
  assert.equal((await worker.fetch(req("/v1/ufc/counts", bearer(k2)), env, execCtx)).status, 401);
  await signed(env, event("customer.subscription.updated", sub("sub_u", "cus_u", "pro", { status: "active" })));
  assert.equal((await worker.fetch(req("/v1/ufc/counts", bearer(k2)), env, execCtx)).status, 200, "reactivated on active status");
});

test("plan upgrade Developer → Pro → Ultra updates the same key; downgrade applies when Stripe changes the price", async () => {
  const env = stripeEnv();
  await signed(env, event("customer.subscription.created", sub("sub_up", "cus_up", "developer")));
  const key = await env.API_KEYS.get("pending_key:cus_up");
  assert.equal((await worker.fetch(req(`/v1/ufc/fighters/${S}/dna`, bearer(key)), env, execCtx)).status, 403);
  const u1 = await signed(env, event("customer.subscription.updated", sub("sub_up", "cus_up", "pro")));
  assert.equal(u1.body.data.action, "entitlement_updated");
  assert.equal((await worker.fetch(req(`/v1/ufc/fighters/${S}/dna`, bearer(key)), env, execCtx)).status, 200);
  await signed(env, event("customer.subscription.updated", sub("sub_up", "cus_up", "ultra")));
  assert.equal((await worker.fetch(req(`/v1/ufc/matchups/${S}/${D}/dna`, bearer(key)), env, execCtx)).status, 200);
  await signed(env, event("customer.subscription.updated", sub("sub_up", "cus_up", "pro")));
  assert.equal((await worker.fetch(req(`/v1/ufc/matchups/${S}/${D}/dna`, bearer(key)), env, execCtx)).status, 403, "downgrade applied only once Stripe reports the new price");
  assert.equal((await env.API_KEYS.list({ prefix: "key:" })).keys.length, 1);
});

test("rotation keeps the billing link; Customer Portal session; test-mode events ignored in production", async () => {
  const env = stripeEnv();
  await signed(env, event("customer.subscription.created", sub("sub_r", "cus_r", "pro")));
  const key = await env.API_KEYS.get("pending_key:cus_r");
  const rot = await (await worker.fetch(req("/dashboard/api/rotate", bearer(key), "POST"), env, execCtx)).json();
  const portal = await (await worker.fetch(req("/dashboard/api/portal", bearer(rot.data.key), "POST"), env, execCtx)).json();
  assert.match(portal.data.url, /billing\.stripe\.com\/p\/session\/test_cus_r/);
  await signed(env, event("customer.subscription.updated", sub("sub_r", "cus_r", "ultra")));
  assert.equal((await worker.fetch(req(`/v1/ufc/matchups/${S}/${D}/dna`, bearer(rot.data.key)), env, execCtx)).status, 200, "upgrade lands on the rotated key");
  const noStripe = await worker.fetch(req("/dashboard/api/portal", bearer(rot.data.key), "POST"), makeEnv({ STRIPE_WEBHOOK_SECRET: SECRET, API_KEYS: env.API_KEYS, USAGE_COUNTER: env.USAGE_COUNTER }), execCtx);
  assert.equal(noStripe.status, 503);
  const prod = stripeEnv({ GATEWAY_ENV: "production" });
  const t = await signed(prod, { ...event("customer.subscription.created", sub("sub_t", "cus_t", "pro")), livemode: false });
  assert.equal(t.body.data.action, "ignored_test_mode_event");
});
