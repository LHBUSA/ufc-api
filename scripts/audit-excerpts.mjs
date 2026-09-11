#!/usr/bin/env node
/* Commercial excerpt guard.
 *
 *   node scripts/audit-excerpts.mjs [--base https://ufc-api.propbetedge.ai] [--json]
 *
 * Three commercial fields carry text copied from a third-party page rather than a normalized value:
 *   weigh-ins   raw_text        the source line the reading was parsed from
 *   injuries    status_detail   what the source said the availability change was
 *   injuries    clinical_quote  the sentence that licensed a named injury_type
 *
 * Measured 2026-09-11 they are short statements of fact ("Dan Hooker (155)", "recovering from an ACL
 * tear"), not article prose, which is what makes them safe to resell inside the response alongside
 * source_name / source_kind / source_url. That property is an upstream behaviour, not a guarantee: if a
 * future adapter starts storing paragraphs, the commercial product would be redistributing publisher
 * prose without anyone deciding to. This guard measures the live values and fails when they drift out of
 * that shape, so the decision comes back to a human.
 *
 * It is READ-ONLY. The gateway never edits an upstream body; a real fix would be an upstream change.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const gateway = JSON.parse(readFileSync(join(ROOT, "config", "gateway.json"), "utf8"));
const BASE = opt("--base", process.env.UPSTREAM_BASE_URL || gateway.upstream_base_url).replace(/\/$/, "");

/* Thresholds: generous against the measured maximum (raw_text 93, status_detail 55, clinical_quote 27),
   tight enough that a paragraph of reporting cannot pass unnoticed. */
const LIMITS = { raw_text: 200, status_detail: 200, clinical_quote: 300 };
const SENTENCES = 3; /* a quote is the sentence that licensed a claim, not a block of copy */

const get = async (p) => {
  const r = await fetch(BASE + p, { headers: { accept: "application/json", "user-agent": "proptechusa-ufc-api/excerpt-audit" } });
  const b = await r.json().catch(() => null);
  if (!r.ok || !b?.ok) throw new Error(`${p} → ${r.status} ${b?.error?.code || ""}`);
  return b.data;
};
const sentences = (t) => (String(t).match(/[.!?](\s|$)/g) || []).length || 1;
const stats = (vals) => {
  if (!vals.length) return { n: 0 };
  const l = vals.map((v) => v.length).sort((a, b) => a - b);
  return { n: vals.length, min: l[0], median: l[Math.floor(l.length / 2)], max: l[l.length - 1] };
};

const problems = [], report = {};

/* weigh-ins: page through the list route */
let readings = [];
for (let offset = 0; offset < 1000; offset += 200) {
  const rows = await get(`/v1/ufc/weigh-ins?limit=200&offset=${offset}`);
  readings = readings.concat(rows);
  if (rows.length < 200) break;
}
const raws = readings.map((r) => r.raw_text).filter(Boolean);
report.raw_text = { ...stats(raws), rows: readings.length, sources: [...new Set(readings.filter((r) => r.raw_text).map((r) => r.source_name))] };
for (const r of readings) {
  const t = r.raw_text;
  if (!t) continue;
  if (t.length > LIMITS.raw_text) problems.push(`weigh-in raw_text is ${t.length} chars (limit ${LIMITS.raw_text}) for ${r.fighter_name} @ ${r.source_name}: ${JSON.stringify(t.slice(0, 120))}…`);
  /* the reading's own weight must appear in the line it was parsed from; a line that does not contain it
     is not evidence for the number, it is just copied text */
  if (r.official_weight_lbs !== null && r.official_weight_lbs !== undefined && !t.includes(String(r.official_weight_lbs))) {
    problems.push(`weigh-in raw_text does not contain the weight it evidences (${r.official_weight_lbs}) for ${r.fighter_name}: ${JSON.stringify(t)}`);
  }
}

/* availability */
const inj = await get("/v1/ufc/injuries?state=all&limit=200");
const details = inj.map((r) => r.status_detail).filter(Boolean);
const quotes = inj.map((r) => r.clinical_quote).filter(Boolean);
report.status_detail = { ...stats(details), rows: inj.length };
report.clinical_quote = { ...stats(quotes), rows: inj.length, with_injury_type: inj.filter((r) => r.injury_type).length };
for (const r of inj) {
  if (r.status_detail && r.status_detail.length > LIMITS.status_detail) problems.push(`availability status_detail is ${r.status_detail.length} chars (limit ${LIMITS.status_detail}) for ${r.fighter_name}: ${JSON.stringify(r.status_detail.slice(0, 120))}…`);
  if (r.clinical_quote) {
    if (r.clinical_quote.length > LIMITS.clinical_quote) problems.push(`availability clinical_quote is ${r.clinical_quote.length} chars (limit ${LIMITS.clinical_quote}) for ${r.fighter_name}`);
    if (sentences(r.clinical_quote) > SENTENCES) problems.push(`availability clinical_quote runs to ${sentences(r.clinical_quote)} sentences for ${r.fighter_name} — that is reporting, not the licensing sentence`);
    /* the contract's own rule: a quote exists to license a named cause */
    if (!r.injury_type && !r.body_part) problems.push(`availability clinical_quote present with no injury_type/body_part for ${r.fighter_name}: the excerpt licenses nothing`);
  }
  /* and the inverse: a named cause with no quote is an unsourced medical claim */
  if (r.injury_type && !r.clinical_quote) problems.push(`availability injury_type ${JSON.stringify(r.injury_type)} for ${r.fighter_name} carries no clinical_quote`);
  if (r.source_url && !/^https?:\/\//.test(r.source_url)) problems.push(`availability row for ${r.fighter_name} has a malformed source_url`);
}

if (args.includes("--json")) console.log(JSON.stringify({ base: BASE, checked_at: new Date().toISOString(), report, problems }, null, 2));
else {
  console.log(`excerpt audit → ${BASE}`);
  for (const [k, v] of Object.entries(report)) console.log(`  ${k.padEnd(15)} ${v.n ? `n=${v.n} min=${v.min} median=${v.median} max=${v.max}` : "no values"}${v.sources ? ` sources=${v.sources.join(", ")}` : ""}`);
}
if (problems.length) {
  console.error(`\n✖ EXCERPT DRIFT (${problems.length}) — these fields are resold to customers; decide deliberately\n` + problems.map((p) => `  - ${p}`).join("\n"));
  process.exit(1);
}
console.log(`✔ excerpts are short source-of-fact statements (limits: raw_text ${LIMITS.raw_text}, status_detail ${LIMITS.status_detail}, clinical_quote ${LIMITS.clinical_quote} chars)`);
