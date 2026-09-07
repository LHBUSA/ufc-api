import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, monthKey, monthReset, windowKey, windowReset } from "../src/policy.js";
import { PLANS } from "../src/config.js";

const NOW = Date.UTC(2026, 8, 7, 12, 30, 15); // 2026-09-07T12:30:15Z

test("window and month keys are UTC and deterministic", () => {
  assert.equal(monthKey(NOW), "m:2026-09");
  assert.equal(windowKey(NOW), `w:${Math.floor(NOW / 60000)}`);
  assert.equal(monthReset(NOW), Math.floor(Date.UTC(2026, 9, 1) / 1000));
  assert.equal(windowReset(NOW), Math.floor((Math.floor(NOW / 60000) + 1) * 60));
});

test("developer plan: allowed under limits, counters advance", () => {
  const limits = PLANS.plans.developer;
  const d = decide({ minute_used: 0, month_used: 0 }, limits, NOW);
  assert.equal(d.allowed, true);
  assert.equal(d.minute.limit, 60);
  assert.equal(d.minute.remaining, 59);
  assert.equal(d.month.quota, 25000);
  assert.equal(d.month.remaining, 24999);
});

test("per-minute limit denies at the boundary with rate_limited", () => {
  const d = decide({ minute_used: 60, month_used: 10 }, PLANS.plans.developer, NOW);
  assert.equal(d.allowed, false);
  assert.equal(d.reason, "rate_limited");
  assert.equal(d.minute.remaining, 0);
});

test("hard monthly quota denies with quota_exceeded and wins over the minute check", () => {
  const d = decide({ minute_used: 60, month_used: 25000 }, PLANS.plans.developer, NOW);
  assert.equal(d.allowed, false);
  assert.equal(d.reason, "quota_exceeded");
});

test("soft limit mode (Scale) allows over quota but flags it", () => {
  const d = decide({ minute_used: 0, month_used: 2000000 }, PLANS.plans.scale, NOW);
  assert.equal(d.allowed, true);
  assert.equal(d.soft_over_quota, true);
  assert.equal(d.month.remaining, 0);
});

test("unlimited plan (first_party) never denies and reports unlimited", () => {
  const d = decide({ minute_used: 99999, month_used: 99999999 }, PLANS.plans.first_party, NOW);
  assert.equal(d.allowed, true);
  assert.equal(d.minute.limit, null);
  assert.equal(d.month.quota, null);
});

test("enforce_quota=false (RapidAPI channel) ignores the monthly quota but keeps the minute backstop", () => {
  const limits = { ...PLANS.plans.pro, included_requests: 100 };
  const a = decide({ minute_used: 0, month_used: 500 }, limits, NOW, { enforce_quota: false });
  assert.equal(a.allowed, true);
  const b = decide({ minute_used: 180, month_used: 500 }, limits, NOW, { enforce_quota: false });
  assert.equal(b.allowed, false);
  assert.equal(b.reason, "rate_limited");
});

test("plan ladder quotas are monotonic and match the product decision", () => {
  const p = PLANS.plans;
  assert.deepEqual([p.developer.price_usd_month, p.pro.price_usd_month, p.ultra.price_usd_month, p.scale.price_usd_month], [79, 199, 499, 1499]);
  assert.deepEqual([p.developer.included_requests, p.pro.included_requests, p.ultra.included_requests, p.scale.included_requests], [25000, 100000, 500000, 2000000]);
  assert.deepEqual([p.developer.rate_limit_per_min, p.pro.rate_limit_per_min, p.ultra.rate_limit_per_min, p.scale.rate_limit_per_min], [60, 180, 600, 1200]);
  assert.equal(p.enterprise.price_usd_month, null);
});
