#!/usr/bin/env node
/* Refresh the PUBLIC SHOWCASE SNAPSHOT that the marketing site renders.
 *
 *   node scripts/refresh-showcase.mjs [--base https://ufc-api.propbetedge.ai] [--dry-run]
 *
 * This is deliberately NOT the same thing as upstream/fixtures/:
 *   upstream/fixtures/            TEST FIXTURES  — deterministic, stable subjects, drive tests + drift guard + OpenAPI examples.
 *   apps/web/src/generated/showcase.json   PUBLIC SHOWCASE — refreshed on a schedule, auto-selected subjects, rendered by the site.
 *
 * Subjects are selected by score, not hard-coded, so the site follows the archive as the backfill runs:
 * the next non-DWCS event, a male showcase fighter, the best-comparing male matchup, a men's ranking division
 * with deep portrait coverage, and a provenance metric with real confidence.
 *
 * Fail-closed: a malformed or regressive upstream response leaves the previous good snapshot in place and exits 1.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
/* the SAME media policy the site renders with; imported, never re-implemented */
const { resolveFighterMedia, mediaCoverage, ESPN_HEADSHOT } = await import(pathToFileURL(join(ROOT, "apps", "web", "src", "lib", "media-policy.mjs")).href);
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const DRY = args.includes("--dry-run");
const gateway = JSON.parse(readFileSync(join(ROOT, "config", "gateway.json"), "utf8"));
const BASE = (opt("--base", process.env.UPSTREAM_BASE_URL || gateway.upstream_base_url)).replace(/\/$/, "");
const OUT = join(ROOT, "apps", "web", "src", "generated", "showcase.json");
const captured_at = new Date().toISOString();

/* An internal credential is only ever read from the process environment (GitHub Actions secret / shell),
   never written into the generated snapshot and never shipped to the browser. */
const UPSTREAM_KEY = process.env.UPSTREAM_API_KEY || "";
const headers = { accept: "application/json", "user-agent": "proptechusa-ufc-api/refresh-showcase" };
if (UPSTREAM_KEY) headers["x-api-key"] = UPSTREAM_KEY;

const problems = [];
const note = (m) => console.log("  " + m);
let calls = 0;
async function get(path) {
  calls++;
  const res = await fetch(BASE + path, { headers });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = null; }
  if (!res.ok || !body || body.ok !== true) return { ok: false, status: res.status, path, api_version: res.headers.get("x-api-version"), error: body?.error || { code: "bad_response", message: text.slice(0, 160) } };
  return { ok: true, status: res.status, path, api_version: res.headers.get("x-api-version"), data: body.data, meta: body.meta };
}
const wrap = (r) => ({ captured_at, upstream_base: BASE, path: r.path, status: r.status, api_version: r.api_version });

/* ---------- media policy (mirrors apps/web/src/lib/media.ts) ---------- */
const APPROVED = /^(cc[ -]?by(-sa)?(\s*\d(\.\d)?)?|cc0(\s*1\.0)?|public domain|pd(-[a-z]+)?)$/i;
const okImage = (im) => !!(im && im.card_url && APPROVED.test(String(im.rights_label || im.license || "").trim()));
const compactImage = (im) => (im ? { id: im.id, image_url: im.image_url, card_url: im.card_url, thumb_url: im.thumb_url, author: im.author, license: im.license, source_url: im.source_url, kind: im.kind, attribution_text: im.attribution_text, rights_label: im.rights_label } : null);
const compactFighter = (f) => (f ? {
  id: f.id, name: f.name, nickname: f.nickname ?? null,
  /* Canonical join key for both the consumer deep link and the display-only media source. The detail
     endpoint calls it slug_id, the card endpoint espn_athlete_id; they are the same ESPN athlete id. */
  slug_id: f.slug_id ?? f.espn_athlete_id ?? null, stance: f.stance ?? null,
  record_w: f.record_w ?? null, record_l: f.record_l ?? null, record_d: f.record_d ?? null, record_nc: f.record_nc ?? null,
  height_in: f.height_in ?? null, reach_in: f.reach_in ?? null, weight_lbs: f.weight_lbs ?? null, dob: f.dob ?? null, is_active: f.is_active ?? null,
  primary_image: compactImage(f.primary_image),
  ranking: f.ranking ? { snapshot_date: f.ranking.snapshot_date, source: f.ranking.source, positions: f.ranking.positions } : null,
  career: { slpm: f.career_slpm ?? null, str_acc: f.career_str_acc ?? null, sapm: f.career_sapm ?? null, str_def: f.career_str_def ?? null, td_avg: f.career_td_avg ?? null, td_acc: f.career_td_acc ?? null, td_def: f.career_td_def ?? null, sub_avg: f.career_sub_avg ?? null },
  fight_history_count: f.fight_history_count ?? null,
  next_bout: f.next_bout ? { event: f.next_bout.event ? { id: f.next_bout.event.id, name: f.next_bout.event.name, event_date: f.next_bout.event.event_date } : null, opponent: f.next_bout.opponent ? { id: f.next_bout.opponent.id, name: f.next_bout.opponent.name } : null } : null,
} : null);
const DNA_KEYS = ["sig_landed_per_min", "sig_absorbed_per_min", "sig_accuracy", "sig_defense", "td_attempts_per_15", "td_landed_per_15", "td_accuracy", "control_share", "control_seconds_per_td", "sub_attempts_per_15", "knockdowns_per_15", "finish_rate", "ko_finish_rate", "submission_finish_rate", "pace_retention_r2_vs_r1", "pace_retention_r3_vs_r1", "head_attack_share", "body_attack_share", "leg_attack_share", "distance_attack_share", "clinch_attack_share", "ground_attack_share"];
const snapshotView = (s) => (s ? {
  as_of_date: s.as_of_date, definition_version: s.definition_version,
  sample_bouts: s.sample_bouts, sample_completed_bouts: s.sample_completed_bouts, sample_stat_bouts: s.sample_stat_bouts,
  sample_rounds: s.sample_rounds, sample_seconds: s.sample_seconds, coverage_status: s.coverage_status,
  metrics: Object.fromEntries(DNA_KEYS.map((k) => [k, s.metrics?.[k] ?? null])),
  finish_profile: s.finish_profile ? { finished_by: s.finish_profile.finished_by ?? null, finish_round_distribution: s.finish_profile.finish_round_distribution ?? null } : null,
  origin: s.origin,
} : null);
/* Verbatim response bodies, subset for size. Field names and values are untouched; omitted branches are
   marked with an ellipsis key so a reader can see something was left out. */
