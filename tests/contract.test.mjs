/* Repo-level integrity: config coherence and generated artifacts. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import YAML from "yaml";

const read = (p) => JSON.parse(readFileSync(new URL("../" + p, import.meta.url), "utf8"));
const plans = read("config/plans.json");
const ent = read("config/entitlements.json");
const rapid = read("config/rapidapi.json");
const contract = read("upstream/ufc-contract.json");

test("plans: ladder, prices, features reference known feature labels", () => {
  assert.deepEqual(plans.plan_order, ["developer", "pro", "ultra", "scale", "enterprise"]);
  for (const k of plans.plan_order) assert.ok(plans.plans[k], k);
  for (const [k, p] of Object.entries(plans.plans)) for (const f of p.features) if (f !== "*") assert.ok(ent.feature_labels[f], `${k} feature ${f} has no label`);
  for (const k of ["developer", "pro", "ultra", "scale"]) assert.ok(rapid.marketplace_plans[k].requests_per_month <= plans.plans[k].included_requests, `RapidAPI quota for ${k} must not exceed direct`);
  for (const k of ["developer", "pro", "ultra", "scale"]) assert.equal(rapid.marketplace_plans[k].price_usd_month, plans.plans[k].price_usd_month, "same price on both channels");
});

test("entitlements: unique keys/paths, every endpoint feature labelled, every param gate references an endpoint", () => {
  const keys = new Set(), paths = new Set();
  for (const e of ent.endpoints) { assert.ok(!keys.has(e.key), e.key); keys.add(e.key); assert.ok(!paths.has(e.path), e.path); paths.add(e.path); assert.ok(ent.feature_labels[e.feature], e.feature); assert.ok(["SOURCE_FACT", "PBE_DERIVED", "LICENSED", "EDITORIAL", "MEDIA", "THIRD_PARTY_LINK"].includes(e.origin), e.origin); }
  for (const g of ent.param_gates) assert.ok(keys.has(g.endpoint), g.endpoint);
  for (const s of Object.values(rapid.subscription_to_plan)) assert.ok(plans.plans[s], s);
});

test("deployment safety: no command can move the Vercel portal hostname onto the Worker", () => {
  /* ufc.proptechusa.ai is a Vercel-served hostname whose DNS record lives in the Cloudflare zone.
     A Worker Custom Domain for it would rewrite that record and take the public site down, so the
     hostname must never appear as a route/custom_domain in wrangler.toml and there must be no
     deploy script that targets an environment claiming it. */
  const toml = readFileSync(new URL("../gateway/wrangler.toml", import.meta.url), "utf8");
  const live = toml.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  assert.ok(!/custom_domain/.test(live), "wrangler.toml must not register a Custom Domain");
  assert.ok(!/^\s*routes\s*=/m.test(live), "wrangler.toml must not claim routes");
  assert.ok(!live.includes("ufc.proptechusa.ai"), "wrangler.toml must not reference the Vercel hostname outside comments");
  assert.ok(!/\[env\.[a-z]+\]/.test(live), "a second wrangler environment is what re-introduces the hostname claim");
  const root = read("package.json"), gwPkg = read("gateway/package.json");
  for (const [name, pkg] of [["root", root], ["gateway", gwPkg]]) {
    for (const [script, cmd] of Object.entries(pkg.scripts || {})) {
      assert.ok(!/--env\s+production/.test(cmd), `${name} script ${script} deploys a production env that no longer exists`);
    }
  }
  const gw = read("config/gateway.json");
  assert.notEqual(gw.api_base_url, gw.commercial_host, "the API base URL and the documentation site are different hosts");
});

test("upstream provenance file is complete", () => {
  for (const k of ["repository", "branch", "commit", "api_version", "fight_dna_definition_version", "endpoint_paths", "metric_object_keys"]) assert.ok(contract[k] !== undefined && contract[k] !== null, k);
  assert.equal(contract.repository, "LHBUSA/UFC");
  assert.equal(contract.branch, "main");
  assert.match(contract.commit, /^[0-9a-f]{40}$/);
  assert.equal(contract.fight_dna_definition_version, 1);
});

test("generated commercial OpenAPI exists, is current, and static drift guard passes", () => {
  assert.ok(existsSync(new URL("../openapi/ufc-intelligence-api.yaml", import.meta.url)));
  const doc = YAML.parse(readFileSync(new URL("../openapi/ufc-intelligence-api.yaml", import.meta.url), "utf8"));
  assert.equal(Object.keys(doc.paths).length, ent.endpoints.length);
  const gw = read("config/gateway.json");
  assert.equal(doc.servers[0].url, gw.api_base_url, "servers[0] must be the gateway that serves /v1");
  assert.equal(doc.servers[1].url, "https://ufc-api.propbetedge.ai");
  const out = execFileSync(process.execPath, [new URL("../scripts/check-upstream-contract.mjs", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")], { encoding: "utf8" });
  assert.match(out, /upstream contract in sync/);
});
