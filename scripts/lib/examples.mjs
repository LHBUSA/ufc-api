/* Real API examples for docs + OpenAPI: verbatim live fixtures from upstream/fixtures, subset (never edited) for size. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");

export const EXAMPLES = {
  index: "index", events: "events_upcoming", fighter: "fighter_detail", fighter_history: "fighter_history", fighter_stats: "fighter_stats",
  results: "results", rankings: "rankings_middleweight", news: "news", search: "search_strickland", counts: "counts", videos: "videos",
  dna_metrics: "dna_metrics", dna_query: "dna_query", fighter_dna: "fighter_dna", fighter_splits: "fighter_splits", fighter_round_profile: "fighter_round_profile",
  fighter_finish_profile: "fighter_finish_profile", fighter_position_profile: "fighter_position_profile", matchup_dna: "matchup_dna",
};

export function fixture(name) {
  const p = join(ROOT, "upstream", "fixtures", `${name}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}

/** Subset a large live body for display. Values are never altered; omitted branches are marked with "…". */
export function trimExample(name, body) {
  if (!body || !body.data) return body;
  const clone = JSON.parse(JSON.stringify(body));
  if (name === "fighter_dna") {
    const s = clone.data.snapshot;
    const keep = ["sig_landed_per_min", "sig_absorbed_per_min", "sig_accuracy", "td_attempts_per_15", "finish_rate", "pace_retention_r3_vs_r1"];
    s.metrics = Object.fromEntries(keep.filter((k) => s.metrics[k]).map((k) => [k, s.metrics[k]]));
    s.stance_splits = { SOUTHPAW: s.stance_splits.SOUTHPAW, open: s.stance_splits.open, "…": "other stances omitted from this example" };
    s.context_splits = { "…": "omitted from this example" };
    s.provenance = { ...s.provenance, bouts: (s.provenance?.bouts || []).slice(0, 2) };
  }
  if (name === "matchup_dna") {
    for (const side of ["a", "b"]) clone.data[side] = { as_of_date: clone.data[side].as_of_date, sample_bouts: clone.data[side].sample_bouts, sample_rounds: clone.data[side].sample_rounds, coverage_status: clone.data[side].coverage_status, "…": "full snapshot subset omitted from this example" };
    clone.data.comparisons = clone.data.comparisons.slice(0, 3);
    clone.data.insights = clone.data.insights.slice(0, 2);
    clone.data.bettors_edge_evidence = clone.data.bettors_edge_evidence.slice(0, 1);
    clone.data.stance_context = { a_stance: clone.data.stance_context.a_stance, b_stance: clone.data.stance_context.b_stance, context: clone.data.stance_context.context, "…": "split blocks omitted from this example" };
  }
  if (name === "dna_metrics") {
    clone.data.families = { striking: (clone.data.families.striking || []).slice(0, 2), "…": "other families omitted from this example" };
    clone.data.metrics = (clone.data.metrics || []).slice(0, 2);
  }
  if (name === "fighter_stats") { clone.data.round_stats = (clone.data.round_stats || []).slice(0, 2); if (clone.data.computed?.bouts) clone.data.computed.bouts = clone.data.computed.bouts.slice(0, 1); }
  if (name === "fighter_splits") clone.data.splits = (clone.data.splits || []).slice(0, 2);
  if (name === "rankings_middleweight") clone.data.divisions = (clone.data.divisions || []).map((d) => ({ ...d, entries: (d.entries || []).slice(0, 3) }));
  if (name === "fighter_detail") { clone.data.images = (clone.data.images || []).slice(0, 1); }
  return clone;
}

/** Everything the portal needs, keyed by fixture name. */
export function portalExamples() {
  const out = {};
  for (const name of [...new Set(Object.values(EXAMPLES)), "fighter_dna_asof_404", "unknown_fighter_404", "counts", "index", "health"]) {
    const f = fixture(name);
    if (!f) continue;
    out[name] = { captured_at: f.captured_at, path: f.path, status: f.status, api_version: f.api_version, body: trimExample(name, f.body) };
  }
  const reg = fixture("dna_metrics");
  if (reg?.body?.data) {
    const d = reg.body.data;
    out.dna_registry = { captured_at: reg.captured_at, definition_version: d.definition_version, origin_labels: d.origin_labels, confidence_tiers: d.confidence_tiers, as_of_semantics: d.as_of_semantics, families: Object.fromEntries(Object.entries(d.families || {}).map(([k, v]) => [k, v.map((m) => ({ metric_key: m.metric_key, display_name: m.display_name, description: m.description, unit: m.unit, formula: m.formula, source_families: m.source_families, min_bouts: m.min_bouts, min_rounds: m.min_rounds, min_seconds: m.min_seconds }))])) };
  }
  const cnt = fixture("counts");
  if (cnt?.body?.data) out.counts_full = { captured_at: cnt.captured_at, ...cnt.body.data };
  const mu = fixture("matchup_dna");
  if (mu?.body?.data) out.matchup_meta = { comparisons: mu.body.data.comparisons.map((c) => ({ key: c.key, label: c.label, family: c.family })), insight_rules: mu.body.meta?.insight_rules || null, insights: mu.body.data.insights.map((i) => ({ key: i.key, label: i.label, explanation: i.explanation, confidence: i.confidence, sample_bouts: i.sample_bouts, sample_rounds: i.sample_rounds, sample_seconds: i.sample_seconds })), warnings: mu.body.data.warnings, note: mu.body.data.note, fighters: mu.body.data.fighters.map((f) => f.name) };
  const full = fixture("fighter_dna");
  const m = full?.body?.data?.snapshot?.metrics || {};
  out.receipts = m.sig_landed_per_min ? { fighter: full.body.data.fighter.name, metric: m.sig_landed_per_min, snapshot: { as_of_date: full.body.data.snapshot.as_of_date, sample_bouts: full.body.data.snapshot.sample_bouts, sample_rounds: full.body.data.snapshot.sample_rounds, sample_seconds: full.body.data.snapshot.sample_seconds, coverage_status: full.body.data.snapshot.coverage_status }, captured_at: full.captured_at } : null;
  return out;
}