const trimBody = (kind, body) => {
  if (!body) return null;
  const b = JSON.parse(JSON.stringify(body));
  if (kind === "card") { const n = b.data.bouts.length; b.data.bouts = b.data.bouts.slice(0, 2).map((x) => ({ ...x, fighter_a: { ...x.fighter_a, images: undefined }, fighter_b: { ...x.fighter_b, images: undefined } })); if (n > 2) b.data["…"] = `${n - 2} more bouts omitted from this example`; }
  if (kind === "fighter") { b.data.images = (b.data.images || []).slice(0, 1); if (b.data.history) b.data.history = b.data.history.slice(0, 2); }
  if (kind === "dna") { const s2 = b.data.snapshot; const keep = ["sig_landed_per_min", "sig_accuracy", "sig_defense", "td_attempts_per_15", "finish_rate", "pace_retention_r3_vs_r1"]; s2.metrics = Object.fromEntries(keep.filter((k) => s2.metrics[k]).map((k) => [k, s2.metrics[k]])); s2.metrics["…"] = "more metric keys omitted from this example"; s2.stance_splits = { "…": "stance splits omitted from this example" }; s2.context_splits = { "…": "omitted" }; if (s2.provenance) s2.provenance = { ...s2.provenance, bouts: (s2.provenance.bouts || []).slice(0, 2) }; }
  if (kind === "matchup") { b.data.a = { as_of_date: b.data.a.as_of_date, sample_bouts: b.data.a.sample_bouts, coverage_status: b.data.a.coverage_status, "…": "snapshot subset omitted" }; b.data.b = { as_of_date: b.data.b.as_of_date, sample_bouts: b.data.b.sample_bouts, coverage_status: b.data.b.coverage_status, "…": "snapshot subset omitted" }; const nc = b.data.comparisons.length, ni = b.data.insights.length; b.data.comparisons = b.data.comparisons.slice(0, 3); b.data.insights = b.data.insights.slice(0, 2); b.data.bettors_edge_evidence = (b.data.bettors_edge_evidence || []).slice(0, 1); b.data["…"] = `${nc - 3} more comparisons and ${ni - 2} more insights omitted from this example`; }
  if (kind === "rankings") { b.data.divisions = (b.data.divisions || []).map((d) => ({ ...d, entries: (d.entries || []).slice(0, 3) })); }
  return b;
};
const isWomensLabel = (l) => /women/i.test(String(l || ""));
const rankOf = (f) => (f?.ranking?.positions || []).filter((p) => !p.is_p4p)[0] || null;
const dnaScore = (dna) => (dna ? (dna.sample_stat_bouts || 0) * 6 + Math.min(30, (dna.sample_rounds || 0) * 2) + Math.min(20, Math.round((dna.sample_seconds || 0) / 300)) + (dna.coverage_status === "high" ? 12 : dna.coverage_status === "medium" ? 8 : dna.coverage_status === "low" ? 3 : 0) : 0);
const nonNullMetrics = (dna) => (dna ? Object.values(dna.metrics).filter((m) => m && m.value !== null && m.value !== undefined).length : 0);


/* ---------- fighter media parity ----------
   The consumer product resolves a fighter portrait from the canonical store first and falls back to the
   ESPN headshot keyed on the athlete id. The API site now does the same, so a fighter with a picture on
   ufc.propbetedge.ai is not a silhouette here. The headshot is DISPLAY-ONLY: it is confirmed to exist,
   credited to ESPN, and never described as rights-cleared. It is not added to any /v1 response. */
const espnSeen = new Map();
let espnProbes = 0;
async function espnAvailable(athleteId) {
  if (!athleteId) return false;
  const key = String(athleteId);
  if (espnSeen.has(key)) return espnSeen.get(key);
  if (espnProbes >= 120) return false; /* bounded; unprobed fighters stay on the stored/none path */
  espnProbes++;
  let ok = false;
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 8000);
    const r = await fetch(ESPN_HEADSHOT(key), { method: "GET", headers: { "user-agent": headers["user-agent"] }, signal: ac.signal });
    clearTimeout(t);
    ok = r.ok && String(r.headers.get("content-type") || "").startsWith("image/");
  } catch { ok = false; }
  espnSeen.set(key, ok);
  return ok;
}
/* Resolve one fighter's media through the shared policy and attach it to the compact fighter object. */
async function withMedia(f) {
  if (!f) return f;
  const athleteId = f.slug_id ?? f.espn_athlete_id ?? null;
  const needsFallback = !f.primary_image || !f.primary_image.card_url;
  const avail = needsFallback ? await espnAvailable(athleteId) : undefined;
  f.media = resolveFighterMedia(f, { espnAvailable: avail, captured_at });
  return f;
}
const withMediaAll = async (list) => { for (const f of list) await withMedia(f); return list; };

