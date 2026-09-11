#!/usr/bin/env node
/* Generate the COMMERCIAL OpenAPI contract from the upstream snapshot + entitlement config.
 *
 *   node scripts/build-openapi.mjs            → openapi/ufc-intelligence-api.yaml + apps/web/public/openapi.json
 *
 * Rules:
 *   - Data schemas are copied verbatim from upstream/openapi.ufc-v1.yaml (no forked shapes).
 *   - Only endpoints listed in config/entitlements.json are emitted (fewer than upstream, never more).
 *   - Each operation gets x-plan (minimum plan), x-feature, x-origin, security, and the commercial
 *     401 / 403 / 429 / 502 responses. Examples are verbatim live fixtures from upstream/fixtures.
 *   - Servers: commercial host first, canonical/first-party host second.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { normalizeOpenApi } from "./lib/openapi-normalize.mjs";
import { EXAMPLES, fixture, trimExample } from "./lib/examples.mjs";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const plans = JSON.parse(read("config/plans.json"));
const ent = JSON.parse(read("config/entitlements.json"));
const gw = JSON.parse(read("config/gateway.json"));
const contract = JSON.parse(read("upstream/ufc-contract.json"));
const up = normalizeOpenApi(YAML.parse(read("upstream/openapi.ufc-v1.yaml")));

const planHas = (plan, feature) => { const f = plans.plans[plan]?.features || []; return f.includes("*") || f.includes(feature); };
const minPlan = (feature) => plans.plan_order.find((p) => planHas(p, feature)) || null;
const errorExample = (code, message, detail) => ({ ok: false, data: null, error: { code, message, ...(detail ? { detail } : {}) }, meta: { api: gw.product_name, version: contract.api_version, gateway_version: gw.gateway_version, request_id: "8a1d2c9e-0f3b-4c6a-9e2d-1b7f5a3c4d21" } });

const commercialResponses = {
  Unauthorized: { description: "Missing, invalid, expired or revoked API key.", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" }, examples: { api_key_required: { value: errorExample("api_key_required", "An API key is required. Send `Authorization: Bearer <key>` or `X-API-Key: <key>`.") }, invalid_api_key: { value: errorExample("invalid_api_key", "The API key is invalid.") }, api_key_expired: { value: errorExample("api_key_expired", "The API key has expired.", { expires_at: "2026-12-31T00:00:00.000Z" }) } } } } },
  PlanRequired: { description: "The key's plan is not entitled to this endpoint or parameter.", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" }, examples: { plan_required: { value: errorExample("plan_required", "This endpoint requires the pro plan or higher.", { required_feature: "dna_fighter", required_plan: "pro", current_plan: "developer", upgrade_url: gw.pricing_url }) }, parameter_gate: { value: errorExample("plan_required", "Parameter include=stats requires the pro plan or higher.", { required_feature: "round_stats_deep", required_plan: "pro", current_plan: "developer", upgrade_url: gw.pricing_url, parameter: { name: "include", value: "stats" } }) } } } } },
  TooManyRequests: { description: "Per-minute rate limit or monthly quota exceeded. `Retry-After` is set.", headers: { "Retry-After": { schema: { type: "integer" } }, "X-RateLimit-Limit": { $ref: "#/components/headers/X-RateLimit-Limit" }, "X-RateLimit-Remaining": { $ref: "#/components/headers/X-RateLimit-Remaining" }, "X-RateLimit-Reset": { $ref: "#/components/headers/X-RateLimit-Reset" } }, content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" }, examples: { rate_limited: { value: errorExample("rate_limited", "Rate limit of 60 requests per minute exceeded.", { retry_after_seconds: 23, plan: "developer", upgrade_url: gw.pricing_url }) }, quota_exceeded: { value: errorExample("quota_exceeded", "Monthly quota of 25000 requests exceeded.", { retry_after_seconds: 1209600, plan: "developer", upgrade_url: gw.pricing_url }) } } } } },
  UpstreamUnavailable: { description: "The canonical UFC API is unavailable or timed out. Nothing is synthesized; retry.", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" }, examples: { upstream_unavailable: { value: errorExample("upstream_unavailable", "The canonical UFC API is unavailable.", { upstream: "ufc-api.propbetedge.ai" }) } } } } },
};

const headers = {
  "X-Request-Id": { description: "Gateway request id (also in `meta.request_id` on gateway errors).", schema: { type: "string", format: "uuid" } },
  "X-Upstream-Request-Id": { description: "Request id assigned by the canonical UFC API for the forwarded call.", schema: { type: "string" } },
  "X-API-Version": { description: `Canonical data-contract version (currently ${contract.api_version}).`, schema: { type: "string" } },
  "X-Gateway-Version": { description: `Commercial gateway version (currently ${gw.gateway_version}).`, schema: { type: "string" } },
  "X-Plan": { description: "Plan the request was authorized under.", schema: { type: "string", enum: [...plans.plan_order, "first_party", "internal"] } },
  "X-RateLimit-Limit": { description: "Requests allowed per minute for this key (or `unlimited`).", schema: { type: "string" } },
  "X-RateLimit-Remaining": { description: "Requests remaining in the current minute window.", schema: { type: "string" } },
  "X-RateLimit-Reset": { description: "Unix time (seconds) when the minute window resets.", schema: { type: "integer" } },
  "X-Quota-Limit": { description: "Included requests for the current calendar month (UTC), or `unlimited`.", schema: { type: "string" } },
  "X-Quota-Remaining": { description: "Requests remaining this month.", schema: { type: "string" } },
  "X-Quota-Reset": { description: "Unix time (seconds) of the next monthly reset (first of next month, UTC).", schema: { type: "integer" } },
};
const successHeaders = Object.fromEntries(Object.keys(headers).map((h) => [h, { $ref: `#/components/headers/${h}` }]));

const planRows = plans.plan_order.map((k) => { const p = plans.plans[k]; return `| **${p.name}** | ${p.price_usd_month === null ? p.price_label : `$${p.price_usd_month}/mo`} | ${p.included_requests === null ? "custom" : p.included_requests.toLocaleString("en-US")} | ${p.rate_limit_per_min === null ? "custom" : p.rate_limit_per_min} | ${p.tagline} |`; }).join("\n");

const description = `**UFC data infrastructure for developers — not another odds feed.** Normalized events, fighters, cards, results, rankings and round-level statistics; official weigh-ins, sourced availability and card changes; plus proprietary PropBetEdge Fight DNA, Matchup DNA and the Fight State Ledger.

This is the commercial distribution contract for the PropTechUSA UFC Intelligence API. It exposes a plan-gated subset of the canonical PropBetEdge UFC API (data-contract version \`${contract.api_version}\`, Fight DNA definition version ${contract.fight_dna_definition_version}). Response bodies are identical to the canonical API; the gateway adds authentication, entitlement, quota and rate-limit headers only.

### Authentication
\`Authorization: Bearer pt_ufc_live_…\` (or \`X-API-Key\`). Keys are issued per plan; the secret is shown once.

### Plans
| Plan | Price | Requests / month | Requests / minute | Unlocks |
| --- | --- | --- | --- | --- |
${planRows}

Every operation below carries \`x-plan\` (minimum plan) and \`x-origin\` (SOURCE_FACT, PBE_DERIVED, LICENSED, EDITORIAL, MEDIA, THIRD_PARTY_LINK).

### Origin labels
- **SOURCE_FACT** — normalized facts from ESPN / UFC Stats / ufc.com (events, results, strike counts, official rankings snapshot), official weigh-in readings, and individually sourced availability events and card changes. Weigh-in and availability rows carry \`source_url\`, \`source_name\` and \`source_kind\` (\`official\` outranks a news report).
- **PBE_DERIVED** — computed by the PropBetEdge Fight DNA builder from normalized fight history. Every derived value is a \`MetricObject\` carrying sample size, provenance, confidence, as-of date and definition version. Not official UFC statistics.
- **LICENSED** — reserved for licensed enrichment (position profiles); explicitly unavailable until a licensed source exists.
- **EDITORIAL** — PropBetEdge newsroom content. **MEDIA** — image metadata with license and attribution (render the credit). **THIRD_PARTY_LINK** — ids and official URLs only; nothing is rehosted.

### Truthful nulls
Missing data is \`null\` or an explicit \`404 dna_not_available\` / \`503 *_not_available\`. The API never returns fabricated zeroes, odds, picks or probabilities. An unpublished contracted weight limit is \`null\` (never the division default), an unnamed injury is \`injury_type: null\` (never an inferred diagnosis), and a fighter with no availability event on file has \`current: null\`, which is not a fitness claim.

### History is kept
Weigh-in readings are superseded, never overwritten: \`is_confirmation\` marks an official source verifying the same weight, \`is_correction\` marks a source that changed it, and \`/events/{id}/weigh-ins?include=history\` returns every stored reading. Availability events resolve or expire rather than disappear. The Fight State Ledger is append-only with deterministic diffs between checkpoints.

PropTechUSA and PropBetEdge are independent products and are not affiliated with, endorsed by, or sponsored by UFC, Zuffa LLC, TKO Group, ESPN or any sportsbook.`;

const doc = {
  openapi: "3.1.0",
  info: {
    title: gw.product_name,
    version: `${contract.api_version}+gw.${gw.gateway_version}`,
    summary: "Normalized UFC data plus proprietary PropBetEdge Fight DNA, delivered through one developer API.",
    description,
    termsOfService: `${gw.commercial_host}/legal`,
    contact: { name: "PropTechUSA", url: "https://proptechusa.ai", email: gw.support_email },
    "x-upstream": { repository: contract.repository, branch: contract.branch, commit: contract.commit, api_version: contract.api_version, fight_dna_definition_version: contract.fight_dna_definition_version },
  },
  servers: [
    { url: gw.commercial_host, description: "Commercial host (preferred): PropTechUSA UFC Intelligence API gateway" },
    { url: contract.upstream_base_url, description: "Canonical / first-party host (PropBetEdge). Same contract; backwards compatible." },
  ],
  security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
  tags: [
    { name: "Core", description: "Events, cards, fighters, bouts, results, rankings, search, counts (SOURCE_FACT)." },
    { name: "Weigh-ins & Availability", description: "Official weigh-ins with confirmation vs correction and full source history, sourced injuries and availability, card changes and fighter status (SOURCE_FACT, every row sourced). Developer and above." },
    { name: "Fight DNA", description: "Proprietary PropBetEdge fighter intelligence (PBE_DERIVED). Pro and above." },
    { name: "Matchup DNA", description: "Fighter-vs-fighter intelligence with threshold-gated insights (PBE_DERIVED). Ultra and above." },
    { name: "Fight Week", description: "Fight State Ledger and event intelligence: proprietary, append-only derived fight state (PBE_DERIVED). Ultra and above." },
    { name: "Media", description: "Image metadata with license + attribution; official video metadata (no rehosting)." },
    { name: "Editorial", description: "PropBetEdge newsroom content (EDITORIAL)." },
  ],
  paths: {},
  components: { securitySchemes: { BearerAuth: { type: "http", scheme: "bearer", bearerFormat: "pt_ufc_live_<key_id>_<secret>" }, ApiKeyAuth: { type: "apiKey", in: "header", name: "X-API-Key" } }, headers, responses: { ...(up.components?.responses || {}), ...commercialResponses }, parameters: up.components?.parameters || {}, schemas: up.components?.schemas || {} },
  "x-plans": plans.plans,
  "x-entitlements": ent.endpoints.map((e) => ({ key: e.key, path: e.path, feature: e.feature, minimum_plan: minPlan(e.feature), origin: e.origin })),
};

const FIGHT_WEEK_FACTS = new Set(["weigh_ins", "event_weigh_ins", "injuries", "event_card_changes", "fighter_status"]);
const tagFor = (e) => {
  if (FIGHT_WEEK_FACTS.has(e.key)) return "Weigh-ins & Availability";
  if (e.feature === "dna_matchup") return "Matchup DNA";
  if (e.feature === "dna_fighter" || e.feature === "dna_registry" || e.feature === "dna_query") return "Fight DNA";
  if (e.feature === "fight_week") return "Fight Week";
  if (e.feature === "media_metadata" || e.feature === "video_metadata") return "Media";
  if (e.feature === "editorial" || e.feature === "wire") return "Editorial";
  return "Core";
};

for (const e of ent.endpoints) {
  const upPath = up.paths?.[e.path];
  if (!upPath || !upPath.get) { console.warn(`! upstream has no GET ${e.path}; skipped`); continue; }
  const op = JSON.parse(JSON.stringify(upPath.get));
  const min = minPlan(e.feature);
  op.tags = [tagFor(e)];
  op.operationId = op.operationId || e.key;
  op["x-plan"] = min || "enterprise";
  op["x-feature"] = e.feature;
  op["x-origin"] = e.origin;
  op["x-plans"] = Object.fromEntries([...plans.plan_order, "first_party"].map((p) => [p, planHas(p, e.feature)]));
  const gates = ent.param_gates.filter((g) => g.endpoint === e.key);
  const gateText = gates.map((g) => `\`${g.param}=${g.value === "*" ? "…" : g.value}\` requires **${minPlan(g.feature)}** (${g.note || g.feature})`).join("; ");
  op.description = `${op.description ? op.description.trim() + "\n\n" : ""}**Plan:** ${min ? plans.plans[min].name + " and above" : "Enterprise / first-party only"}. **Origin:** ${e.origin}.${gateText ? ` **Parameter gates:** ${gateText}.` : ""}`;
  op.responses = op.responses || {};
  const success = op.responses["200"] || { $ref: "#/components/responses/Success" };
  const ex = EXAMPLES[e.key] ? fixture(EXAMPLES[e.key]) : null;
  op.responses["200"] = { description: "Success envelope `{ ok, data, meta }` — identical to the canonical API.", headers: successHeaders, content: { "application/json": { schema: { $ref: "#/components/schemas/SuccessEnvelope" }, ...(ex && ex.status === 200 ? { examples: { live: { summary: `Live response captured ${ex.captured_at.slice(0, 10)} (${ex.path})`, value: trimExample(EXAMPLES[e.key], ex.body) } } } : {}) } } };
  if (success.$ref && !success.$ref.endsWith("/Success")) op.responses["200"] = success;
  op.responses["401"] = { $ref: "#/components/responses/Unauthorized" };
  op.responses["403"] = { $ref: "#/components/responses/PlanRequired" };
  op.responses["429"] = { $ref: "#/components/responses/TooManyRequests" };
  op.responses["502"] = { $ref: "#/components/responses/UpstreamUnavailable" };
  if (e.key === "fighter_dna") {
    const nf = fixture("fighter_dna_asof_404");
    if (nf) op.responses["404"] = { description: "Fighter unknown, or no Fight DNA snapshot at/before `as_of` (`dna_not_available`). Nothing is synthesized.", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" }, examples: { dna_not_available: { value: nf.body } } } } };
  }
  if (e.key === "fighter_position_profile") op.responses["200"].description += " `status` is `licensed_data_not_available` and `position_profile` is `null` until a licensed position source exists.";
  doc.paths[e.path] = { get: op };
}

/* Make sure envelope schemas exist even if upstream names differ. */
doc.components.schemas.SuccessEnvelope = doc.components.schemas.SuccessEnvelope || { type: "object", required: ["ok", "data", "meta"], properties: { ok: { const: true }, data: {}, meta: { type: "object" } } };
doc.components.schemas.ErrorEnvelope = doc.components.schemas.ErrorEnvelope || { type: "object", required: ["ok", "data", "error", "meta"], properties: { ok: { const: false }, data: { type: "null" }, error: { type: "object", required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" }, detail: {} } }, meta: { type: "object" } } };
doc.components.schemas.Plan = { type: "string", enum: plans.plan_order, description: "Commercial plan ladder: Developer $79, Pro $199, Ultra $499, Scale $1,499, Enterprise custom." };
doc.components.schemas.Provenance = doc.components.schemas.Provenance || { type: "object", description: "Evidence carried by every PBE_DERIVED value (subset of MetricObject).", properties: { sample_bouts: { type: "integer" }, sample_rounds: { type: "integer" }, sample_seconds: { type: "integer" }, confidence: { $ref: "#/components/schemas/Confidence" }, coverage_status: { $ref: "#/components/schemas/Confidence" }, definition_version: { type: "integer" }, origin: { $ref: "#/components/schemas/DnaOrigin" }, source_families: { type: "array", items: { type: "string" } }, as_of_date: { type: "string", format: "date" } } };
doc.components.schemas.Coverage = doc.components.schemas.Coverage || { $ref: "#/components/schemas/Confidence" };
doc.components.schemas.FighterDna = doc.components.schemas.FighterDna || { type: "object", properties: { fighter: { $ref: "#/components/schemas/DnaFighter" }, snapshot: { $ref: "#/components/schemas/DnaSnapshot" } } };
doc.components.schemas.RoundProfile = doc.components.schemas.RoundProfile || { type: "object", description: "round_profile family: per-round pace/absorption MetricObjects plus pace retention, championship-round delta and defensive drift.", additionalProperties: true };
doc.components.schemas.FinishProfile = doc.components.schemas.FinishProfile || { type: "object", description: "finish_profile family: finish_rate, ko_finish_rate, submission_finish_rate, finish_round_distribution, finish_time_median_sec, finished_by.", additionalProperties: true };

mkdirSync(join(ROOT, "openapi"), { recursive: true });
const yamlText = `# GENERATED by scripts/build-openapi.mjs from upstream/openapi.ufc-v1.yaml + config/entitlements.json + config/plans.json.\n# Do not edit by hand. Upstream: ${contract.repository}@${contract.branch} ${contract.commit} (api ${contract.api_version}).\n` + YAML.stringify(doc, { lineWidth: 0 });
writeFileSync(join(ROOT, "openapi", "ufc-intelligence-api.yaml"), yamlText);
mkdirSync(join(ROOT, "apps", "web", "public"), { recursive: true });
writeFileSync(join(ROOT, "apps", "web", "public", "openapi.json"), JSON.stringify(doc, null, 2) + "\n");
console.log(`openapi: ${Object.keys(doc.paths).length} paths, ${Object.keys(doc.components.schemas).length} schemas → openapi/ufc-intelligence-api.yaml + apps/web/public/openapi.json`);
