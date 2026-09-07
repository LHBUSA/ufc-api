/* End-to-end gateway tests with in-memory KV / DO / Analytics fakes and a fake upstream. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { issueKey } from "../src/admin.js";
import { execCtx, fakeUpstream, makeEnv } from "./fakes.mjs";
import fighterDna from "../../upstream/fixtures/fighter_dna.json" with { type: "json" };
import matchupDna from "../../upstream/fixtures/matchup_dna.json" with { type: "json" };
import eventsUpcoming from "../../upstream/fixtures/events_upcoming.json" with { type: "json" };

const S = "ec94d296-2db3-4e0d-be6a-46de4f480672";
const D = "9a3b2a15-27d8-4554-9217-42ef2dd5d25c";
const routes = {
  "/v1/ufc/events?status=upcoming&limit=3": { body: eventsUpcoming.body, request_id: "up-events" },
  "/v1/ufc/events": { body: eventsUpcoming.body },
  [`/v1/ufc/fighters/${S}/dna`]: { body: fighterDna.body, request_id: "up-dna" },
  [`/v1/ufc/matchups/${S}/${D}/dna`]: { body: matchupDna.body },
  "/v1/ufc/fighters/00000000-0000-0000-0000-000000000000/dna": { status: 404, body: { ok: false, data: null, error: { code: "fighter_not_found", message: "UFC fighter not found." }, meta: { api: "PropSports UFC", version: "2026-09-06.3", request_id: "up-404f" } } },
  "/v1/ufc/counts": { body: { ok: true, data: { fighters: 1 }, meta: {} } },
  "/v1/ufc/boom": { throw: "TimeoutError" },
};
const up = fakeUpstream(routes);
const realFetch = globalThis.fetch;
before(() => { globalThis.fetch = up.fetchImpl; });
after(() => { globalThis.fetch = realFetch; });

async function keysFor(env) {
  const dev = await issueKey(env, { customer_name: "Dev Co", plan: "developer", channel: "direct" });
  const pro = await issueKey(env, { customer_name: "Pro Co", plan: "pro", channel: "direct" });
  const ultra = await issueKey(env, { customer_name: "Ultra Co", plan: "ultra", channel: "direct" });
  const fp = await issueKey(env, { customer_name: "PropBetEdge UFC", plan: "first_party", channel: "first_party" });
  const tiny = await issueKey(env, { customer_name: "Tiny", plan: "developer", channel: "direct", overrides: { included_requests: 2, rate_limit_per_min: 1 } });
  return { dev, pro, ultra, fp, tiny };
}
const req = (path, headers = {}, method = "GET") => new Request("https://gateway.test" + path, { method, headers });
const bearer = (k) => ({ authorization: `Bearer ${k}` });

test("no key → 401 api_key_required with the canonical envelope and CORS", async () => {
  const env = makeEnv();
  const res = await worker.fetch(req("/v1/ufc/events"), env, execCtx);
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.ok, false); assert.equal(body.data, null); assert.equal(body.error.code, "api_key_required");
  assert.ok(body.meta.request_id); assert.equal(res.headers.get("access-control-allow-origin"), "*");
  assert.equal(res.headers.get("x-request-id"), body.meta.request_id);
});

test("bad key → 401 invalid_api_key; expired / revoked keys are refused", async () => {
  const env = makeEnv();
  const { dev } = await keysFor(env);
  assert.equal((await worker.fetch(req("/v1/ufc/events", bearer("pt_ufc_live_AAAAAAAAAAAA_" + "b".repeat(32))), env, execCtx)).status, 401);
  assert.equal((await worker.fetch(req("/v1/ufc/events", { "x-api-key": dev.key.slice(0, -1) + "Z" }), env, execCtx)).status, 401);
  const rec = await env.API_KEYS.get(`key:${dev.record.id}`, { type: "json" });
  rec.expires_at = "2020-01-01T00:00:00Z"; await env.API_KEYS.put(`key:${rec.id}`, JSON.stringify(rec));
  const exp = await worker.fetch(req("/v1/ufc/events", bearer(dev.key)), env, execCtx);
  assert.equal(exp.status, 401); assert.equal((await exp.json()).error.code, "api_key_expired");
  rec.expires_at = null; rec.status = "revoked"; await env.API_KEYS.put(`key:${rec.id}`, JSON.stringify(rec));
  assert.equal((await (await worker.fetch(req("/v1/ufc/events", bearer(dev.key)), env, execCtx)).json()).error.code, "api_key_revoked");
});

test("developer key: canonical body passes through unchanged with commercial headers", async () => {
  const env = makeEnv();
  const { dev } = await keysFor(env);
  const res = await worker.fetch(req("/v1/ufc/events?status=upcoming&limit=3", bearer(dev.key)), env, execCtx);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, eventsUpcoming.body, "body must be byte-for-byte the canonical response");
  assert.equal(res.headers.get("x-plan"), "developer");
  assert.equal(res.headers.get("x-ratelimit-limit"), "60");
  assert.equal(res.headers.get("x-ratelimit-remaining"), "59");
  assert.equal(res.headers.get("x-quota-limit"), "25000");
  assert.equal(res.headers.get("x-quota-remaining"), "24999");
  assert.equal(res.headers.get("x-api-version"), "2026-09-06.3");
  assert.equal(res.headers.get("x-upstream-request-id"), "up-events");
  assert.ok(res.headers.get("x-request-id"));
  assert.equal(res.headers.get("cache-control"), "private, max-age=60");
  assert.equal(res.headers.get("set-cookie"), null, "upstream cookies are stripped");
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  assert.equal(up.calls.at(-1).url, "/v1/ufc/events?status=upcoming&limit=3");
  assert.equal(up.calls.at(-1).init.headers.get("x-api-key"), null, "no upstream key unless configured");
});

test("developer key: Fight DNA → 403 plan_required (pro); Matchup DNA → 403 (ultra); unknown route → 404 without an upstream call", async () => {
  const env = makeEnv();
  const { dev } = await keysFor(env);
  const calls = up.calls.length;
  const dna = await worker.fetch(req(`/v1/ufc/fighters/${S}/dna`, bearer(dev.key)), env, execCtx);
  assert.equal(dna.status, 403);
  const b = await dna.json();
  assert.equal(b.error.code, "plan_required"); assert.equal(b.error.detail.required_plan, "pro"); assert.equal(b.error.detail.current_plan, "developer");
  const m = await worker.fetch(req(`/v1/ufc/matchups/${S}/${D}/dna`, bearer(dev.key)), env, execCtx);
  assert.equal((await m.json()).error.detail.required_plan, "ultra");
  const nf = await worker.fetch(req("/v1/ufc/nope", bearer(dev.key)), env, execCtx);
  assert.equal(nf.status, 404); assert.equal((await nf.json()).error.code, "route_not_found");
  assert.equal(up.calls.length, calls, "denied requests never reach upstream");
});

test("include=stats gate: developer denied with parameter detail, pro allowed", async () => {
  const env = makeEnv();
  const { dev, pro } = await keysFor(env);
  const d = await worker.fetch(req("/v1/ufc/events/x/card?include=media,stats", bearer(dev.key)), env, execCtx);
  assert.equal(d.status, 403);
  assert.deepEqual((await d.json()).error.detail.parameter, { name: "include", value: "stats" });
  const p = await worker.fetch(req("/v1/ufc/events/x/card?include=media,stats", bearer(pro.key)), env, execCtx);
  assert.equal(p.status, 404, "fake upstream has no card route; the point is the gate passed");
});

test("pro key: Fight DNA works and MetricObject provenance survives the gateway untouched", async () => {
  const env = makeEnv();
  const { pro } = await keysFor(env);
  const res = await worker.fetch(req(`/v1/ufc/fighters/${S}/dna`, bearer(pro.key)), env, execCtx);
  assert.equal(res.status, 200);
  const body = await res.json();
  const m = body.data.snapshot.metrics.sig_landed_per_min;
  for (const k of ["metric_key", "value", "unit", "numerator", "denominator", "sample_bouts", "sample_rounds", "sample_seconds", "confidence", "coverage_status", "definition_version", "origin", "source_families", "as_of_date"]) assert.ok(k in m, `MetricObject.${k}`);
  assert.equal(m.origin, "pbe_derived");
  assert.equal(res.headers.get("x-plan"), "pro");
  assert.equal(res.headers.get("x-ratelimit-limit"), "180");
});

test("ultra key: Matchup DNA works; unknown fighter 404 passes through upstream error unchanged", async () => {
  const env = makeEnv();
  const { ultra } = await keysFor(env);
  const res = await worker.fetch(req(`/v1/ufc/matchups/${S}/${D}/dna`, bearer(ultra.key)), env, execCtx);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.data.comparisons) && body.data.comparisons.length > 0);
  assert.ok(Array.isArray(body.data.insights));
  const nf = await worker.fetch(req("/v1/ufc/fighters/00000000-0000-0000-0000-000000000000/dna", bearer(ultra.key)), env, execCtx);
  assert.equal(nf.status, 404);
  assert.equal((await nf.json()).error.code, "fighter_not_found");
});

test("quota + rate limit: overrides enforce 429 quota_exceeded / rate_limited with Retry-After", async () => {
  const env = makeEnv();
  const { tiny } = await keysFor(env);
  const first = await worker.fetch(req("/v1/ufc/counts", bearer(tiny.key)), env, execCtx);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("x-quota-remaining"), "1");
  const second = await worker.fetch(req("/v1/ufc/counts", bearer(tiny.key)), env, execCtx);
  assert.equal(second.status, 429);
  const b2 = await second.json();
  assert.equal(b2.error.code, "rate_limited"); assert.ok(Number(second.headers.get("retry-after")) >= 1);
  /* exhaust quota via the counter directly (rate window would otherwise block) */
  const counter = env.USAGE_COUNTER.get(env.USAGE_COUNTER.idFromName(tiny.record.id));
  counter.counters.set(`w:${Math.floor(Date.now() / 60000)}`, 0);
  const third = await worker.fetch(req("/v1/ufc/counts", bearer(tiny.key)), env, execCtx);
  assert.equal(third.status, 200);
  counter.counters.set(`w:${Math.floor(Date.now() / 60000)}`, 0);
  const fourth = await worker.fetch(req("/v1/ufc/counts", bearer(tiny.key)), env, execCtx);
  assert.equal(fourth.status, 429);
  assert.equal((await fourth.json()).error.code, "quota_exceeded");
});