/* ---------- 1. contract + counts ---------- */
console.log(`refresh-showcase → ${BASE}`);
const idx = await get("/v1/ufc");
const counts = await get("/v1/ufc/counts");
const reg = await get("/v1/ufc/dna/metrics");
if (!idx.ok) problems.push(`index: ${idx.error.code}`);
if (!counts.ok) problems.push(`counts: ${counts.error.code}`);
if (!reg.ok) problems.push(`dna/metrics: ${reg.error.code}`);
if (problems.length) fail();

/* ---------- 2. next UFC event (DWCS and Road to UFC excluded from the hero) ---------- */
const SIDE_SHOW = /contender series|road to ufc|dwcs/i;
const upcoming = await get("/v1/ufc/events?status=upcoming&limit=12");
if (!upcoming.ok) { problems.push(`events: ${upcoming.error.code}`); fail(); }
const mainEvent = (upcoming.data || []).find((e) => !SIDE_SHOW.test(e.name)) || (upcoming.data || [])[0];
if (!mainEvent) { problems.push("no upcoming event returned"); fail(); }
note(`next event: ${mainEvent.name} (${mainEvent.event_date})${SIDE_SHOW.test(mainEvent.name) ? " [no non-DWCS event available]" : ""}`);
const card = await get(`/v1/ufc/events/${mainEvent.id}/card?include=media,results`);
if (!card.ok) { problems.push(`card: ${card.error.code}`); fail(); }
const bouts = [...(card.data.bouts || [])].sort((a, b) => b.bout_order - a.bout_order);
if (!bouts.length) { problems.push("event card has no bouts"); fail(); }

/* ---------- 3. candidate fighters from the card (men's bouts first) ---------- */
const seen = new Map();
bouts.forEach((b, i) => {
  for (const f of [b.fighter_a, b.fighter_b]) {
    if (!f?.id || seen.has(f.id)) continue;
    seen.set(f.id, { id: f.id, name: f.name, womens: !!b.is_womens, cardPos: i, order: b.bout_order, main: i === 0, comain: i === 1, image: okImage(f.primary_image) });
  }
});
const cardMen = [...seen.values()].filter((c) => !c.womens);
const probe = cardMen.slice(0, 14);
note(`probing ${probe.length} men's fighters from the card`);
const enriched = [];
for (const c of probe) {
  const det = await get(`/v1/ufc/fighters/${c.id}?include=ranking,next,history&history_limit=6`);
  if (!det.ok) continue;
  const dna = await get(`/v1/ufc/fighters/${c.id}/dna`);
  const d = det.data;
  const pos = rankOf(d);
  if (pos && isWomensLabel(pos.label)) continue;
  const snap = dna.ok ? snapshotView(dna.data.snapshot) : null;
  enriched.push({
    ...c, detail: det, dna, fighter: compactFighter(d), snapshot: snap,
    history: (d.history || []).slice(0, 6).map((h) => ({ bout_id: h.id, event: h.event ? { name: h.event.name, event_date: h.event.event_date } : null, opponent: h.opponent ? { id: h.opponent.id, name: h.opponent.name } : null, outcome: h.outcome ?? null, result: h.result ? { method: h.result.method ?? null, round: h.result.round ?? null, time: h.result.time ?? null } : null, weight_class: h.weight_class ?? null })),
    ranked: !!pos, rank: pos?.rank ?? null, division: pos?.label ?? null,
    hasCareer: d.career_slpm !== null && d.career_slpm !== undefined,
    score: (okImage(d.primary_image) ? 40 : 0) + (pos ? 22 : 0) + (pos && pos.rank === 0 ? 10 : 0) + (c.main ? 14 : c.comain ? 10 : 4) + dnaScore(snap) + (d.career_slpm ? 8 : 0) + Math.min(8, (d.fight_history_count || 0)),
  });
}
if (!enriched.length) { problems.push("no male fighters could be enriched from the card"); fail(); }

/* Showcase fighter: needs a portrait and real Fight DNA. Fall back to the best ranked male fighter with
   coverage anywhere in the archive if nobody on this card qualifies. */
let fighterPick = enriched.filter((c) => c.image && nonNullMetrics(c.snapshot) >= 6).sort((a, b) => b.score - a.score)[0];
if (!fighterPick) {
  note("no card fighter met the portrait + coverage bar; scanning the archive");
  const q = await get("/v1/ufc/dna/query?metric=sig_landed_per_min&min_confidence=medium&limit=40");
  for (const row of (q.ok ? q.data : []).slice(0, 18)) {
    const det = await get(`/v1/ufc/fighters/${row.fighter.id}?include=ranking,next,history&history_limit=6`);
    if (!det.ok) continue;
    const d = det.data, pos = rankOf(d);
    if (!okImage(d.primary_image) || (pos && isWomensLabel(pos.label))) continue;
    const dna = await get(`/v1/ufc/fighters/${d.id}/dna`);
    const snap = dna.ok ? snapshotView(dna.data.snapshot) : null;
    if (nonNullMetrics(snap) < 6) continue;
    const cand = { id: d.id, name: d.name, detail: det, dna, fighter: compactFighter(d), snapshot: snap, ranked: !!pos, rank: pos?.rank ?? null, division: pos?.label ?? null, image: true, history: (d.history || []).slice(0, 6).map((h) => ({ bout_id: h.id, event: h.event ? { name: h.event.name, event_date: h.event.event_date } : null, opponent: h.opponent ? { id: h.opponent.id, name: h.opponent.name } : null, outcome: h.outcome ?? null, result: h.result ? { method: h.result.method ?? null, round: h.result.round ?? null, time: h.result.time ?? null } : null, weight_class: h.weight_class ?? null })), score: 40 + (pos ? 22 : 0) + (pos && pos.rank === 0 ? 10 : 0) + dnaScore(snap) };
    if (!fighterPick || cand.score > fighterPick.score) fighterPick = cand;
  }
}
if (!fighterPick) { problems.push("no showcase fighter satisfied portrait + Fight DNA coverage"); fail(); }
const fstats = await get(`/v1/ufc/fighters/${fighterPick.id}/stats`);
note(`fighter: ${fighterPick.name} (score ${fighterPick.score}, ${nonNullMetrics(fighterPick.snapshot)} non-null metrics)`);

