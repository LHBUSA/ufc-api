/* SINGLE fighter-media policy for the PropTechUSA UFC API property.
 *
 * This module is the only place that decides whether a fighter image may be shown and how it must be
 * credited. It is plain JavaScript on purpose: apps/web/src/lib/media.ts re-exports it with types for
 * the Astro components, and scripts/refresh-showcase.mjs imports it directly, so the website and the
 * generated snapshot cannot drift apart. Do not re-implement any of this anywhere else.
 *
 * WHY THIS EXISTS
 * The consumer product (ufc.propbetedge.ai) resolves fighter media from two sources: the canonical
 * first-party store (Supabase `ufc-media/fighters/<fighter_id>/{portrait,card,thumb}.jpg`) and, when a
 * fighter has no stored asset, the ESPN headshot addressed by the athlete id. The API site previously
 * knew only about the first, so roughly half the roster fell straight through to a silhouette even
 * though a perfectly good image was on screen next door. That divergence is what this module removes.
 *
 * THE RIGHTS DISTINCTION THAT MUST SURVIVE
 * Website display parity is NOT API redistribution rights.
 *   stored        first-party asset under CC BY / CC BY-SA / CC0 / public domain. Redistributable, and
 *                 this is the only category the commercial /v1 API ever returns.
 *   display_only  shown on our own pages with the source credited, never offered as API media and
 *                 never described as rights-cleared or owned. ESPN headshots live here.
 *   blocked       an asset exists but its licence does not permit commercial display (NC / ND), or it
 *                 needs contract review. Never rendered.
 *   unavailable   nothing usable. The caller renders a name lockup, or a silhouette as a last resort.
 *
 * Nothing here adds a field to a /v1 response. The gateway proxies upstream verbatim, so a display_only
 * URL resolved for the website cannot reach an API consumer.
 */

/* Licences that permit commercial display AND redistribution with attribution. NC, ND and unknown are refused. */
const REDISTRIBUTABLE = /^(cc[ -]?by(-sa)?(\s*\d(\.\d)?)?|cc0(\s*1\.0)?|public domain|pd(-[a-z]+)?)$/i;
/* Upstream `kind` values whose provenance we have verified end to end. */
const STORED_KINDS = new Set(["wikimedia", "public_domain"]);

export const SILHOUETTE = "/brand/fighter-silhouette.svg";

/* The consumer product's display-only source, addressed by the canonical ESPN athlete id that the
   commercial API already exposes as `slug_id`. This is an identifier join, never a name guess. */
export const ESPN_HEADSHOT = (athleteId) => `https://a.espncdn.com/i/headshots/mma/players/full/${athleteId}.png`;
export const ESPN_PROFILE = (athleteId) => `https://www.espn.com/mma/fighter/_/id/${athleteId}`;
/* ESPN headshots are 600x436 head-and-shoulders. Stored assets are 800x1000 portrait crops. They are not
   interchangeable: a headshot dropped into a portrait slot with object-fit:cover crops the face off. */
export const ESPN_W = 600, ESPN_H = 436;
export const STORED_W = 800, STORED_H = 1000;

/* Assets held back pending an upstream attribution audit. The API still returns them; we render the
   name lockup instead so we never publish a credit we have not verified. */
const AUDIT_HOLD = new Set([]);
export function holdForAudit(id) { return AUDIT_HOLD.has(id); }

/** Classify a stored upstream image without deciding what to render yet. */
export function classifyStored(img) {
  if (!img || !img.card_url) return { status: "unavailable", reason: "no_stored_asset" };
  if (img.id && AUDIT_HOLD.has(img.id)) return { status: "blocked", reason: "attribution_audit_pending" };
  const licence = String(img.rights_label || img.license || "").trim();
  if (img.kind === "licensed_editorial") return { status: "blocked", reason: "licensed_editorial_requires_contract_review" };
  if (!REDISTRIBUTABLE.test(licence)) return { status: "blocked", reason: `licence_not_cleared:${licence || "unknown"}` };
  if (img.kind && !STORED_KINDS.has(img.kind)) return { status: "blocked", reason: `kind_not_cleared:${img.kind}` };
  return { status: "stored", reason: "stored_asset", licence };
}