test("first-party key: never metered, everything entitled, unlimited headers", async () => {
  const env = makeEnv();
  const { fp } = await keysFor(env);
  const res = await worker.fetch(req(`/v1/ufc/matchups/${S}/${D}/dna`, bearer(fp.key)), env, execCtx);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-plan"), "first_party");
  assert.equal(res.headers.get("x-ratelimit-limit"), null, "no metering headers for first-party");
  const point = env.USAGE.points.at(-1);
  assert.equal(point.blobs[1], "first_party");
});

test("RapidAPI channel: proxy secret validated, subscription mapped, usage attributed, body identical", async () => {
  const env = makeEnv();
  const bad = await worker.fetch(req(`/v1/ufc/fighters/${S}/dna`, { "x-rapidapi-proxy-secret": "wrong", "x-rapidapi-user": "alice", "x-rapidapi-subscription": "PRO" }), env, execCtx);
  assert.equal(bad.status, 401); assert.equal((await bad.json()).error.code, "invalid_rapidapi_proxy_secret");
  const missing = await worker.fetch(req(`/v1/ufc/fighters/${S}/dna`, { "x-rapidapi-proxy-secret": "rapid-secret" }), env, execCtx);
  assert.equal((await missing.json()).error.code, "rapidapi_headers_missing");
  const unmapped = await worker.fetch(req(`/v1/ufc/fighters/${S}/dna`, { "x-rapidapi-proxy-secret": "rapid-secret", "x-rapidapi-user": "alice", "x-rapidapi-subscription": "PLATINUM" }), env, execCtx);
  assert.equal(unmapped.status, 403); assert.equal((await unmapped.json()).error.code, "rapidapi_plan_unmapped");
  const devDenied = await worker.fetch(req(`/v1/ufc/fighters/${S}/dna`, { "x-rapidapi-proxy-secret": "rapid-secret", "x-rapidapi-user": "alice", "x-rapidapi-subscription": "BASIC" }), env, execCtx);
  assert.equal(devDenied.status, 403); assert.equal((await devDenied.json()).error.detail.required_plan, "pro");
  const ok = await worker.fetch(req(`/v1/ufc/fighters/${S}/dna`, { "x-rapidapi-proxy-secret": "rapid-secret", "x-rapidapi-user": "alice", "x-rapidapi-subscription": "PRO" }), env, execCtx);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), fighterDna.body);
  assert.equal(ok.headers.get("x-plan"), "pro");
  assert.equal(ok.headers.get("x-ratelimit-limit"), "180");
  assert.equal(ok.headers.get("x-quota-limit"), "80000", "marketplace quota reported, not enforced at the gateway");
  const point = env.USAGE.points.at(-1);
  assert.equal(point.indexes[0], "rapidapi:alice"); assert.equal(point.blobs[1], "rapidapi"); assert.equal(point.blobs[2], "pro"); assert.equal(point.blobs[9], "alice"); assert.equal(point.blobs[10], "PRO");
  const noSecretEnv = makeEnv({ RAPIDAPI_PROXY_SECRET: undefined });
  const off = await worker.fetch(req("/v1/ufc/events", { "x-rapidapi-proxy-secret": "x", "x-rapidapi-user": "a", "x-rapidapi-subscription": "PRO" }), noSecretEnv, execCtx);
  assert.equal(off.status, 503);
});