/* ---------- 4. matchup: best-comparing male pair, card first ---------- */
const pairCandidates = [];
bouts.forEach((b, i) => {
  if (b.is_womens) return;
  const a = seen.get(b.fighter_a?.id), c = seen.get(b.fighter_b?.id);
  if (!a || !c) return;
  pairCandidates.push({ a: b.fighter_a.id, b: b.fighter_b.id, an: b.fighter_a.name, bn: b.fighter_b.name, cardPos: i, main: i === 0, imgs: (okImage(b.fighter_a.primary_image) ? 1 : 0) + (okImage(b.fighter_b.primary_image) ? 1 : 0), weight: b.weight_class, label: i === 0 ? "main event" : i === 1 ? "co-main event" : "main card", onCard: true });
});
/* strong archive pairs from the enriched pool as a fallback source of comparability */
const deep = enriched.filter((c) => c.image && nonNullMetrics(c.snapshot) >= 10).sort((a, b) => b.score - a.score).slice(0, 5);
for (let i = 0; i < deep.length; i++) for (let j = i + 1; j < deep.length; j++) pairCandidates.push({ a: deep[i].id, b: deep[j].id, an: deep[i].name, bn: deep[j].name, cardPos: 99, main: false, imgs: 2, weight: deep[i].division || "", label: "archive matchup", onCard: false });
const scoredPairs = [];
for (const p of pairCandidates.slice(0, 10)) {
  const m = await get(`/v1/ufc/matchups/${p.a}/${p.b}/dna`);
  if (!m.ok) continue;
  const comparable = m.meta?.comparable ?? 0;
  const insights = (m.data.insights || []).length;
  scoredPairs.push({ ...p, m, comparable, comparisons: m.meta?.comparisons ?? 18, insights, warnings: (m.data.warnings || []).length, score: comparable * 5 + insights * 3 + p.imgs * 8 + (p.onCard ? 12 : 0) + (p.main ? 6 : 0) });
}
/* Never showcase a matchup that mostly renders as "—": require a real majority of comparable metrics. */
const usablePairs = scoredPairs.filter((p) => p.comparable >= Math.ceil(p.comparisons * 0.6));
const matchupPick = (usablePairs.length ? usablePairs : scoredPairs).sort((a, b) => b.score - a.score)[0];
if (!matchupPick) { problems.push("no matchup could be scored"); fail(); }
note(`matchup: ${matchupPick.an} vs ${matchupPick.bn} (${matchupPick.comparable}/${matchupPick.comparisons} comparable, ${matchupPick.insights} insights, ${matchupPick.label})`);
const mDetails = {};
for (const id of [matchupPick.a, matchupPick.b]) { const d = await get(`/v1/ufc/fighters/${id}?include=ranking,next`); if (d.ok) mDetails[id] = d.data; }

/* ---------- 5. rankings: men's division with the deepest portrait coverage ---------- */
const PREFERRED = ["LIGHTWEIGHT", "WELTERWEIGHT", "FEATHERWEIGHT", "MIDDLEWEIGHT", "HEAVYWEIGHT", "BANTAMWEIGHT", "LIGHT_HEAVYWEIGHT", "FLYWEIGHT"];
let rankPick = null;
for (const div of PREFERRED) {
  const r = await get(`/v1/ufc/rankings?division=${div}&womens=false`);
  if (!r.ok) continue;
  const dv = r.data.divisions?.[0];
  if (!dv) continue;
  const ids = [dv.champion?.fighter_id, ...dv.entries.map((e) => e.fighter_id)].filter(Boolean).slice(0, 16);
  if (!ids.length) continue;
  const media = await get(`/v1/ufc/fighters/media?ids=${ids.join(",")}`);
  const map = media.ok ? media.data.media || {} : {};
  const champOk = dv.champion?.fighter_id ? okImage(map[dv.champion.fighter_id]) : false;
  const top8 = dv.entries.slice(0, 8).filter((e) => e.fighter_id && okImage(map[e.fighter_id])).length;
  const score = (champOk ? 20 : 0) + top8 * 5 + dv.entries.filter((e) => e.fighter_id && okImage(map[e.fighter_id])).length;
  if (!rankPick || score > rankPick.score) rankPick = { div, r, media, dv, map, champOk, top8, score };
}
if (!rankPick) { problems.push("no men's ranking division could be scored"); fail(); }
note(`rankings: ${rankPick.dv.label} (champion portrait ${rankPick.champOk ? "yes" : "no"}, ${rankPick.top8}/8 top-8 portraits)`);

