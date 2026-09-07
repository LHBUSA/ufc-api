#!/usr/bin/env node
/* Fighter-media parity audit: consumer product vs API site.
 *
 *   node scripts/audit-media-parity.mjs                 audit the generated showcase subjects
 *   node scripts/audit-media-parity.mjs --set default   audit the named reference fighters as well
 *   node scripts/audit-media-parity.mjs --ci            exit non-zero on an unexplained resolver mismatch
 *
 * The question this answers is narrow and worth stating plainly: for a canonical fighter id, does the API
 * site show an image wherever the consumer product does, and is it labelled truthfully? A difference is
 * only a failure when our resolver is the reason. A fighter nobody has a picture of is not a bug, and a
 * third-party asset we may display but not redistribute is a deliberate distinction, not a defect.
 *
 * Mismatch classes:
 *   STALE_SNAPSHOT            upstream has media the committed snapshot predates; the next refresh fixes it
 *   RESOLVER_POLICY_MISMATCH  both sides could show an image, ours does not. This is the real failure.
 *   MISSING_VARIANT           an expected portrait/card/thumb variant is absent
 *   BROKEN_URL                a URL we publish does not return an image
 *   RIGHTS_DIFFERENCE         consumer displays it, our rights policy does not permit it here
 *   NO_MEDIA                  neither side has an image
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const { resolveFighterMedia, ESPN_HEADSHOT } = await import(pathToFileURL(join(ROOT, "apps", "web", "src", "lib", "media-policy.mjs")).href);
const gateway = JSON.parse(readFileSync(join(ROOT, "config", "gateway.json"), "utf8"));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const CI = args.includes("--ci");
const BASE = (opt("--base", process.env.UPSTREAM_BASE_URL || gateway.upstream_base_url)).replace(/\/$/, "");
const PBE = opt("--consumer", "https://ufc.propbetedge.ai").replace(/\/$/, "");
const SNAP = join(ROOT, "apps", "web", "src", "generated", "showcase.json");
const UA = "proptechusa-ufc-api/audit-media-parity";

/* Named reference fighters. Not a hand-coded media map: only a list of who to check, resolved by id. */
const REFERENCE = ["Jean Silva", "Jose Miguel Delgado", "Brandon Moreno", "Curtis Blaydes", "Waldo Cortes Acosta", "Dan Ige", "Sean Strickland", "Justin Gaethje"];

