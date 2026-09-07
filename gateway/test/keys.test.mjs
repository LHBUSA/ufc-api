import { test } from "node:test";
import assert from "node:assert/strict";
import { constantTimeEqual, effectiveLimits, generateKey, keyStatus, maskKey, parseKey, sha256Hex } from "../src/keys.js";
import { PLANS } from "../src/config.js";

test("generated keys follow the pt_ufc_live_<id>_<secret> convention and parse back", async () => {
  const k = await generateKey();
  assert.match(k.raw, /^pt_ufc_live_[A-Za-z0-9]{12}_[A-Za-z0-9]{32}$/);
  const p = parseKey(k.raw);
  assert.equal(p.key_id, k.key_id);
  assert.equal(k.secret_hash, await sha256Hex(k.raw));
  assert.equal(k.secret_hash.length, 64);
  assert.ok(k.display.startsWith(`pt_ufc_live_${k.key_id}_`));
  assert.ok(!k.display.includes(k.raw.slice(-32)));
});

test("junk credentials never parse (no KV lookup for garbage)", () => {
  assert.equal(parseKey(""), null);
  assert.equal(parseKey("sk_live_abc"), null);
  assert.equal(parseKey("pt_ufc_live_short"), null);
  assert.equal(parseKey("pt_ufc_live_ABCDEFGHIJKL_" + "x".repeat(31)), null);
  assert.equal(maskKey("nope"), null);
});

test("constant-time compare", () => {
  assert.equal(constantTimeEqual("abc", "abc"), true);
  assert.equal(constantTimeEqual("abc", "abd"), false);
  assert.equal(constantTimeEqual("abc", "abcd"), false);
  assert.equal(constantTimeEqual(null, "abc"), false);
});

test("key status: active, expired, revoked", () => {
  const now = Date.parse("2026-09-07T00:00:00Z");
  assert.equal(keyStatus({ status: "active", expires_at: null }, now), "active");
  assert.equal(keyStatus({ status: "active", expires_at: "2026-01-01T00:00:00Z" }, now), "expired");
  assert.equal(keyStatus({ status: "revoked" }, now), "revoked");
  assert.equal(keyStatus(null, now), "missing");
});

test("effective limits: plan defaults then per-key overrides", () => {
  const base = effectiveLimits({ plan: "pro", overrides: {} });
  assert.equal(base.included_requests, PLANS.plans.pro.included_requests);
  assert.equal(base.rate_limit_per_min, 180);
  const o = effectiveLimits({ plan: "pro", overrides: { included_requests: 250000, limit_mode: "soft" } });
  assert.equal(o.included_requests, 250000);
  assert.equal(o.rate_limit_per_min, 180);
  assert.equal(o.limit_mode, "soft");
});
