#!/usr/bin/env node
/* Contract drift guard.
 *
 *   node scripts/check-upstream-contract.mjs          static: commercial OpenAPI + entitlements vs upstream snapshot
 *   node scripts/check-upstream-contract.mjs --live   also probe the live canonical API and compare to the snapshot
 *
 * Detects: endpoint removed / renamed, required response field removed, MetricObject shape change,
 * Fight DNA definition version change, API version change, commercial OpenAPI drift from the snapshot.
 * Exit 1 on any drift. The commercial layer may expose fewer endpoints, never incompatible shapes.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { normalizeOpenApi } from "./lib/openapi-normalize.mjs";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const live = process.argv.includes("--live");
const snapshot = JSON.parse(read("upstream/ufc-contract.json"));
const upstreamYaml = normalizeOpenApi(YAML.parse(read("upstream/openapi.ufc-v1.yaml")));
const ent = JSON.parse(read("config/entitlements.json"));
const gw = JSON.parse(read("config/gateway.json"));
const problems = [], notes = [];
const fail = (m) => problems.push(m);

/* 1. Every entitlement endpoint must exist in the snapshot AND in the upstream OpenAPI. */
const snapPaths = new Set(snapshot.endpoint_paths);
const upPaths = new Set(Object.keys(upstreamYaml.paths || {}));
for (const e of ent.endpoints) {
  if (!snapPaths.has(e.path)) fail(`entitlement endpoint not advertised by upstream index snapshot: ${e.path}`);
  if (!upPaths.has(e.path)) fail(`entitlement endpoint missing from upstream OpenAPI snapshot: ${e.path}`);
}
for (const p of snapPaths) if (!upPaths.has(p)) fail(`upstream index advertises ${p} but upstream OpenAPI snapshot lacks it`);

/* 2. Commercial OpenAPI must be a subset of upstream with identical schemas + servers. */
const commercialPath = join(ROOT, "openapi", "ufc-intelligence-api.yaml");
if (!existsSync(commercialPath)) fail("openapi/ufc-intelligence-api.yaml missing — run `npm run openapi:build`");
else {
  const c = YAML.parse(readFileSync(commercialPath, "utf8"));
  for (const p of Object.keys(c.paths || {})) if (!upPaths.has(p)) fail(`commercial OpenAPI exposes ${p} which upstream does not define`);
  for (const p of ent.endpoints.map((e) => e.path)) if (!c.paths?.[p]) fail(`commercial OpenAPI lacks entitled endpoint ${p} — rebuild`);
  const CRITICAL = ["MetricObject", "StanceSplit", "DnaSnapshot", "MatchupDna", "DnaComparison", "Insight", "Confidence", "DnaOrigin", "MetricDefinition", "SuccessEnvelope", "ErrorEnvelope", "PrimaryImage", "Video"];
  for (const s of CRITICAL) {
    if (!upstreamYaml.components?.schemas?.[s]) { fail(`upstream OpenAPI snapshot lacks schema ${s}`); continue; }
    if (JSON.stringify(c.components?.schemas?.[s]) !== JSON.stringify(upstreamYaml.components.schemas[s])) fail(`commercial schema ${s} differs from upstream — do not fork data shapes`);
  }
  const servers = (c.servers || []).map((s) => s.url);
  if (servers[0] !== gw.api_base_url) fail(`commercial OpenAPI first server must be the gateway that serves /v1 (${gw.api_base_url}), not the documentation site`);
  if (!servers.includes(snapshot.upstream_base_url)) fail(`commercial OpenAPI must keep the canonical server ${snapshot.upstream_base_url}`);
  if (!String(c.info?.version || "").startsWith(snapshot.api_version)) fail(`commercial OpenAPI info.version (${c.info?.version}) is not derived from upstream api_version ${snapshot.api_version} — rebuild`);
  if (c.info?.["x-upstream"]?.commit !== snapshot.commit) fail("commercial OpenAPI x-upstream.commit differs from upstream/ufc-contract.json — rebuild");
  notes.push(`commercial OpenAPI: ${Object.keys(c.paths).length} paths ⊆ upstream ${upPaths.size}; ${CRITICAL.length} critical schemas identical`);
}

