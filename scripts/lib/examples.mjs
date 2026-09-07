/* Real API examples for docs + OpenAPI + portal showcases: verbatim live fixtures from upstream/fixtures,
 * subset (never edited) for size. Nothing here is invented; missing values stay null. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");

export const EXAMPLES = {
  index: "index", events: "events_upcoming", fighter: "fighter_detail", fighter_history: "fighter_history", fighter_stats: "fighter_stats",
  results: "results", rankings: "rankings_middleweight", news: "news", search: "search_strickland", counts: "counts", videos: "videos",
  dna_metrics: "dna_metrics", dna_query: "dna_query", fighter_dna: "fighter_dna", fighter_splits: "fighter_splits", fighter_round_profile: "fighter_round_profile",
  fighter_finish_profile: "fighter_finish_profile", fighter_position_profile: "fighter_position_profile", matchup_dna: "matchup_dna", event_card: "noche_card", event: "noche_event",
};

export function fixture(name) {
  const p = join(ROOT, "upstream", "fixtures", `${name}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}

/** Subset a large live body for display. Values are never altered; omitted branches are marked with "…". */
export function trimExample(name, body) {
  if (!body || !body.data) return body;
  const clone = JSON.parse(JSON.stringify(body));
  if (name === "fighter_dna" || name === "silva_dna" || name === "delgado_dna") {
    const s = clone.data.snapshot;
    const keep = ["sig_landed_per_min", "sig_absorbed_per_min", "sig_accuracy", "td_attempts_per_15", "finish_rate", "pace_retention_r3_vs_r1"];
    s.metrics = Object.fromEntries(keep.filter((k) => s.metrics[k]).map((k) => [k, s.metrics[k]]));
    s.stance_splits = { SOUTHPAW: s.stance_splits.SOUTHPAW, open: s.stance_splits.open, "…": "other stances omitted from this example" };
    s.context_splits = { "…": "omitted from this example" };
    s.provenance = { ...s.provenance, bouts: (s.provenance?.bouts || []).slice(0, 2) };
  }
  if (name === "matchup_dna" || name === "matchup_noche") {
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
  if (name === "fighter_stats" || name === "silva_stats") { clone.data.round_stats = (clone.data.round_stats || []).slice(0, 2); if (clone.data.computed?.bouts) clone.data.computed.bouts = clone.data.computed.bouts.slice(0, 1); }
  if (name === "fighter_splits" || name === "silva_splits") clone.data.splits = (clone.data.splits || []).slice(0, 2);
  if (name.startsWith("rankings_")) clone.data.divisions = (clone.data.divisions || []).map((d) => ({ ...d, entries: (d.entries || []).slice(0, 3) }));
  if (name === "fighter_detail" || name === "silva_detail" || name === "delgado_detail") { clone.data.images = (clone.data.images || []).slice(0, 1); if (clone.data.history) clone.data.history = clone.data.history.slice(0, 1); }
  if (name === "noche_card") clone.data.bouts = clone.data.bouts.slice(0, 2).map((b) => ({ ...b, fighter_a: { ...b.fighter_a, images: undefined }, fighter_b: { ...b.fighter_b, images: undefined } }));
  return clone;
}

/* Compact projections for the portal's rendered previews (all values verbatim from fixtures). */
const compactImage = (img) => (img ? { id: img.id, image_url: img.image_url, card_url: img.card_url, thumb_url: img.thumb_url, author: img.author, license: img.license, source_url: img.source_url, kind: img.kind, attribution_text: img.attribution_text, rights_label: img.rights_label } : null);
const compactFighter = (f) => (f ? { id: f.id, name: f.name, nickname: f.nickname ?? null, slug_id: f.slug_id ?? null, stance: f.stance ?? null, record_w: f.record_w ?? null, record_l: f.record_l ?? null, record_d: f.record_d ?? null, record_nc: f.record_nc ?? null, height_in: f.height_in ?? null, reach_in: f.reach_in ?? null, weight_lbs: f.weight_lbs ?? null, dob: f.dob ?? null, is_active: f.is_active ?? null, primary_image: compactImage(f.primary_image), ranking: f.ranking ? { snapshot_date: f.ranking.snapshot_date, source: f.ranking.source, positions: f.ranking.positions } : null, career: { slpm: f.career_slpm ?? null, str_acc: f.career_str_acc ?? null, sapm: f.career_sapm ?? null, str_def: f.career_str_def ?? null, td_avg: f.career_td_avg ?? null, td_acc: f.career_td_acc ?? null, td_def: f.career_td_def ?? null, sub_avg: f.career_sub_avg ?? null }, fight_history_count: f.fight_history_count ?? null, next_bout: f.next_bout ? { event: f.next_bout.event ? { id: f.next_bout.event.id, name: f.next_bout.event.name, event_date: f.next_bout.event.event_date } : null, opponent: f.next_bout.opponent ? { id: f.next_bout.opponent.id, name: f.next_bout.opponent.name } : null } : null } : null);
const metricPick = (metrics, keys) => Object.fromEntries(keys.map((k) => [k, metrics?.[k] ?? null]));
const DNA_KEYS = ["sig_landed_per_min", "sig_absorbed_per_min", "sig_accuracy", "sig_defense", "td_attempts_per_15", "td_landed_per_15", "td_accuracy", "control_share", "sub_attempts_per_15", "knockdowns_per_15", "finish_rate", "ko_finish_rate", "submission_finish_rate", "pace_retention_r2_vs_r1", "pace_retention_r3_vs_r1", "head_attack_share", "body_attack_share", "leg_attack_share", "distance_attack_share", "clinch_attack_share", "ground_attack_share"];
const snapshotView = (s) => (s ? { as_of_date: s.as_of_date, definition_version: s.definition_version, sample_bouts: s.sample_bouts, sample_completed_bouts: s.sample_completed_bouts, sample_stat_bouts: s.sample_stat_bouts, sample_rounds: s.sample_rounds, sample_seconds: s.sample_seconds, coverage_status: s.coverage_status, metrics: metricPick(s.metrics, DNA_KEYS), finish_profile: s.finish_profile ? { finished_by: s.finish_profile.finished_by ?? null, finish_round_distribution: s.finish_profile.finish_round_distribution ?? null } : null, origin: s.origin } : null);

function showcase(name, detailName, dnaName, statsName, historyName) {
  const d = fixture(detailName), dna = fixture(dnaName), st = statsName ? fixture(statsName) : null;
  if (!d?.body?.data) return null;
  const f = d.body.data;
  return {
    captured_at: d.captured_at, paths: { detail: d.path, dna: dna?.path || null, stats: st?.path || null },
    fighter: compactFighter(f),
    history: (f.history || []).slice(0, 5).map((h) => ({ bout_id: h.id, event: h.event ? { name: h.event.name, event_date: h.event.event_date } : null, opponent: h.opponent ? { id: h.opponent.id, name: h.opponent.name } : null, outcome: h.outcome ?? null, result: h.result ? { method: h.result.method ?? null, round: h.result.round ?? null, time: h.result.time ?? null } : null, weight_class: h.weight_class ?? null })),
    dna: dna?.body?.ok ? snapshotView(dna.body.data.snapshot) : { unavailable: dna?.body?.error || null },
    dna_meta: dna?.body?.meta ? { resolved_as_of: dna.body.meta.resolved_as_of, origin_label: dna.body.meta.origin_label } : null,
    career_rates: st?.body?.data?.computed?.career_rates || null,
    career_provenance: st?.body?.data?.computed?.provenance || null,
    career_snapshot: st?.body?.data?.career_snapshot || null,
    career_warning: st?.body?.data?.warning || null,
  };
}

/** Everything the portal needs, keyed by fixture name. */
export function portalExamples() {
  const out = {};
  for (const name of [...new Set(Object.values(EXAMPLES)), "fighter_dna_asof_404", "unknown_fighter_404", "counts", "index", "health", "silva_dna", "matchup_noche", "silva_detail", "rankings_featherweight", "rankings_flyweight"]) {
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

  /* Showcases (rendered previews) */
  out.showcase = {
    hero: showcase("strickland", "fighter_detail", "fighter_dna", "fighter_stats", "fighter_history"),
    fighter: showcase("silva", "silva_detail", "silva_dna", "silva_stats", null),
    opponent: showcase("delgado", "delgado_detail", "delgado_dna", null, null),
  };
  const mn = fixture("matchup_noche");
  if (mn?.body?.data) {
    const d = mn.body.data;
    /* The matchup response returns compact fighters (no reach/height/ranking). A real product composes the fighter
       endpoint alongside it, so the demo does the same: identity fields come from /fighters/{id}, metrics from the matchup. */
    const details = Object.fromEntries([fixture("silva_detail"), fixture("delgado_detail")].filter((f) => f?.body?.data).map((f) => [f.body.data.id, f.body.data]));
    const enrich = (f) => { const c = compactFighter(f); const dd = details[f.id]; return dd ? { ...c, height_in: dd.height_in ?? c.height_in, reach_in: dd.reach_in ?? c.reach_in, weight_lbs: dd.weight_lbs ?? c.weight_lbs, dob: dd.dob ?? c.dob, ranking: dd.ranking ? { snapshot_date: dd.ranking.snapshot_date, source: dd.ranking.source, positions: dd.ranking.positions } : c.ranking, _identity_from: "/v1/ufc/fighters/{id}" } : c; };
    out.showcase.matchup = { captured_at: mn.captured_at, path: mn.path, fighters: d.fighters.map(enrich), a: snapshotView(d.a), b: snapshotView(d.b), comparisons: d.comparisons.map((c) => ({ key: c.key, label: c.label, unit: c.unit, family: c.family, higher_is_better: c.higher_is_better, a: c.a ? { value: c.a.value, confidence: c.a.confidence, sample_bouts: c.a.sample_bouts } : null, b: c.b ? { value: c.b.value, confidence: c.b.confidence, sample_bouts: c.b.sample_bouts } : null, delta: c.delta, direction: c.direction, comparable: c.comparable })), stance_context: { a_stance: d.stance_context.a_stance, b_stance: d.stance_context.b_stance, context: d.stance_context.context }, insights: d.insights.map((i) => ({ key: i.key, label: i.label, value: i.value, unit: i.unit, side: i.side, confidence: i.confidence, sample_bouts: i.sample_bouts, sample_rounds: i.sample_rounds, sample_seconds: i.sample_seconds, explanation: i.explanation })), warnings: d.warnings, note: d.note, meta: { resolved_as_of: mn.body.meta?.resolved_as_of, insights: mn.body.meta?.insights, warnings: mn.body.meta?.warnings, comparable: mn.body.meta?.comparable, comparisons: mn.body.meta?.comparisons } };
  }
  const card = fixture("noche_card");
  if (card?.body?.data) {
    const d = card.body.data;
    out.showcase.event = { captured_at: card.captured_at, path: card.path, event: { id: d.event.id, name: d.event.name, event_date: d.event.event_date, venue: d.event.venue, city: d.event.city, region: d.event.region, country: d.event.country, card_status: d.event.card_status, is_ppv: d.event.is_ppv }, bout_count: d.bouts.length, bouts: d.bouts.map((b) => ({ id: b.id, bout_order: b.bout_order, card_position: b.card_position, weight_class: b.weight_class, is_title: b.is_title, is_womens: b.is_womens, scheduled_rounds: b.scheduled_rounds, status: b.status, fighter_a: compactFighter(b.fighter_a), fighter_b: compactFighter(b.fighter_b), result: b.result ? { winner_id: b.result.winner_id ?? null, method: b.result.method ?? null } : null })) };
  }
  for (const div of ["featherweight", "flyweight", "middleweight"]) {
    const r = fixture(`rankings_${div}`);
    if (r?.body?.data) { const dv = r.body.data.divisions[0]; out.showcase[`rankings_${div}`] = { captured_at: r.captured_at, path: r.path, source: r.body.data.source, source_url: r.body.data.source_url, snapshot_date: r.body.data.snapshot_date, division: { key: dv.key, label: dv.label, is_womens: dv.is_womens, champion: dv.champion ? { name: dv.champion.name, fighter_id: dv.champion.fighter_id, slug_id: dv.champion.fighter?.slug_id ?? null } : null, entries: dv.entries.map((e) => ({ rank: e.rank, name: e.name, fighter_id: e.fighter_id, change: e.change, is_new: e.is_new })) } }; }
  }
  return out;
}