/* women's division kept on the site as a secondary surface */
const womensRank = await get("/v1/ufc/rankings?division=FLYWEIGHT&womens=true");
let womensMedia = null;
if (womensRank.ok && womensRank.data.divisions?.[0]) {
  const dv = womensRank.data.divisions[0];
  const ids = [dv.champion?.fighter_id, ...dv.entries.map((e) => e.fighter_id)].filter(Boolean).slice(0, 12);
  if (ids.length) womensMedia = await get(`/v1/ufc/fighters/media?ids=${ids.join(",")}`);
}
/* women's co-main from the card, so the primary surface still shows a women's bout when one exists */
const womensBoutIdx = bouts.findIndex((b) => b.is_womens);
let womensMatchup = null;
if (womensBoutIdx >= 0) {
  const wb = bouts[womensBoutIdx];
  const m = await get(`/v1/ufc/matchups/${wb.fighter_a.id}/${wb.fighter_b.id}/dna`);
  if (m.ok) womensMatchup = { ...wrap(m), label: womensBoutIdx === 0 ? "main event" : womensBoutIdx === 1 ? "co-main event" : "main card", weight_class: wb.weight_class, fighters: m.data.fighters.map(compactFighter), insights: (m.data.insights || []).map((i) => ({ key: i.key, label: i.label, explanation: i.explanation, confidence: i.confidence })), comparable: m.meta?.comparable ?? null, comparisons: m.meta?.comparisons ?? null };
}

/* ---------- 6. provenance metric: real confidence, real sample ---------- */
const provCandidates = [];
const considerProv = (name, image, snap, path) => {
  if (!snap) return;
  for (const [k, m] of Object.entries(snap.metrics)) {
    if (!m || m.value === null || m.value === undefined) continue;
    if (!["medium", "high"].includes(m.confidence)) continue;
    if (!m.numerator || !m.denominator) continue;
    provCandidates.push({ fighter: name, image, metric: { metric_key: k, ...m }, snapshot: { as_of_date: snap.as_of_date, sample_bouts: snap.sample_bouts, sample_rounds: snap.sample_rounds, sample_seconds: snap.sample_seconds, coverage_status: snap.coverage_status }, path, score: (m.confidence === "high" ? 30 : 18) + Math.min(30, (m.sample_rounds || 0) * 2) + Math.min(20, Math.round((m.sample_seconds || 0) / 300)) + (k === "sig_landed_per_min" ? 12 : 0) + (image ? 6 : 0) });
  }
};
considerProv(fighterPick.name, okImage(fighterPick.fighter.primary_image), fighterPick.snapshot, fighterPick.dna.path);
for (const c of enriched) if (c.id !== fighterPick.id) considerProv(c.name, c.image, c.snapshot, c.dna?.path);
const prov = provCandidates.sort((a, b) => b.score - a.score)[0] || null;
if (prov) note(`provenance: ${prov.fighter} ${prov.metric.metric_key} = ${prov.metric.value} (${prov.metric.confidence}, ${prov.metric.sample_rounds} rounds)`);

/* ---------- 7. assemble ---------- */
/* ---------- 7.5 consumer product links (verified against the live sitemap, never guessed) ----------
   ufc.proptechusa.ai is the API; ufc.propbetedge.ai is the production application built on the same
   UFC intelligence layer. Deep links are resolved by matching this snapshot's subjects against the
   consumer sitemap, so a slug is only ever emitted when that page actually exists. If the sitemap is
   unreachable the refresh still succeeds and every link falls back to a section index that is part of
   the site's fixed route set, so the site can never render a dead deep link. */
const PBE = "https://ufc.propbetedge.ai";
const slugify = (n) => String(n || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
let sitemap = [];
let sitemapStatus = "unavailable";
try {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 15000);
  const r = await fetch(`${PBE}/sitemap.xml`, { headers: { accept: "application/xml", "user-agent": headers["user-agent"] }, signal: ac.signal });
  clearTimeout(t);
  if (r.ok) {
    const xml = await r.text();
    sitemap = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
    sitemapStatus = sitemap.length ? `ok (${sitemap.length} urls)` : "empty";
  } else sitemapStatus = `http ${r.status}`;
} catch (e) { sitemapStatus = `error: ${String(e.message || e).slice(0, 60)}`; }
note(`consumer sitemap ${sitemapStatus}`);

const has = (u) => sitemap.includes(u);
const pick = (pred) => sitemap.find(pred) || null;

/* The consumer sitemap is a SUBSET of the site: it lists ~1000 fighters while the archive holds more,
   so a page can be live and unlisted. Sitemap match is therefore the fast path, and a candidate URL
   built from canonical identifiers is confirmed with a single bounded request before it is published.
   Anything that does not answer 200 becomes null and the UI falls back to a section index. This is a
   handful of requests per refresh against one first-party host, not open-ended scraping, and a failure
   only downgrades a deep link — it never fails the refresh or blocks the build. */
let probes = 0;
const verify = async (url) => {
  if (!url) return null;
  if (has(url)) return url;
  if (probes >= 8) return null;
  probes++;
  for (const method of ["HEAD", "GET"]) {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 8000);
      const r = await fetch(url, { method, redirect: "follow", headers: { "user-agent": headers["user-agent"] }, signal: ac.signal });
      clearTimeout(t);
      if (r.ok) return url;
      if (r.status !== 405 && r.status !== 501) return null; /* a real 404 stays null */
    } catch { return null; }
  }
  return null;
};