test("upstream timeout → 504 upstream_timeout envelope", async () => {
  const env = makeEnv();
  const { dev } = await keysFor(env);
  const e = env.API_KEYS; // ensure key exists
  assert.ok(e);
  /* /v1/ufc/boom is not an entitlement route, so use a valid route and make the fake throw for it */
  routes["/v1/ufc/counts"] = { throw: "TimeoutError" };
  const res = await worker.fetch(req("/v1/ufc/counts", bearer(dev.key)), env, execCtx);
  routes["/v1/ufc/counts"] = { body: { ok: true, data: { fighters: 1 }, meta: {} } };
  assert.equal(res.status, 504);
  assert.equal((await res.json()).error.code, "upstream_timeout");
});

test("telemetry records every request including denials", async () => {
  const env = makeEnv();
  const { dev } = await keysFor(env);
  await worker.fetch(req("/v1/ufc/counts", bearer(dev.key)), env, execCtx);
  await worker.fetch(req(`/v1/ufc/fighters/${S}/dna`, bearer(dev.key)), env, execCtx);
  await worker.fetch(req("/v1/ufc/counts"), env, execCtx);
  const pts = env.USAGE.points;
  assert.equal(pts.length, 3);
  assert.equal(pts[0].blobs[4], "counts"); assert.equal(pts[0].doubles[3], 1);
  assert.equal(pts[1].blobs[11], "plan_required"); assert.equal(pts[1].doubles[3], 0);
  assert.equal(pts[2].blobs[11], "api_key_required"); assert.equal(pts[2].indexes[0], "anonymous");
});

