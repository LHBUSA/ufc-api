#!/usr/bin/env node
/* Snapshot the canonical upstream UFC API contract into upstream/.
 *
 *   node scripts/snapshot-upstream.mjs --sha <upstream git sha> [--base https://ufc-api.propbetedge.ai]
 *
 * Writes:
 *   upstream/ufc-contract.json      machine-readable provenance + route inventory + MetricObject key set
 *   upstream/fixtures/*.json        production-safe live responses used by docs, tests and the drift guard
 *
 * The drift guard (scripts/check-upstream-contract.mjs) compares the live API against this snapshot.
 * Nothing here is fabricated: every fixture is a verbatim response from the canonical host.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const gateway = JSON.parse(readFileSync(join(ROOT, "config", "gateway.json"), "utf8"));
const BASE = (opt("--base", process.env.UPSTREAM_BASE_URL || gateway.upstream_base_url)).replace(/\/$/, "");
const SHA = opt("--sha", process.env.UPSTREAM_SHA || null);
const BRANCH = opt("--branch", "ufc-fight-dna-v1");
const OUT = join(ROOT, "upstream");
const FIX = join(OUT, "fixtures");
mkdirSync(FIX, { recursive: true });

/* Real, stable public fighters used for fixtures (UUIDs from the canonical API). */
const STRICKLAND = "ec94d296-2db3-4e0d-be6a-46de4f480672";
const DU_PLESSIS = "9a3b2a15-27d8-4554-9217-42ef2dd5d25c";
/* Noche UFC (2026-09-12) main event, used for the portal showcases: Jean Silva (public-domain portrait) vs Jose Miguel Delgado. */
const NOCHE_EVENT = "1d0b22df-81e7-4e5b-8fa5-8e5d03c24c52";
const SILVA = "eed368a5-484b-412f-9d2c-a4fd6d24d019";
const DELGADO = "55ef67ad-88fe-4f7a-b4cb-dc9a10c12feb";
/* Co-main used for the portal showcases: both fighters carry CC BY 3.0 portraits and are ranked. */
const FIOROT = "2c9c2a88-aec1-4bf0-9b16-3ce58adf6fd6";
const GRASSO = "1d296292-4969-43a8-9948-cd0a76a642ce";
/* Male-led marketing subjects (chosen on real coverage, see docs/SHOWCASE_SUBJECTS.md):
   Gaethje = lightweight champion for the Fighter API demo; Strickland vs Rodrigues = middleweight
   champion vs #7, the best-comparing male pair in the archive (17/18 metrics non-null on both sides). */
const GAETHJE = "91218960-ded4-4375-890a-f3208575b374";
const RODRIGUES = "2d93f8f3-ccaa-420c-b8d5-f446da57bec5";

