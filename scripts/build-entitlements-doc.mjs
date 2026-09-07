#!/usr/bin/env node
/* Generate docs/UFC_API_ENTITLEMENTS.md and apps/web/src/generated/entitlements.json from config. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { portalExamples } from "./lib/examples.mjs";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const plans = JSON.parse(readFileSync(join(ROOT, "config/plans.json"), "utf8"));
const ent = JSON.parse(readFileSync(join(ROOT, "config/entitlements.json"), "utf8"));
const rapid = JSON.parse(readFileSync(join(ROOT, "config/rapidapi.json"), "utf8"));
const contract = JSON.parse(readFileSync(join(ROOT, "upstream/ufc-contract.json"), "utf8"));
const billing = JSON.parse(readFileSync(join(ROOT, "config/billing.json"), "utf8"));

const planHas = (plan, feature) => { const f = plans.plans[plan]?.features || []; return f.includes("*") || f.includes(feature); };
const minPlan = (feature) => plans.plan_order.find((p) => planHas(p, feature)) || null;
const cols = [...plans.plan_order, "first_party"];
const label = (k) => plans.plans[k].name;
const mark = (b) => (b ? "✔" : "—");
const price = (k) => (plans.plans[k].price_usd_month === null ? plans.plans[k].price_label || "custom" : `$${plans.plans[k].price_usd_month}/mo`);

const rows = ent.endpoints.map((e) => `| \`${e.method} ${e.path}\` | ${e.origin} | ${e.feature} | ${cols.map((c) => mark(planHas(c, e.feature))).join(" | ")} | ${minPlan(e.feature) ? label(minPlan(e.feature)) : "Enterprise / first-party"} |`);
const gates = ent.param_gates.map((g) => { const e = ent.endpoints.find((x) => x.key === g.endpoint); return `| \`${e.path}\` | \`${g.param}=${g.value === "*" ? "…" : g.value}\` | ${g.feature} | ${label(minPlan(g.feature))} | ${g.note || ""} |`; });
const quotas = plans.plan_order.map((k) => { const p = plans.plans[k]; const r = rapid.marketplace_plans[k]; return `| ${p.name} | ${price(k)} | ${p.included_requests === null ? "custom" : p.included_requests.toLocaleString("en-US")} | ${p.rate_limit_per_min ?? "custom"} | ${p.concurrency_limit ?? "custom"} | ${p.limit_mode} | ${r ? `${r.requests_per_month.toLocaleString("en-US")} / ${r.rate_limit_per_min}` : "n/a"} |`; });
const features = Object.entries(ent.feature_labels).map(([k, v]) => `| \`${k}\` | ${v} | ${minPlan(k) ? label(minPlan(k)) : "Enterprise / first-party"} |`);

const md = `# UFC Intelligence API — entitlement matrix

Generated from \`config/plans.json\` + \`config/entitlements.json\` by \`scripts/build-entitlements-doc.mjs\`. **Do not edit by hand**; change the config and re-run \`npm run entitlements:doc\`.

Upstream contract: ${contract.repository}@${contract.branch} \`${String(contract.commit).slice(0, 10)}\`, API version \`${contract.api_version}\`, Fight DNA definition version ${contract.fight_dna_definition_version}.

## Rules

1. The gateway exposes **only** the endpoints listed here. Any other \`/v1/*\` path is \`404 route_not_found\` at the gateway, without an upstream call.
2. A plan is entitled to an endpoint when its feature list contains the endpoint's feature. Higher plans are strict supersets of lower plans (tested).
3. Parameter gates deny specific query values (\`403 plan_required\` with \`error.detail.parameter\`) even when the base endpoint is allowed.
4. \`first_party\` and \`internal\` keys are never metered and are entitled to everything. They are issued only by the admin API (never self-serve).
5. \`wire\` (third-party headlines) is not sold on self-serve plans pending rights review (see \`docs/UFC_API_COMMERCIAL_RIGHTS_MATRIX.md\`).

## Plans, quotas and limits (initial configurable values)

| Plan | Price | Included requests / month (direct) | Requests / minute | Concurrency (reserved) | Limit mode | RapidAPI quota / min |
| --- | --- | --- | --- | --- | --- | --- |
${quotas.join("\n")}

\`limit_mode\`: **hard** = \`429 quota_exceeded\` at the quota; **soft** = allowed past the quota with \`X-Quota-Status: over-quota-soft\` (Scale, reviewed manually until metered billing exists); **custom** = per-contract; **none** = unmetered. Overage billing is architected (\`overage.enabled\`, \`price_usd_per_1k\`) but disabled on every plan. Concurrency limits are recorded in config but not enforced in v1.

## Features

| Feature | Meaning | Minimum plan |
| --- | --- | --- |
${features.join("\n")}

## Endpoint × plan

| Endpoint | Origin | Feature | ${cols.map(label).join(" | ")} | Minimum plan |
| --- | --- | --- | ${cols.map(() => "---").join(" | ")} | --- |
${rows.join("\n")}

## Parameter gates

| Endpoint | Parameter | Feature | Minimum plan | Note |
| --- | --- | --- | --- | --- |
${gates.join("\n")}

## Channels

| Channel | Who | Entitlement source | Metering |
| --- | --- | --- | --- |
| \`direct\` | PropTechUSA direct customers | key record plan (+ per-key overrides) | gateway: per-minute + monthly, hard/soft per plan |
| \`rapidapi\` | RapidAPI subscribers | \`X-RapidAPI-Subscription\` → \`config/rapidapi.json\` mapping | RapidAPI bills and enforces quota; gateway enforces the per-minute backstop and attributes usage |
| \`enterprise\` | contract customers | key record (plan \`enterprise\`, custom overrides) | per contract (\`limit_mode: custom\`) |
| \`first_party\` | PropBetEdge consumer products | key record plan \`first_party\` | none |
| \`internal\` | smoke tests, monitoring | key record plan \`internal\` | rate backstop only |
`;
writeFileSync(join(ROOT, "docs", "UFC_API_ENTITLEMENTS.md"), md);
mkdirSync(join(ROOT, "apps", "web", "src", "generated"), { recursive: true });
writeFileSync(join(ROOT, "apps", "web", "src", "generated", "entitlements.json"), JSON.stringify({ generated_at: new Date().toISOString(), plans, entitlements: ent, rapidapi: rapid, billing: { self_serve_checkout: billing.self_serve_checkout, product_name: billing.product_name, plans: billing.plans, tax: billing.tax, customer_portal: billing.customer_portal }, contract: { ...contract, endpoints: undefined, metric_object_sample: contract.metric_object_sample }, matrix: ent.endpoints.map((e) => ({ ...e, minimum_plan: minPlan(e.feature), plans: Object.fromEntries(cols.map((c) => [c, planHas(c, e.feature)])) })) }, null, 2));
writeFileSync(join(ROOT, "apps", "web", "src", "generated", "examples.json"), JSON.stringify(portalExamples(), null, 2));
console.log(`docs/UFC_API_ENTITLEMENTS.md: ${ent.endpoints.length} endpoints × ${cols.length} plans, ${ent.param_gates.length} parameter gates`);