/* a fighter page is keyed by the same slug_id the canonical API exposes */
const fighterUrl = async (f) => {
  if (!f?.slug_id || !f?.name) return null;
  const listed = pick((u) => u.startsWith(`${PBE}/fighters/`) && u.endsWith(`-${f.slug_id}`));
  return listed || (await verify(`${PBE}/fighters/${slugify(f.name)}-${f.slug_id}`));
};
/* a fight page is <a>-vs-<b>-<event-slug>-<date>; require both names and the event date so it cannot cross-match */
const fightUrl = async (a, b, date, eventSlug) => {
  if (!a?.name || !b?.name || !date) return null;
  const [x, y] = [slugify(a.name), slugify(b.name)];
  const listed = pick((u) => u.startsWith(`${PBE}/fights/`) && u.endsWith(`-${date}`) && u.includes(x) && u.includes(y));
  return listed || (eventSlug ? await verify(`${PBE}/fights/${x}-vs-${y}-${eventSlug}`) : null);
};
const eventUrl = async (ev, kind) => {
  if (!ev?.event_date) return null;
  const stem = slugify(ev.name).split("-").slice(0, 3).join("-");
  const listed = pick((u) => u.startsWith(`${PBE}/${kind}/`) && u.endsWith(`-${ev.event_date}`) && u.includes(stem));
  return listed || (await verify(`${PBE}/${kind}/${slugify(ev.name)}-${ev.event_date}`));
};

const ev = card.data.event;
const heroBout = bouts.find((b) => b.card_position === "main") || bouts[0] || null;
const eventLink = await eventUrl(ev, "events");
/* the fight slug embeds the event slug; take it from the resolved event URL so it is never invented */
const eventSlug = eventLink ? eventLink.split("/").pop() : null;
const champDetail = rankPick.dv.champion?.fighter_id ? await get(`/v1/ufc/fighters/${rankPick.dv.champion.fighter_id}`) : null;

const product_links = {
  captured_at,
  site: PBE,
  sitemap_status: sitemapStatus,
  /* fixed routes on the consumer site */
  rankings: `${PBE}/rankings`,
  fight_week: `${PBE}/fight-week`,
  fighters_index: `${PBE}/fighters`,
  events_index: `${PBE}/events`,
  /* deep links: null when the consumer site has no such page, so the UI falls back instead of 404ing */
  fighter: await fighterUrl(fighterPick.fighter),
  matchup: await fightUrl(matchupPick.m.data.fighters[0], matchupPick.m.data.fighters[1], ev.event_date, eventSlug),
  event: eventLink,
  event_pregame: await eventUrl(ev, "pregame"),
  hero_fight: heroBout ? await fightUrl(heroBout.fighter_a, heroBout.fighter_b, ev.event_date, eventSlug) : null,
  rankings_champion: champDetail?.ok ? await fighterUrl(champDetail.data) : null,
};
note(`product links (${probes} liveness probes): ` + Object.entries(product_links).filter(([k]) => !['captured_at','site','sitemap_status'].includes(k)).map(([k, v]) => `${k}=${v ? 'yes' : 'no'}`).join(' '));