const FIXTURES = {
  index: "/v1/ufc",
  health: "/health",
  counts: "/v1/ufc/counts",
  events_upcoming: "/v1/ufc/events?status=upcoming&limit=3",
  rankings_middleweight: "/v1/ufc/rankings?division=MIDDLEWEIGHT",
  search_strickland: "/v1/ufc/search?q=strickland&limit=3",
  fighter_detail: `/v1/ufc/fighters/${STRICKLAND}?include=ranking,next`,
  fighter_history: `/v1/ufc/fighters/${STRICKLAND}/history?limit=3`,
  fighter_stats: `/v1/ufc/fighters/${STRICKLAND}/stats`,
  results: "/v1/ufc/results?limit=2",
  news: "/v1/ufc/news?limit=2",
  videos: "/v1/ufc/videos?limit=2",
  dna_metrics: "/v1/ufc/dna/metrics",
  dna_query: "/v1/ufc/dna/query?metric=sig_landed_per_min&min_confidence=medium&limit=3",
  fighter_dna: `/v1/ufc/fighters/${STRICKLAND}/dna`,
  fighter_dna_asof_404: `/v1/ufc/fighters/${STRICKLAND}/dna?as_of=2024-01-01`,
  fighter_splits: `/v1/ufc/fighters/${STRICKLAND}/splits`,
  fighter_splits_southpaw: `/v1/ufc/fighters/${STRICKLAND}/splits?opponent_stance=SOUTHPAW`,
  fighter_round_profile: `/v1/ufc/fighters/${STRICKLAND}/round-profile`,
  fighter_finish_profile: `/v1/ufc/fighters/${STRICKLAND}/finish-profile`,
  fighter_position_profile: `/v1/ufc/fighters/${STRICKLAND}/position-profile`,
  matchup_dna: `/v1/ufc/matchups/${STRICKLAND}/${DU_PLESSIS}/dna`,
  unknown_fighter_404: "/v1/ufc/fighters/00000000-0000-0000-0000-000000000000/dna",
  unknown_route_404: "/v1/ufc/does-not-exist",
  noche_card: `/v1/ufc/events/${NOCHE_EVENT}/card`,
  noche_event: `/v1/ufc/events/${NOCHE_EVENT}`,
  rankings_featherweight: "/v1/ufc/rankings?division=FEATHERWEIGHT",
  rankings_flyweight: "/v1/ufc/rankings?division=FLYWEIGHT",
  rankings_lightweight: "/v1/ufc/rankings?division=LIGHTWEIGHT",
  ...(SILVA ? {
    silva_detail: `/v1/ufc/fighters/${SILVA}?include=ranking,next,history&history_limit=5`,
    silva_stats: `/v1/ufc/fighters/${SILVA}/stats`,
    silva_dna: `/v1/ufc/fighters/${SILVA}/dna`,
    silva_splits: `/v1/ufc/fighters/${SILVA}/splits`,
    silva_round_profile: `/v1/ufc/fighters/${SILVA}/round-profile`,
    silva_finish_profile: `/v1/ufc/fighters/${SILVA}/finish-profile`,
    silva_videos: `/v1/ufc/fighters/${SILVA}/videos?limit=3`,
  } : {}),
  fiorot_detail: `/v1/ufc/fighters/${FIOROT}?include=ranking,next,history&history_limit=5`,
  fiorot_dna: `/v1/ufc/fighters/${FIOROT}/dna`,
  fiorot_stats: `/v1/ufc/fighters/${FIOROT}/stats`,
  grasso_detail: `/v1/ufc/fighters/${GRASSO}?include=ranking,next,history&history_limit=5`,
  grasso_dna: `/v1/ufc/fighters/${GRASSO}/dna`,
  grasso_stats: `/v1/ufc/fighters/${GRASSO}/stats`,
  matchup_comain: `/v1/ufc/matchups/${FIOROT}/${GRASSO}/dna`,
  gaethje_detail: `/v1/ufc/fighters/${GAETHJE}?include=ranking,next,history&history_limit=6`,
  gaethje_dna: `/v1/ufc/fighters/${GAETHJE}/dna`,
  gaethje_stats: `/v1/ufc/fighters/${GAETHJE}/stats`,
  rodrigues_detail: `/v1/ufc/fighters/${RODRIGUES}?include=ranking,next`,
  rodrigues_dna: `/v1/ufc/fighters/${RODRIGUES}/dna`,
  matchup_mw: `/v1/ufc/matchups/${STRICKLAND}/${RODRIGUES}/dna`,
  rankings_womens_flyweight: "/v1/ufc/rankings?division=FLYWEIGHT&womens=true",
  ...(SILVA && DELGADO ? { delgado_detail: `/v1/ufc/fighters/${DELGADO}?include=ranking`, delgado_dna: `/v1/ufc/fighters/${DELGADO}/dna`, matchup_noche: `/v1/ufc/matchups/${SILVA}/${DELGADO}/dna` } : {}),
};

async function get(path) {
  const res = await fetch(BASE + path, { headers: { accept: "application/json", "user-agent": "proptechusa-ufc-api/snapshot" } });
  const text = await res.text();
  let body = null; try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 2000) }; }
  return { status: res.status, headers: Object.fromEntries(res.headers), body };
}

const captured_at = new Date().toISOString();
const results = {};
for (const [name, path] of Object.entries(FIXTURES)) {
  const r = await get(path);
  results[name] = r;
  writeFileSync(join(FIX, `${name}.json`), JSON.stringify({ captured_at, base: BASE, path, status: r.status, api_version: r.headers["x-api-version"] || null, body: r.body }, null, 2) + "\n");
  console.log(`${String(r.status).padEnd(4)} ${name.padEnd(28)} ${path}`);
}

