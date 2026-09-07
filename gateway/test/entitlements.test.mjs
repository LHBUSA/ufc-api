import { test } from "node:test";
import assert from "node:assert/strict";
import { authorizeRoute, entitlementMatrix, matchEndpoint, minimumPlanFor, planHasFeature } from "../src/entitlements.js";
import { ENTITLEMENTS, PLANS } from "../src/config.js";
import upstream from "../../upstream/ufc-contract.json" with { type: "json" };

const q = (s = "") => new URLSearchParams(s);

test("every entitlement endpoint exists upstream (commercial layer exposes fewer, never more)", () => {
  const up = new Set(upstream.endpoint_paths);
  for (const e of ENTITLEMENTS.endpoints) assert.ok(up.has(e.path), `${e.path} is not an upstream route`);
});

test("route matching prefers literal segments and rejects unknown routes", () => {
  assert.equal(matchEndpoint("/v1/ufc/fighters/media").endpoint.key, "fighters_media");
  assert.equal(matchEndpoint("/v1/ufc/fighters/abc").endpoint.key, "fighter");
  assert.equal(matchEndpoint("/v1/ufc/fighters/abc/dna").endpoint.key, "fighter_dna");
  assert.equal(matchEndpoint("/v1/ufc/matchups/a/b/dna").endpoint.key, "matchup_dna");
  assert.deepEqual(matchEndpoint("/v1/ufc/matchups/a/b/dna").params, { fighterA: "a", fighterB: "b" });
  assert.equal(matchEndpoint("/v1/ufc/matchups/a/b/dna/").endpoint.key, "matchup_dna");
  assert.equal(matchEndpoint("/v1/ufc/does-not-exist"), null);
  assert.equal(matchEndpoint("/v1/ufc/fighters/abc/unknown"), null);
});

test("developer: core data yes, Fight DNA no, Matchup DNA no, wire no", () => {
  assert.equal(authorizeRoute("developer", "/v1/ufc/events", q("status=upcoming")).allowed, true);
  assert.equal(authorizeRoute("developer", "/v1/ufc/bouts/x/stats", q()).allowed, true);
  assert.equal(authorizeRoute("developer", "/v1/ufc/dna/metrics", q()).allowed, true, "registry is discoverable on Developer");
  const dna = authorizeRoute("developer", "/v1/ufc/fighters/x/dna", q());
  assert.equal(dna.allowed, false); assert.equal(dna.reason, "plan_required"); assert.equal(dna.required_plan, "pro");
  const m = authorizeRoute("developer", "/v1/ufc/matchups/a/b/dna", q());
  assert.equal(m.allowed, false); assert.equal(m.required_plan, "ultra");
  const w = authorizeRoute("developer", "/v1/ufc/wire", q());
  assert.equal(w.allowed, false); assert.equal(w.required_plan, "enterprise");
});

test("param gates: include=stats and as_of need higher plans", () => {
  const dev = authorizeRoute("developer", "/v1/ufc/events/x/card", q("include=media,stats"));
  assert.equal(dev.allowed, false); assert.equal(dev.required_feature, "round_stats_deep"); assert.equal(dev.required_plan, "pro");
  assert.equal(authorizeRoute("developer", "/v1/ufc/events/x/card", q("include=media")).allowed, true);
  assert.equal(authorizeRoute("pro", "/v1/ufc/events/x/card", q("include=stats")).allowed, true);
  assert.equal(authorizeRoute("pro", "/v1/ufc/fighters/x/dna", q("as_of=2025-01-01")).allowed, true);
  assert.equal(authorizeRoute("pro", "/v1/ufc/fighters/x/splits", q("as_of=2025-01-01")).allowed, true);
});

test("pro unlocks fighter DNA but not matchup / query / fight week", () => {
  assert.equal(authorizeRoute("pro", "/v1/ufc/fighters/x/dna", q()).allowed, true);
  assert.equal(authorizeRoute("pro", "/v1/ufc/fighters/x/splits", q("opponent_stance=SOUTHPAW")).allowed, true);
  assert.equal(authorizeRoute("pro", "/v1/ufc/fighters/x/round-profile", q()).allowed, true);
  assert.equal(authorizeRoute("pro", "/v1/ufc/fighters/x/finish-profile", q()).allowed, true);
  assert.equal(authorizeRoute("pro", "/v1/ufc/fighters/x/position-profile", q()).allowed, true);
  assert.equal(authorizeRoute("pro", "/v1/ufc/matchups/a/b/dna", q()).allowed, false);
  assert.equal(authorizeRoute("pro", "/v1/ufc/dna/query", q("metric=finish_rate")).allowed, false);
  assert.equal(authorizeRoute("pro", "/v1/ufc/events/x/intelligence", q()).allowed, false);
});

test("ultra unlocks matchup, query, ledger, intelligence; scale and enterprise inherit; first_party gets everything", () => {
  for (const plan of ["ultra", "scale", "enterprise", "first_party"]) {
    assert.equal(authorizeRoute(plan, "/v1/ufc/matchups/a/b/dna", q("as_of=2025-01-01")).allowed, true, plan);
    assert.equal(authorizeRoute(plan, "/v1/ufc/dna/query", q()).allowed, true, plan);
    assert.equal(authorizeRoute(plan, "/v1/ufc/bouts/x/ledger", q()).allowed, true, plan);
    assert.equal(authorizeRoute(plan, "/v1/ufc/events/x/intelligence", q()).allowed, true, plan);
  }
  assert.equal(authorizeRoute("ultra", "/v1/ufc/wire", q()).allowed, false);
  assert.equal(authorizeRoute("scale", "/v1/ufc/wire", q()).allowed, false);
  assert.equal(authorizeRoute("enterprise", "/v1/ufc/wire", q()).allowed, true);
  assert.equal(authorizeRoute("first_party", "/v1/ufc/wire", q()).allowed, true);
});

test("ladder is additive: every higher public plan has every lower plan's feature", () => {
  const order = PLANS.plan_order;
  for (let i = 1; i < order.length; i++) for (const f of PLANS.plans[order[i - 1]].features) assert.ok(planHasFeature(order[i], f), `${order[i]} lacks ${f}`);
});

test("minimum plan per differentiator", () => {
  assert.equal(minimumPlanFor("core"), "developer");
  assert.equal(minimumPlanFor("dna_fighter"), "pro");
  assert.equal(minimumPlanFor("dna_matchup"), "ultra");
  assert.equal(minimumPlanFor("wire"), "enterprise");
  assert.equal(minimumPlanFor("priority_support"), "scale");
});

test("matrix covers every endpoint for every plan", () => {
  const rows = entitlementMatrix();
  assert.equal(rows.length, ENTITLEMENTS.endpoints.length);
  for (const r of rows) for (const p of [...PLANS.plan_order, "first_party"]) assert.equal(typeof r.plans[p], "boolean");
});