const showcase = {
  $note: "GENERATED PUBLIC SHOWCASE SNAPSHOT — do not hand-edit. Written by scripts/refresh-showcase.mjs from the canonical API. Test fixtures live in upstream/fixtures/ and are a separate, deterministic set.",
  generated_at: captured_at,
  upstream_base: BASE,
  api_version: idx.api_version || idx.data.version || null,
  fight_dna_definition_version: reg.data.definition_version ?? null,
  freshness: { fresh_minutes: 60, aging_hours: 6 },
  counts: { ...wrap(counts), ...counts.data },
  event: {
    ...wrap(card),
    selected_by: SIDE_SHOW.test(mainEvent.name) ? "only_upcoming_event" : "next_non_dwcs_upcoming_event",
    event: { id: card.data.event.id, name: card.data.event.name, event_date: card.data.event.event_date, venue: card.data.event.venue, city: card.data.event.city, region: card.data.event.region, country: card.data.event.country, card_status: card.data.event.card_status, is_ppv: card.data.event.is_ppv },
    bout_count: bouts.length,
    raw: trimBody("card", { ok: true, data: card.data, meta: card.meta }),
    bouts: bouts.map((b) => ({ id: b.id, bout_order: b.bout_order, card_position: b.card_position, weight_class: b.weight_class, is_title: b.is_title, is_womens: b.is_womens, scheduled_rounds: b.scheduled_rounds, status: b.status, fighter_a: compactFighter(b.fighter_a), fighter_b: compactFighter(b.fighter_b), result: b.result ? { winner_id: b.result.winner_id ?? null, method: b.result.method ?? null } : null })),
  },
  fighter: {
    ...wrap(fighterPick.detail),
    selected_by: "score(portrait, rank, card position, Fight DNA sample, career stats)",
    score: fighterPick.score,
    paths: { detail: fighterPick.detail.path, dna: fighterPick.dna?.path || null, stats: fstats.ok ? fstats.path : null },
    raw: trimBody("fighter", { ok: true, data: fighterPick.detail.data, meta: fighterPick.detail.meta }),
    raw_dna: fighterPick.dna?.ok ? trimBody("dna", { ok: true, data: fighterPick.dna.data, meta: fighterPick.dna.meta }) : null,
    fighter: fighterPick.fighter,
    history: fighterPick.history,
    dna: fighterPick.snapshot,
    dna_meta: fighterPick.dna?.ok ? { resolved_as_of: fighterPick.dna.meta?.resolved_as_of, origin_label: fighterPick.dna.meta?.origin_label } : null,
    career_rates: fstats.ok ? fstats.data.computed?.career_rates || null : null,
    career_provenance: fstats.ok ? fstats.data.computed?.provenance || null : null,
    career_snapshot: fstats.ok ? fstats.data.career_snapshot || null : null,
  },
  matchup: {
    ...wrap(matchupPick.m),
    selected_by: "score(comparable metrics, insights, portraits, card position)",
    label: matchupPick.label,
    weight_class: matchupPick.weight,
    on_current_card: matchupPick.onCard,
    raw: trimBody("matchup", { ok: true, data: matchupPick.m.data, meta: matchupPick.m.meta }),
    /* identity fields come from /fighters/{id}: the matchup response returns compact fighters without reach or rank */
    fighters: matchupPick.m.data.fighters.map((f) => { const d = mDetails[f.id]; const c = compactFighter(f); return d ? { ...c, height_in: d.height_in ?? c.height_in, reach_in: d.reach_in ?? c.reach_in, weight_lbs: d.weight_lbs ?? c.weight_lbs, ranking: d.ranking ? { snapshot_date: d.ranking.snapshot_date, source: d.ranking.source, positions: d.ranking.positions } : c.ranking, career: { slpm: d.career_slpm ?? null, str_acc: d.career_str_acc ?? null, sapm: d.career_sapm ?? null, str_def: d.career_str_def ?? null, td_avg: d.career_td_avg ?? null, td_acc: d.career_td_acc ?? null, td_def: d.career_td_def ?? null, sub_avg: d.career_sub_avg ?? null }, _identity_from: "/v1/ufc/fighters/{id}" } : c; }),
    a: snapshotView(matchupPick.m.data.a), b: snapshotView(matchupPick.m.data.b),
    comparisons: matchupPick.m.data.comparisons.map((c) => ({ key: c.key, label: c.label, unit: c.unit, family: c.family, higher_is_better: c.higher_is_better, a: c.a ? { value: c.a.value, confidence: c.a.confidence, sample_bouts: c.a.sample_bouts } : null, b: c.b ? { value: c.b.value, confidence: c.b.confidence, sample_bouts: c.b.sample_bouts } : null, delta: c.delta, direction: c.direction, comparable: c.comparable })),
    stance_context: { a_stance: matchupPick.m.data.stance_context.a_stance, b_stance: matchupPick.m.data.stance_context.b_stance, context: matchupPick.m.data.stance_context.context },
    insights: matchupPick.m.data.insights.map((i) => ({ key: i.key, label: i.label, value: i.value, unit: i.unit, side: i.side, confidence: i.confidence, sample_bouts: i.sample_bouts, sample_rounds: i.sample_rounds, sample_seconds: i.sample_seconds, explanation: i.explanation })),
    warnings: matchupPick.m.data.warnings, note: matchupPick.m.data.note,
    meta: { resolved_as_of: matchupPick.m.meta?.resolved_as_of, insights: matchupPick.m.meta?.insights, warnings: matchupPick.m.meta?.warnings, comparable: matchupPick.comparable, comparisons: matchupPick.comparisons },
  },
  rankings: {
    ...wrap(rankPick.r),
    selected_by: "score(champion portrait, top-8 portrait coverage)",
    media_path: rankPick.media.ok ? rankPick.media.path : null,
    raw: trimBody("rankings", { ok: true, data: rankPick.r.data, meta: rankPick.r.meta }),
    source: rankPick.r.data.source, source_url: rankPick.r.data.source_url, snapshot_date: rankPick.r.data.snapshot_date,
    division: {
      key: rankPick.dv.key, label: rankPick.dv.label, is_womens: rankPick.dv.is_womens,
      champion: rankPick.dv.champion ? { name: rankPick.dv.champion.name, fighter_id: rankPick.dv.champion.fighter_id, slug_id: rankPick.dv.champion.fighter?.slug_id ?? null, primary_image: compactImage(rankPick.map[rankPick.dv.champion.fighter_id] || null) } : null,
      entries: rankPick.dv.entries.map((e) => ({ rank: e.rank, name: e.name, fighter_id: e.fighter_id, slug_id: e.fighter?.slug_id ?? null, change: e.change, is_new: e.is_new, primary_image: compactImage(rankPick.map[e.fighter_id] || null) })),
    },
  },
  womens: {
    matchup: womensMatchup,
    rankings: womensRank.ok && womensRank.data.divisions?.[0] ? (() => { const dv = womensRank.data.divisions[0]; const map = womensMedia?.ok ? womensMedia.data.media || {} : {}; return { ...wrap(womensRank), source: womensRank.data.source, source_url: womensRank.data.source_url, snapshot_date: womensRank.data.snapshot_date, division: { key: dv.key, label: dv.label, is_womens: dv.is_womens, champion: dv.champion ? { name: dv.champion.name, fighter_id: dv.champion.fighter_id, slug_id: dv.champion.fighter?.slug_id ?? null, primary_image: compactImage(map[dv.champion.fighter_id] || null) } : null, entries: dv.entries.map((e) => ({ rank: e.rank, name: e.name, fighter_id: e.fighter_id, slug_id: e.fighter?.slug_id ?? null, change: e.change, is_new: e.is_new, primary_image: compactImage(map[e.fighter_id] || null) })) } }; })() : null,
  },
  product_links,
  provenance: prov ? { ...prov, captured_at, upstream_base: BASE } : null,
  registry: { definition_version: reg.data.definition_version, origin_labels: reg.data.origin_labels, confidence_tiers: reg.data.confidence_tiers, as_of_semantics: reg.data.as_of_semantics, families: Object.fromEntries(Object.entries(reg.data.families || {}).map(([k, v]) => [k, v.map((m) => ({ metric_key: m.metric_key, display_name: m.display_name, description: m.description, unit: m.unit, formula: m.formula, min_bouts: m.min_bouts, min_rounds: m.min_rounds, min_seconds: m.min_seconds }))])) },
  upstream_calls: calls,
};