/**
 * Resolve the media for one fighter, in the documented order:
 *   1. canonical stored registry asset
 *   2. consumer-approved display-only source (ESPN headshot by athlete id)
 *   3. caller's own fallback (fight-poster name lockup)
 *   4. silhouette, last resort
 *
 * `fighter` needs { id, name, slug_id, primary_image }. Pass `espnAvailable` when the caller has already
 * checked that the headshot exists (the refresh script does this and records it in the snapshot); leave it
 * undefined to trust the identifier, and let the browser's onerror drop back to the silhouette.
 */
export function resolveFighterMedia(fighter, opts = {}) {
  const f = fighter || {};
  const name = f.name || "This fighter";
  const athleteId = f.slug_id ?? f.espn_athlete_id ?? null;
  const base = {
    fighter_id: f.id ?? null,
    name,
    portrait_url: null, card_url: null, thumb_url: null,
    attribution: null, source_url: null, license: null, kind: null,
    captured_at: opts.captured_at ?? null,
  };

  const stored = classifyStored(f.primary_image);
  if (stored.status === "stored") {
    const img = f.primary_image;
    return {
      ...base,
      media_status: "stored",
      display_policy: "redistributable",
      approved: true,
      aspect: "portrait",
      src: img.card_url,
      srcset: img.thumb_url ? `${img.thumb_url} 320w, ${img.card_url} 800w` : undefined,
      portrait_url: img.image_url ?? null, card_url: img.card_url, thumb_url: img.thumb_url ?? null,
      width: STORED_W, height: STORED_H,
      alt: `${name} portrait`,
      attribution: img.attribution_text || [img.author, stored.licence].filter(Boolean).join(", ") || null,
      credit: img.attribution_text || [img.author, stored.licence].filter(Boolean).join(", ") || null,
      license: stored.licence || null,
      source_url: img.source_url ?? null,
      kind: img.kind ?? null,
      reason: stored.reason,
    };
  }

  /* 2. display-only parity with the consumer product. Only when a stored asset is absent, never to
        override one, and never when the stored asset was blocked on rights we must respect. */
  const storedBlockedOnRights = stored.status === "blocked";
  const espnOk = opts.espnAvailable === undefined ? !!athleteId : !!athleteId && opts.espnAvailable === true;
  if (!storedBlockedOnRights && espnOk) {
    const url = ESPN_HEADSHOT(athleteId);
    return {
      ...base,
      media_status: "display_only",
      display_policy: "display_only",
      approved: true,
      aspect: "headshot",
      src: url,
      portrait_url: url, card_url: url, thumb_url: url,
      width: ESPN_W, height: ESPN_H,
      alt: `${name} headshot`,
      /* truthful label: this is not ours, not rights-cleared, not redistributable */
      attribution: "Photo: ESPN",
      credit: "Photo: ESPN",
      license: null,
      source_url: ESPN_PROFILE(athleteId),
      kind: "espn_headshot",
      reason: stored.status === "unavailable" ? "no_stored_asset_display_only_source" : stored.reason,
    };
  }

  return {
    ...base,
    media_status: storedBlockedOnRights ? "blocked" : "unavailable",
    display_policy: "none",
    approved: false,
    aspect: "none",
    src: SILHOUETTE,
    width: 320, height: 400,
    alt: `${name} (no image available)`,
    credit: null,
    license: f.primary_image?.license ?? null,
    source_url: f.primary_image?.source_url ?? null,
    reason: stored.reason || "no_media",
  };
}

/** Roll a set of resolved media up into the counts the parity audit reports. */
export function mediaCoverage(list) {
  const out = { total: 0, stored: 0, display_only: 0, blocked: 0, unavailable: 0 };
  for (const m of list) { if (!m) continue; out.total++; out[m.media_status] = (out[m.media_status] || 0) + 1; }
  return out;
}
