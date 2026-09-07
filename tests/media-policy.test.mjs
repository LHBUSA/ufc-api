/* The media policy decides what the website may show and how it must be credited. These tests pin the
   parts that would quietly cause a rights problem if someone "simplified" them later. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const { resolveFighterMedia, classifyStored, mediaCoverage, ESPN_HEADSHOT, SILHOUETTE } =
  await import(pathToFileURL(join(ROOT, "apps", "web", "src", "lib", "media-policy.mjs")).href);

const stored = (over = {}) => ({
  id: "img-1",
  image_url: "https://store.example/portrait.jpg",
  card_url: "https://store.example/card.jpg",
  thumb_url: "https://store.example/thumb.jpg",
  author: "A Photographer", license: "CC BY 4.0", rights_label: "CC BY 4.0",
  source_url: "https://commons.wikimedia.org/x", kind: "wikimedia",
  attribution_text: "A Photographer, CC BY 4.0, via Wikimedia Commons",
  ...over,
});

test("a cleared first-party asset is stored and redistributable, with every variant", () => {
  const m = resolveFighterMedia({ id: "f1", name: "Test Fighter", slug_id: "123", primary_image: stored() });
  assert.equal(m.media_status, "stored");
  assert.equal(m.display_policy, "redistributable");
  assert.equal(m.aspect, "portrait");
  assert.equal(m.card_url, "https://store.example/card.jpg");
  assert.equal(m.thumb_url, "https://store.example/thumb.jpg");
  assert.ok(m.srcset.includes("320w"), "thumb is offered as the small candidate, not the portrait");
  assert.match(m.attribution, /CC BY 4\.0/);
});

test("a fighter with no stored asset falls back to the display-only source, never straight to silhouette", () => {
  const m = resolveFighterMedia({ id: "f2", name: "No Asset", slug_id: "4903365", primary_image: null }, { espnAvailable: true });
  assert.equal(m.media_status, "display_only");
  assert.equal(m.display_policy, "display_only");
  assert.equal(m.src, ESPN_HEADSHOT("4903365"));
  assert.notEqual(m.src, SILHOUETTE);
});

test("display-only media is never labelled as licensed or owned", () => {
  const m = resolveFighterMedia({ id: "f3", name: "Headshot Only", slug_id: "1", primary_image: null }, { espnAvailable: true });
  assert.equal(m.license, null, "no licence may be claimed for a third-party headshot");
  assert.equal(m.attribution, "Photo: ESPN");
  assert.notEqual(m.display_policy, "redistributable");
  assert.doesNotMatch(String(m.attribution), /rights.cleared|public domain|cc /i);
});

test("a display-only headshot keeps its own aspect so it is not cropped into a portrait slot", () => {
  const m = resolveFighterMedia({ id: "f4", name: "Wide", slug_id: "1", primary_image: null }, { espnAvailable: true });
  assert.equal(m.aspect, "headshot");
  assert.ok(m.width > m.height, "ESPN headshots are landscape; the caller must letterbox them");
});

test("licences that do not permit commercial use are blocked and do not silently fall through", () => {
  for (const bad of ["CC BY-NC 4.0", "CC BY-ND 4.0", "All rights reserved", ""]) {
    const c = classifyStored(stored({ license: bad, rights_label: bad }));
    assert.equal(c.status, "blocked", `${bad || "(empty)"} must be blocked`);
  }
  /* a blocked asset must not be replaced by a third-party headshot: the rights answer was already no */
  const m = resolveFighterMedia({ id: "f5", name: "Restricted", slug_id: "1", primary_image: stored({ rights_label: "CC BY-NC 4.0", license: "CC BY-NC 4.0" }) }, { espnAvailable: true });
  assert.equal(m.approved, false);
  assert.equal(m.media_status, "blocked");
  assert.equal(m.src, SILHOUETTE);
});

test("editorial licensing needs contract review before it is shown", () => {
  const c = classifyStored(stored({ kind: "licensed_editorial" }));
  assert.equal(c.status, "blocked");
  assert.match(c.reason, /contract_review/);
});

test("nothing to show resolves to unavailable, not a false approval", () => {
  const m = resolveFighterMedia({ id: "f6", name: "Nobody", slug_id: null, primary_image: null });
  assert.equal(m.media_status, "unavailable");
  assert.equal(m.approved, false);
  assert.equal(m.src, SILHOUETTE);
});

test("a stored asset always wins over the display-only source", () => {
  const m = resolveFighterMedia({ id: "f7", name: "Both", slug_id: "999", primary_image: stored() }, { espnAvailable: true });
  assert.equal(m.media_status, "stored");
  assert.ok(!m.src.includes("espncdn"));
});

test("resolution joins on the canonical athlete id, never on the name", () => {
  const a = resolveFighterMedia({ id: "x", name: "Someone Else Entirely", slug_id: "555", primary_image: null }, { espnAvailable: true });
  assert.equal(a.src, ESPN_HEADSHOT("555"));
  const b = resolveFighterMedia({ id: "x", name: "Someone Else Entirely", slug_id: null, primary_image: null }, { espnAvailable: true });
  assert.equal(b.approved, false, "no id means no guess");
});

test("coverage rolls up the four categories", () => {
  const c = mediaCoverage([{ media_status: "stored" }, { media_status: "stored" }, { media_status: "display_only" }, { media_status: "unavailable" }]);
  assert.deepEqual(c, { total: 4, stored: 2, display_only: 1, blocked: 0, unavailable: 1 });
});

test("the generated snapshot never claims redistribution rights it does not have", () => {
  const p = join(ROOT, "apps", "web", "src", "generated", "showcase.json");
  if (!existsSync(p)) return;
  const s = JSON.parse(readFileSync(p, "utf8"));
  const nodes = [];
  for (const b of s.event?.bouts || []) { if (b.fighter_a) nodes.push(b.fighter_a); if (b.fighter_b) nodes.push(b.fighter_b); }
  if (s.fighter?.fighter) nodes.push(s.fighter.fighter);
  for (const f of s.matchup?.fighters || []) nodes.push(f);
  for (const r of [s.rankings, s.womens?.rankings]) {
    if (!r?.division) continue;
    if (r.division.champion) nodes.push(r.division.champion);
    for (const e of r.division.entries || []) nodes.push(e);
  }
  assert.ok(nodes.length > 0, "snapshot should carry rendered fighters");
  for (const n of nodes) {
    assert.ok(n.media, `${n.name} has no resolved media block`);
    const m = n.media;
    if (m.display_policy === "redistributable") {
      assert.equal(m.media_status, "stored", `${n.name}: only a stored asset may be redistributable`);
      assert.ok(!String(m.src).includes("espncdn"), `${n.name}: third-party URL marked redistributable`);
    }
    if (m.media_status === "display_only") {
      assert.equal(m.license, null, `${n.name}: display-only media must not carry a licence claim`);
      assert.ok(m.attribution, `${n.name}: display-only media must carry attribution`);
    }
  }
});

test("the commercial API contract exposes no third-party media host", () => {
  /* The gateway proxies upstream verbatim. Nothing in the API surface may reference the display-only
     source: website display parity must never become an API redistribution claim. */
  for (const f of ["openapi/ufc-intelligence-api.yaml", "config/entitlements.json"]) {
    const p = join(ROOT, f);
    if (!existsSync(p)) continue;
    assert.ok(!readFileSync(p, "utf8").includes("espncdn"), `${f} must not reference the display-only image host`);
  }
});