/* ---------- 7.9 resolve fighter media for every rendered subject ----------
   One pass over every fighter the site will actually paint, through the shared policy module. The
   resolved block travels in the snapshot so the page renders exactly what was classified here, and a
   portrait that appears upstream later is picked up by the next refresh instead of being frozen. */
const mediaNodes = [];
for (const b of showcase.event.bouts) { if (b.fighter_a) mediaNodes.push(b.fighter_a); if (b.fighter_b) mediaNodes.push(b.fighter_b); }
if (showcase.fighter.fighter) mediaNodes.push(showcase.fighter.fighter);
for (const f of showcase.matchup.fighters) mediaNodes.push(f);
for (const r of [showcase.rankings, showcase.womens?.rankings]) {
  if (!r?.division) continue;
  if (r.division.champion) mediaNodes.push(r.division.champion);
  for (const e of r.division.entries) mediaNodes.push(e);
}
if (showcase.womens?.matchup?.fighters) for (const f of showcase.womens.matchup.fighters) mediaNodes.push(f);
/* rankings rows name their fighter id differently; normalise before resolving */
for (const n of mediaNodes) { if (!n.id && n.fighter_id) n.id = n.fighter_id; }
for (const n of mediaNodes) await withMedia(n);
showcase.media_coverage = { ...mediaCoverage(mediaNodes.map((n) => n.media)), espn_probes: espnProbes, resolved_at: captured_at };
note(`media: ${showcase.media_coverage.stored} stored · ${showcase.media_coverage.display_only} display-only · ${showcase.media_coverage.blocked} blocked · ${showcase.media_coverage.unavailable} unavailable (${espnProbes} headshot probes)`);

/* ---------- 8. validate, fail closed ---------- */
const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : null;
const c = showcase.counts;
for (const k of ["fighters", "events", "bouts", "results", "round_stat_rows"]) {
  if (typeof c[k] !== "number" || c[k] < 0) problems.push(`counts.${k} is not a non-negative number (${c[k]})`);
}
if (prev?.counts) {
  /* the archive only grows; a large regression means a bad upstream read, not a real change */
  for (const k of ["fighters", "events", "bouts"]) {
    const before = prev.counts[k], now = c[k];
    if (typeof before === "number" && now < before * 0.9) problems.push(`counts.${k} regressed sharply: ${before} → ${now}`);
  }
}
if (!showcase.event.event.id || !showcase.event.event.name || !showcase.event.event.event_date) problems.push("event is missing id, name or date");
if (!showcase.event.bouts.length) problems.push("event has no bouts");
if (!showcase.fighter.fighter?.id) problems.push("fighter has no id");
if (nonNullMetrics(showcase.fighter.dna) < 6) problems.push(`fighter Fight DNA has only ${nonNullMetrics(showcase.fighter.dna)} non-null metrics`);
if (showcase.matchup.fighters.length !== 2) problems.push("matchup does not have two fighters");
if (showcase.matchup.fighters[0]?.id === showcase.matchup.fighters[1]?.id) problems.push("matchup fighters are identical");
if (!showcase.rankings.source || !showcase.rankings.snapshot_date) problems.push("rankings missing source or snapshot_date");
if (!showcase.rankings.division.entries.length) problems.push("rankings division has no entries");
if (showcase.provenance && !showcase.provenance.metric.definition_version) problems.push("provenance metric has no definition_version");
for (const [k, v] of Object.entries(showcase.product_links)) {
  if (v === null || k === "captured_at" || k === "sitemap_status") continue;
  if (typeof v !== "string" || !v.startsWith("https://ufc.propbetedge.ai")) problems.push(`product_links.${k} is not a consumer-site URL (${v})`);
}
for (const n of mediaNodes) {
  const m = n.media;
  if (!m) { problems.push(`fighter ${n.name} has no resolved media block`); continue; }
  if (m.display_policy === "redistributable" && m.media_status !== "stored") problems.push(`${n.name}: redistributable claimed for ${m.media_status}`);
  if (m.media_status === "display_only" && (m.license || !m.attribution)) problems.push(`${n.name}: display-only media must carry attribution and no licence claim`);
  if (m.approved && !m.src) problems.push(`${n.name}: approved media without a src`);
}
if (!showcase.api_version) problems.push("no api_version reported");
if (Math.abs(Date.now() - Date.parse(showcase.generated_at)) > 10 * 60 * 1000) problems.push("generated_at is not current");
if (problems.length) fail();

if (DRY) { console.log("\n--dry-run: snapshot valid, not written"); process.exit(0); }
mkdirSync(dirname(OUT), { recursive: true });
const next = JSON.stringify(showcase, null, 2) + "\n";
const same = prev && JSON.stringify({ ...prev, generated_at: null, counts: { ...prev.counts, captured_at: null } }) === JSON.stringify({ ...showcase, generated_at: null, counts: { ...showcase.counts, captured_at: null } });
writeFileSync(OUT, next);
console.log(`\nwrote apps/web/src/generated/showcase.json (${calls} upstream calls, ${(next.length / 1024).toFixed(0)} KB)`);
console.log(`counts: ${c.fighters} fighters · ${c.events} events · ${c.bouts} bouts · ${c.results} results · ${c.round_stat_rows} round rows`);
console.log(`event: ${showcase.event.event.name} · fighter: ${showcase.fighter.fighter.name} · matchup: ${showcase.matchup.fighters.map((f) => f.name).join(" vs ")} · rankings: ${showcase.rankings.division.label}`);
if (same) console.log("payload unchanged apart from timestamps");

function fail() {
  console.error(`\n✖ refresh failed against ${BASE}; the previous snapshot is left untouched\n` + problems.map((p) => `  - ${p}`).join("\n"));
  process.exit(1);
}
