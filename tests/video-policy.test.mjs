/* The video policy is a port of the consumer product's ranking rules. These tests pin the behaviour
   that would change what viewers see if the port drifted. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const V = await import(pathToFileURL(join(ROOT, "apps", "web", "src", "lib", "video-policy.mjs")).href);

const vid = (over = {}) => ({
  id: over.id || Math.random().toString(36).slice(2),
  provider: "youtube",
  provider_video_id: over.provider_video_id || Math.random().toString(36).slice(2, 10),
  url: "https://www.youtube.com/watch?v=x",
  title: "A fight preview",
  channel: { name: "UFC", verified: true },
  published_at: new Date(Date.now() - 3600e3).toISOString(),
  embeddable: true,
  video_type: "fight_preview",
  links: { event_id: "e1", bout_id: null, fighter_ids: [] },
  ...over,
});

test("language comes from the channel", () => {
  assert.equal(V.videoLanguage(vid({ channel: { name: "UFC" } })), "en");
  assert.equal(V.videoLanguage(vid({ channel: { name: "ESPN MMA" } })), "en");
  assert.equal(V.videoLanguage(vid({ channel: { name: "UFC Espanol" } })), "es");
  assert.equal(V.videoLanguage(vid({ channel: { name: "UFC Brasil" } })), "pt");
  assert.equal(V.videoLanguage(vid({ channel: { name: "Some Other Channel" } })), "unknown");
});

test("an English channel posting a clearly Portuguese title is labelled Portuguese", () => {
  const v = vid({ channel: { name: "UFC" }, title: "Melhores momentos: a luta do campeão, você não viu" });
  assert.equal(V.videoLanguage(v), "pt");
});

test("official tier one outranks a regional channel, all else equal", () => {
  const now = Date.now();
  const ufc = vid({ channel: { name: "UFC" } });
  const br = vid({ channel: { name: "UFC Brasil" }, title: "Prévia da luta" });
  assert.ok(V.videoScore(ufc, "en", now) > V.videoScore(br, "en", now));
});

test("a non-embeddable clip is pushed below everything embeddable", () => {
  const now = Date.now();
  const bad = vid({ embeddable: false, published_at: new Date().toISOString() });
  const good = vid({ published_at: new Date(now - 7 * 86400e3).toISOString() });
  assert.ok(V.videoScore(good, "en", now) > V.videoScore(bad, "en", now), "freshness must not outrank usability");
});

test("English is preferred but a Spanish clip still ranks when no English exists", () => {
  const es = [vid({ channel: { name: "UFC Espanol" }, title: "Previa de la pelea" })];
  assert.equal(V.defaultLanguage(es), "all");
  assert.equal(V.defaultLanguage([vid(), vid()]), "en");
});

test("fight-week phase moves through the week", () => {
  const ev = "2026-09-12";
  assert.equal(V.fightWeekPhase(ev, new Date("2026-09-07T12:00:00Z")), "early");
  assert.equal(V.fightWeekPhase(ev, new Date("2026-09-10T12:00:00Z")), "mid");
  assert.equal(V.fightWeekPhase(ev, new Date("2026-09-12T12:00:00Z")), "late");
  assert.equal(V.fightWeekPhase(ev, new Date("2026-09-14T12:00:00Z")), "post");
});

test("the phase bonus promotes the clip type that fits the moment", () => {
  const now = Date.parse("2026-09-12T10:00:00Z");
  const weighIn = vid({ video_type: "weigh_in" });
  const preview = vid({ video_type: "fight_preview" });
  assert.ok(V.videoScore(weighIn, "en", now, "late") > V.videoScore(preview, "en", now, "late"), "weigh-in leads late week");
  assert.ok(V.videoScore(preview, "en", now, "early") > V.videoScore(weighIn, "en", now, "early"), "preview leads early week");
});

test("selection de-duplicates on the provider id and prefers the current event", () => {
  const dupe = vid({ provider_video_id: "same", links: { event_id: "other", fighter_ids: [] } });
  const dupe2 = vid({ provider_video_id: "same", links: { event_id: "other", fighter_ids: [] } });
  const current = vid({ provider_video_id: "cur", links: { event_id: "e1", fighter_ids: [] } });
  const out = V.selectFightWeekVideos([dupe, dupe2, current], { eventId: "e1", eventDate: "2026-09-12", now: new Date("2026-09-08T00:00:00Z") });
  assert.equal(out.selected.length, 2, "the duplicate is dropped");
  assert.equal(out.featured.links.event_id, "e1", "current-event relevance leads");
});

test("projection carries the rights-relevant fields and never claims ownership", () => {
  const p = V.projectVideo(vid());
  assert.equal(p.link_status, "published");
  assert.ok(p.embed_url.includes("youtube-nocookie.com"), "privacy-enhanced player");
  assert.ok(p.url.includes("youtube.com"), "link points at the provider");
  assert.ok(p.attribution, "attribution is always present");
  assert.ok(!("file_url" in p) && !("download_url" in p), "no rehosted asset is ever exposed");
});

test("a clip with no embed is projected as link-only rather than given a player", () => {
  const p = V.projectVideo(vid({ embeddable: false }));
  assert.equal(p.embeddable, false);
  assert.ok(p.url, "there is still somewhere to send the viewer");
});

test("the generated snapshot's videos obey the policy", () => {
  const f = join(ROOT, "apps", "web", "src", "generated", "showcase.json");
  if (!existsSync(f)) return;
  const s = JSON.parse(readFileSync(f, "utf8"));
  if (!s.videos?.featured) return;
  const ids = s.videos.selected.map((v) => v.provider_video_id);
  assert.equal(new Set(ids).size, ids.length, "no duplicate clips");
  for (const v of s.videos.selected) {
    assert.equal(v.link_status, "published");
    assert.ok(["en", "es", "pt", "unknown"].includes(v.language));
    if (v.embed_url) assert.ok(v.embed_url.includes("youtube-nocookie.com"), "embeds use the privacy-enhanced domain");
    assert.ok(/youtube\.com|youtu\.be/.test(v.url || ""), "links point at the provider, nothing is rehosted");
  }
  assert.equal(s.videos.featured.embeddable, true, "the lead slot must be playable");
});