/* 3. MetricObject: the OpenAPI schema must list every key the live sample carries. */
const moProps = Object.keys(upstreamYaml.components?.schemas?.MetricObject?.properties || {});
for (const k of snapshot.metric_object_keys || []) if (!moProps.includes(k)) fail(`MetricObject key ${k} seen live is not in the upstream OpenAPI schema`);
for (const k of ["metric_key", "value", "unit", "numerator", "denominator", "sample_bouts", "sample_rounds", "sample_seconds", "confidence", "coverage_status", "definition_version", "origin", "source_families", "as_of_date"]) if (!(snapshot.metric_object_keys || []).includes(k)) fail(`MetricObject contract key missing from snapshot: ${k}`);

/* 4. Live probe. */
if (live) {
  const base = (process.env.UPSTREAM_BASE_URL || snapshot.upstream_base_url).replace(/\/$/, "");
  const get = async (p) => { const r = await fetch(base + p, { headers: { accept: "application/json", "user-agent": "proptechusa-ufc-api/drift-check" } }); return { status: r.status, version: r.headers.get("x-api-version"), body: await r.json().catch(() => null) }; };
  const idx = await get("/v1/ufc");
  if (idx.status !== 200) fail(`live index ${base}/v1/ufc returned ${idx.status}`);
  else {
    if (idx.version !== snapshot.api_version) fail(`API version changed: snapshot ${snapshot.api_version} vs live ${idx.version} — re-run snapshot-upstream, review, rebuild OpenAPI`);
    const livePaths = new Set(["/v1/ufc", ...Object.values(idx.body?.data?.endpoints || {}).map((p) => p.replace(/\?.*$/, ""))]);
    for (const p of snapshot.endpoint_paths) if (!livePaths.has(p)) fail(`endpoint removed or renamed upstream: ${p}`);
    for (const p of livePaths) if (!snapPaths.has(p)) notes.push(`upstream added endpoint (not yet in entitlements): ${p}`);
  }
  const met = await get("/v1/ufc/dna/metrics");
  if (met.status === 200) {
    if (met.body?.data?.definition_version !== snapshot.fight_dna_definition_version) fail(`Fight DNA definition_version changed: ${snapshot.fight_dna_definition_version} → ${met.body?.data?.definition_version}`);
    const liveFamilies = Object.fromEntries(Object.entries(met.body?.data?.families || {}).map(([k, v]) => [k, v.map((m) => m.metric_key)]));
    for (const [fam, keys] of Object.entries(snapshot.metric_families || {})) for (const k of keys) if (!(liveFamilies[fam] || []).includes(k)) fail(`metric ${fam}.${k} no longer public in the live registry`);
  } else fail(`live /v1/ufc/dna/metrics returned ${met.status}`);
  const fdna = await get("/v1/ufc/fighters/ec94d296-2db3-4e0d-be6a-46de4f480672/dna");
  if (fdna.status === 200) {
    const m = fdna.body?.data?.snapshot?.metrics?.sig_landed_per_min || null;
    if (!m) fail("live fighter DNA sample lacks metrics.sig_landed_per_min");
    else for (const k of snapshot.metric_object_keys) if (!(k in m)) fail(`MetricObject changed: live sample lacks ${k}`);
    for (const k of snapshot.required_fields.fighter_dna_snapshot || []) if (!(k in (fdna.body.data.snapshot || {}))) fail(`fighter DNA snapshot field removed: ${k}`);
  } else fail(`live fighter DNA sample returned ${fdna.status}`);
  const ev = await get("/v1/ufc/events?status=upcoming&limit=1");
  const row = ev.body?.data?.[0];
  if (row) for (const k of snapshot.required_fields.event || []) if (!(k in row)) fail(`event field removed: ${k}`);
  for (const k of ["ok", "data", "meta"]) if (ev.body && !(k in ev.body)) fail(`envelope field missing: ${k}`);
  notes.push(`live: api ${idx.version}, definition_version ${met.body?.data?.definition_version}, ${snapshot.endpoint_paths.length} snapshot endpoints verified`);
}

for (const n of notes) console.log(`• ${n}`);
if (problems.length) { console.error(`\n✖ CONTRACT DRIFT (${problems.length})\n` + problems.map((p) => `  - ${p}`).join("\n")); process.exit(1); }
console.log(`✔ upstream contract in sync (${snapshot.repository}@${snapshot.branch} ${String(snapshot.commit).slice(0, 10)}, api ${snapshot.api_version}, Fight DNA v${snapshot.fight_dna_definition_version})`);