/* second pass: bulk media for the ranked fighters we render (needs ids from the rankings response) */
for (const [name, src] of [["rankings_middleweight_media", "rankings_middleweight"], ["rankings_lightweight_media", "rankings_lightweight"], ["rankings_womens_flyweight_media", "rankings_womens_flyweight"], ["rankings_featherweight_media", "rankings_featherweight"]]) {
  const div = results[src]?.body?.data?.divisions?.[0];
  if (!div) continue;
  const ids = [div.champion?.fighter_id, ...div.entries.map((e) => e.fighter_id)].filter(Boolean).slice(0, 12);
  if (!ids.length) continue;
  const path = `/v1/ufc/fighters/media?ids=${ids.join(",")}`;
  const r = await get(path);
  results[name] = r;
  writeFileSync(join(FIX, `${name}.json`), JSON.stringify({ captured_at, base: BASE, path, status: r.status, api_version: r.headers["x-api-version"] || null, body: r.body }, null, 2) + "\n");
  console.log(`${String(r.status).padEnd(4)} ${name.padEnd(28)} ${path.slice(0, 60)}…`);
}

const index = results.index.body?.data || {};
const metrics = results.dna_metrics.body?.data || {};
const sample = results.fighter_dna.body?.data?.snapshot?.metrics?.sig_landed_per_min || null;
const eventRow = results.events_upcoming.body?.data?.[0] || null;
const fighterRow = results.fighter_detail.body?.data || null;

const contract = {
  repository: "LHBUSA/UFC",
  branch: BRANCH,
  commit: SHA,
  captured_at,
  upstream_base_url: BASE,
  api_version: results.index.headers["x-api-version"] || index.version || null,
  api_name: index.name || null,
  fight_dna_definition_version: metrics.definition_version ?? null,
  endpoints: index.endpoints || {},
  endpoint_paths: [...new Set(["/v1/ufc", ...Object.values(index.endpoints || {}).map((p) => p.replace(/\?.*$/, ""))])].sort(),
  envelope: { success: ["ok", "data", "meta"], error: ["ok", "data", "error", "meta"], error_fields: ["code", "message"], meta_fields: ["api", "version", "request_id"] },
  headers: ["X-Request-Id", "X-API-Version"],
  metric_object_keys: sample ? Object.keys(sample).sort() : null,
  metric_object_sample: sample,
  origin_labels: metrics.origin_labels || null,
  confidence_tiers: metrics.confidence_tiers ? Object.keys(metrics.confidence_tiers) : null,
  as_of_semantics: metrics.as_of_semantics || null,
  metric_families: metrics.families ? Object.fromEntries(Object.entries(metrics.families).map(([k, v]) => [k, v.map((m) => m.metric_key)])) : null,
  required_fields: {
    event: eventRow ? Object.keys(eventRow).sort() : null,
    fighter: fighterRow ? Object.keys(fighterRow).filter((k) => !["ranking", "next_bout", "images", "primary_image"].includes(k)).sort() : null,
    fighter_dna_snapshot: results.fighter_dna.body?.data?.snapshot ? Object.keys(results.fighter_dna.body.data.snapshot).sort() : null,
    matchup_dna: results.matchup_dna.body?.data ? Object.keys(results.matchup_dna.body.data).sort() : null,
    dna_comparison: results.matchup_dna.body?.data?.comparisons?.[0] ? Object.keys(results.matchup_dna.body.data.comparisons[0]).sort() : null,
  },
  error_codes_observed: {
    fighter_not_found: results.unknown_fighter_404.body?.error?.code || null,
    dna_not_available: results.fighter_dna_asof_404.body?.error?.code || null,
    route_not_found: results.unknown_route_404.body?.error?.code || null,
  },
  notes: [],
};
const prev = existsSync(join(OUT, "ufc-contract.json")) ? JSON.parse(readFileSync(join(OUT, "ufc-contract.json"), "utf8")) : null;
if (prev?.notes?.length) contract.notes = prev.notes;
if (!contract.commit && prev?.commit) contract.commit = prev.commit;
writeFileSync(join(OUT, "ufc-contract.json"), JSON.stringify(contract, null, 2) + "\n");
console.log(`\nupstream/ufc-contract.json written: api_version=${contract.api_version} definition_version=${contract.fight_dna_definition_version} endpoints=${contract.endpoint_paths.length} commit=${contract.commit}`);