test("admin API: issue, list, get with usage, update plan, revoke; requires ADMIN_TOKEN", async () => {
  const env = makeEnv();
  const noAuth = await worker.fetch(req("/admin/keys", {}, "POST"), env, execCtx);
  assert.equal(noAuth.status, 401);
  const issued = await worker.fetch(new Request("https://gateway.test/admin/keys", { method: "POST", headers: { authorization: "Bearer admin-secret", "content-type": "application/json" }, body: JSON.stringify({ customer_name: "Acme", customer_email: "dev@acme.test", plan: "pro", label: "prod" }) }), env, execCtx);
  assert.equal(issued.status, 200);
  const ib = await issued.json();
  assert.match(ib.data.key, /^pt_ufc_live_/); assert.equal(ib.data.record.plan, "pro"); assert.equal(ib.data.record.secret_hash, undefined);
  assert.equal(issued.headers.get("access-control-allow-origin"), null, "admin routes carry no CORS");
  await worker.fetch(req("/v1/ufc/counts", bearer(ib.data.key)), env, execCtx);
  const got = await worker.fetch(req(`/admin/keys/${ib.data.record.id}`, bearer("admin-secret")), env, execCtx);
  const gb = await got.json();
  assert.equal(gb.data.usage.month_used, 1);
  const list = await (await worker.fetch(req("/admin/keys", bearer("admin-secret")), env, execCtx)).json();
  assert.equal(list.data.length, 1);
  const upd = await worker.fetch(new Request(`https://gateway.test/admin/keys/${ib.data.record.id}/update`, { method: "POST", headers: { authorization: "Bearer admin-secret" }, body: JSON.stringify({ plan: "ultra", overrides: { included_requests: 1000000 } }) }), env, execCtx);
  assert.equal((await upd.json()).data.plan, "ultra");
  const m = await worker.fetch(req(`/v1/ufc/matchups/${S}/${D}/dna`, bearer(ib.data.key)), env, execCtx);
  assert.equal(m.status, 200); assert.equal(m.headers.get("x-quota-limit"), "1000000");
  await worker.fetch(req(`/admin/keys/${ib.data.record.id}/revoke`, bearer("admin-secret"), "POST"), env, execCtx);
  assert.equal((await worker.fetch(req("/v1/ufc/counts", bearer(ib.data.key)), env, execCtx)).status, 401);
  const badPlan = await worker.fetch(new Request("https://gateway.test/admin/keys", { method: "POST", headers: { authorization: "Bearer admin-secret" }, body: JSON.stringify({ customer_name: "X", plan: "platinum" }) }), env, execCtx);
  assert.equal(badPlan.status, 400);
});