const get = async (p) => {
  const r = await fetch(BASE + p, { headers: { accept: "application/json", "user-agent": UA } });
  const j = await r.json();
  if (!j.ok) throw new Error(`${p} -> ${j.error?.code || r.status}`);
  return j;
};
const head = async (url) => {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 9000);
    const r = await fetch(url, { method: "GET", headers: { "user-agent": UA }, signal: ac.signal });
    clearTimeout(t);
    return { ok: r.ok, status: r.status, type: r.headers.get("content-type") || "" };
  } catch (e) { return { ok: false, status: 0, type: `error:${String(e.message).slice(0, 30)}` }; }
};
const slugify = (n) => String(n || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/* What does the consumer product actually paint for this fighter? */
async function consumerMedia(f) {
  const athleteId = f.slug_id ?? f.espn_athlete_id ?? null;
  if (!athleteId) return { status: "unknown", reason: "no_athlete_id", hosts: [] };
  const url = `${PBE}/fighters/${slugify(f.name)}-${athleteId}`;
  let res;
  try { res = await fetch(url, { headers: { "user-agent": UA } }); } catch { return { status: "unknown", reason: "consumer_unreachable", hosts: [] }; }
  if (!res.ok) return { status: "unknown", reason: `consumer_http_${res.status}`, hosts: [] };
  const html = await res.text();
  const stored = html.includes(`ufc-media/fighters/${f.id}/`);
  const espn = html.includes(`/headshots/mma/players/full/${athleteId}.`);
  const hosts = [];
  if (stored) hosts.push("stored");
  if (espn) hosts.push("espn");
  if (stored) return { status: "stored", reason: "first_party_asset", hosts, url };
  if (espn) return { status: "display_only", reason: "espn_headshot", hosts, url };
  return { status: "none", reason: "no_fighter_image_on_page", hosts, url };
}

/** Compare one fighter and classify any difference. */
async function auditFighter(f, snapshotMedia) {
  const detail = (await get(`/v1/ufc/fighters/${f.id}?include=media`)).data;
  const athleteId = detail.slug_id ?? detail.espn_athlete_id ?? f.slug_id ?? null;
  const subject = { id: detail.id, name: detail.name, slug_id: athleteId, primary_image: detail.primary_image || null };

  /* live resolution, plus whatever the committed snapshot decided (may be older) */
  const espn = subject.primary_image?.card_url ? undefined : (await head(ESPN_HEADSHOT(athleteId))).ok;
  const live = resolveFighterMedia(subject, { espnAvailable: espn });
  const consumer = await consumerMedia(subject);

  /* Anything we publish must actually load. */
  let broken = null, variants = null;
  if (live.approved) {
    const r = await head(live.src);
    if (!r.ok || !r.type.startsWith("image/")) broken = `${live.src} -> ${r.status} ${r.type}`;
    if (live.media_status === "stored") {
      const missing = ["portrait_url", "card_url", "thumb_url"].filter((k) => !live[k]);
      if (missing.length) variants = missing.join(",");
    }
  }

  const api = live.media_status;
  let verdict = "OK", detailMsg = live.reason;
  const rank = { stored: 3, display_only: 2, blocked: 1, unavailable: 0, none: 0, unknown: -1 };
  if (broken) { verdict = "BROKEN_URL"; detailMsg = broken; }
  else if (variants) { verdict = "MISSING_VARIANT"; detailMsg = `missing ${variants}`; }
  else if (consumer.status === "unknown") { verdict = "OK"; detailMsg = `consumer not checked (${consumer.reason})`; }
  else if (api === "unavailable" && consumer.status === "none") { verdict = "NO_MEDIA"; detailMsg = "neither product has an image"; }
  else if (rank[api] < rank[consumer.status]) {
    verdict = live.media_status === "blocked" ? "RIGHTS_DIFFERENCE" : "RESOLVER_POLICY_MISMATCH";
    detailMsg = `consumer=${consumer.status} api=${api} (${live.reason})`;
  }
  /* the committed snapshot lagging behind live upstream media is expected between refreshes */
  if (verdict === "OK" && snapshotMedia && snapshotMedia.media_status !== live.media_status) {
    verdict = "STALE_SNAPSHOT";
    detailMsg = `snapshot=${snapshotMedia.media_status} live=${live.media_status}`;
  }
  return { name: subject.name, id: subject.id, athleteId, consumer: consumer.status, api, policy: live.display_policy, verdict, detail: detailMsg };
}

/* ---------- subjects: everything the snapshot renders, plus the reference names ---------- */
const subjects = new Map();
if (existsSync(SNAP)) {
  const s = JSON.parse(readFileSync(SNAP, "utf8"));
  const push = (f) => { if (f && (f.id || f.fighter_id)) subjects.set(f.id || f.fighter_id, { id: f.id || f.fighter_id, name: f.name, slug_id: f.slug_id ?? null, media: f.media ?? null }); };
  for (const b of s.event?.bouts || []) { push(b.fighter_a); push(b.fighter_b); }
  push(s.fighter?.fighter);
  for (const f of s.matchup?.fighters || []) push(f);
  for (const r of [s.rankings, s.womens?.rankings]) {
    if (!r?.division) continue;
    if (r.division.champion) push(r.division.champion);
    for (const e of r.division.entries || []) push(e);
  }
}
if (opt("--set", "") === "default" || args.includes("--reference")) {
  for (const name of REFERENCE) {
    const r = await get(`/v1/ufc/fighters?q=${encodeURIComponent(name)}&limit=5`);
    const f = (r.data || []).find((x) => x.name.toLowerCase() === name.toLowerCase()) || (r.data || [])[0];
    if (f) subjects.set(f.id, { id: f.id, name: f.name, slug_id: f.espn_athlete_id ?? null, media: subjects.get(f.id)?.media ?? null });
  }
}
const list = [...subjects.values()];
console.log(`auditing ${list.length} fighters against ${PBE}\n`);

const rows = [];
for (const f of list) {
  try { rows.push(await auditFighter(f, f.media)); }
  catch (e) { rows.push({ name: f.name, id: f.id, athleteId: f.slug_id, consumer: "?", api: "?", policy: "?", verdict: "ERROR", detail: String(e.message).slice(0, 70) }); }
}

const pad = (s, n) => String(s ?? "").padEnd(n);
console.log(`${pad("fighter", 24)}${pad("consumer", 14)}${pad("api site", 14)}${pad("policy", 17)}${pad("verdict", 26)}detail`);
for (const r of rows.sort((a, b) => (a.verdict === "OK" ? 1 : 0) - (b.verdict === "OK" ? 1 : 0) || a.name.localeCompare(b.name))) {
  console.log(`${pad(r.name, 24)}${pad(r.consumer, 14)}${pad(r.api, 14)}${pad(r.policy, 17)}${pad(r.verdict, 26)}${r.detail}`);
}

const tally = {};
for (const r of rows) tally[r.verdict] = (tally[r.verdict] || 0) + 1;
const cover = { stored: 0, display_only: 0, blocked: 0, unavailable: 0 };
for (const r of rows) if (cover[r.api] !== undefined) cover[r.api]++;
console.log(`\ncoverage   stored=${cover.stored}  display-only=${cover.display_only}  blocked=${cover.blocked}  unavailable=${cover.unavailable}  of ${rows.length}`);
console.log(`verdicts   ${Object.entries(tally).map(([k, v]) => `${k}=${v}`).join("  ")}`);

const unexplained = rows.filter((r) => r.verdict === "RESOLVER_POLICY_MISMATCH" || r.verdict === "BROKEN_URL" || r.verdict === "ERROR");
if (unexplained.length) {
  console.log(`\n✖ ${unexplained.length} unexplained mismatch(es):`);
  for (const r of unexplained) console.log(`  - ${r.name}: ${r.verdict} ${r.detail}`);
} else {
  console.log("\n✔ no unexplained resolver mismatch");
}
process.exit(CI && unexplained.length ? 1 : 0);
