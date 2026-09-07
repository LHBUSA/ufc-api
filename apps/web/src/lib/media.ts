/* Typed view over the SINGLE media policy in ./media-policy.mjs.
 *
 * This file deliberately contains no policy of its own. The refresh script imports the same module, so
 * the generated snapshot and the rendered site classify every fighter image identically. If you are
 * about to add a licence check or a fallback here, add it to media-policy.mjs instead. */
import { resolveFighterMedia, mediaCoverage, holdForAudit, SILHOUETTE, ESPN_HEADSHOT, ESPN_PROFILE } from "./media-policy.mjs";

export type MediaStatus = "stored" | "display_only" | "blocked" | "unavailable";
export type DisplayPolicy = "redistributable" | "display_only" | "none";

export interface ApiImage {
  id?: string; image_url?: string | null; card_url?: string | null; thumb_url?: string | null;
  author?: string | null; license?: string | null; source_url?: string | null; kind?: string | null;
  attribution_text?: string | null; rights_label?: string | null;
}

export interface FighterLike {
  id?: string | null; name?: string | null; slug_id?: string | null; espn_athlete_id?: string | null;
  primary_image?: ApiImage | null;
  /* set by the refresh script when it has confirmed the display-only headshot resolves */
  media?: ResolvedMedia | null;
}

export interface ResolvedMedia {
  fighter_id: string | null;
  name: string;
  media_status: MediaStatus;
  display_policy: DisplayPolicy;
  approved: boolean;
  aspect: "portrait" | "headshot" | "none";
  src: string;
  srcset?: string;
  portrait_url: string | null; card_url: string | null; thumb_url: string | null;
  width: number; height: number;
  alt: string;
  attribution: string | null;
  credit: string | null;
  license: string | null;
  source_url: string | null;
  kind?: string | null;
  captured_at?: string | null;
  reason: string;
}

export { SILHOUETTE, holdForAudit, mediaCoverage, ESPN_HEADSHOT, ESPN_PROFILE };

/**
 * Resolve a fighter's image for a MARKETING surface.
 * Prefers the media block the refresh script already resolved (which carries a verified display-only
 * flag); otherwise resolves live from the fighter's canonical ids. Never guesses by name.
 */
export function fighterMedia(f: FighterLike | null | undefined): ResolvedMedia {
  if (f && f.media && (f.media as any).media_status) return f.media as ResolvedMedia;
  return resolveFighterMedia(f || {}) as ResolvedMedia;
}

/** Back-compat shim for call sites that only hold an image plus a name. Prefer fighterMedia(). */
export function marketingImage(img: ApiImage | null | undefined, name: string, slugId?: string | null): ResolvedMedia {
  return resolveFighterMedia({ name, slug_id: slugId ?? null, primary_image: img ?? null }) as ResolvedMedia;
}

export function fmtRecord(f: { record_w?: number | null; record_l?: number | null; record_d?: number | null; record_nc?: number | null }): string {
  if (f.record_w === null || f.record_w === undefined) return "—";
  return `${f.record_w}-${f.record_l ?? 0}-${f.record_d ?? 0}${f.record_nc ? ` (${f.record_nc} NC)` : ""}`;
}

export function fmtInches(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `${n}"`;
}

export function fmtHeight(inches: number | null | undefined): string {
  if (inches === null || inches === undefined) return "—";
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}

export function titleCase(s: string | null | undefined): string {
  if (!s) return "—";
  return s.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