test("dashboard API: /me shows plan + usage without secrets; /rotate issues a new key once and kills the old one", async () => {
  const env = makeEnv();
  const { pro } = await keysFor(env);
  await worker.fetch(req("/v1/ufc/counts", bearer(pro.key)), env, execCtx);
  const me = await worker.fetch(req("/dashboard/api/me", bearer(pro.key)), env, execCtx);
  assert.equal(me.status, 200);
  const mb = await me.json();
  assert.equal(mb.data.key.plan, "pro"); assert.equal(mb.data.usage.used, 1); assert.equal(mb.data.usage.quota, 100000); assert.equal(mb.data.plan.limits.rate_limit_per_min, 180);
  assert.equal(JSON.stringify(mb).includes(pro.key), false, "raw key never echoed"); assert.equal(JSON.stringify(mb).includes("secret_hash"), false);
  assert.equal(mb.data.api.version, "2026-09-06.3");
  const rot = await worker.fetch(req("/dashboard/api/rotate", bearer(pro.key), "POST"), env, execCtx);
  const rb = await rot.json();
  assert.match(rb.data.key, /^pt_ufc_live_/); assert.notEqual(rb.data.key, pro.key); assert.equal(rb.data.record.plan, "pro"); assert.equal(rb.data.record.rotated_from, pro.record.id);
  assert.equal((await worker.fetch(req("/dashboard/api/me", bearer(pro.key)), env, execCtx)).status, 401);
  assert.equal((await worker.fetch(req("/dashboard/api/me", bearer(rb.data.key)), env, execCtx)).status, 200);
  assert.equal((await worker.fetch(req("/dashboard/api/me"), env, execCtx)).status, 401);
});

test("health is public; OPTIONS preflight on /v1 returns CORS; non-API paths go to static assets; POST on /v1 is 405", async () => {
  const env = makeEnv();
  const h = await worker.fetch(req("/health"), env, execCtx);
  assert.equal(h.status, 200); assert.equal((await h.json()).data.api_version_target, "2026-09-06.3");
  const o = await worker.fetch(req("/v1/ufc/events", {}, "OPTIONS"), env, execCtx);
  assert.equal(o.status, 204); assert.equal(o.headers.get("access-control-allow-origin"), "*");
  const a = await worker.fetch(req("/pricing"), env, execCtx);
  assert.equal(a.status, 200); assert.match(await a.text(), /portal/);
  const p = await worker.fetch(req("/v1/ufc/events", {}, "POST"), env, execCtx);
  assert.equal(p.status, 405);
});
