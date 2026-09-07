/* Image-use helper for MARKETING surfaces.
 *
 * The API returns image metadata with a per-file license. Marketing pages may only show a portrait when the
 * license clearly permits commercial display with attribution. Everything else falls back to the original
 * PropTechUSA silhouette. Attribution is always returned so the caller can render the credit. */
export interface ApiImage {
  id?: string; image_url?: string | null; card_url?: string | null; thumb_url?: string | null;
  author?: string | null; license?: string | null; source_url?: string | null; kind?: string | null;
  attribution_text?: string | null; rights_label?: string | null;
}
export interface MarketingImage {
  approved: boolean;
  src: string;            /* card (800x1000) or silhouette */
  srcset?: string;        /* thumb 320w, card 800w when approved */
  width: number; height: number;
  alt: string;
  credit: string | null;  /* attribution to render when approved */
  license: string | null;
  source_url: string | null;
  reason?: string;        /* why not approved */
}

/* Licenses that permit commercial display with attribution (CC BY, CC BY-SA, CC0, public domain). NC / ND / unknown are refused. */
const APPROVED = /^(cc[ -]?by(-sa)?(\s*\d(\.\d)?)?|cc0(\s*1\.0)?|public domain|pd(-[a-z]+)?)$/i;
const APPROVED_KINDS = new Set(["wikimedia", "public_domain"]);

export const SILHOUETTE = "/brand/fighter-silhouette.svg";

/* Assets held back from marketing surfaces pending an upstream attribution audit. The API still returns them;
   the portal renders the original silhouette instead so we never publish a credit we have not verified.
   006e6554… is not listed: that is the Strickland portrait (MMAnytt, CC BY-SA 4.0) and is verified. */
const AUDIT_HOLD = new Set<string>([
  "776d6a0a-e701-4756-b789-912addfd276d", /* Jean Silva portrait: credited "The White House (U.S. Government work), Public domain" — attribution under upstream review */
]);
export function holdForAudit(id: string) { return AUDIT_HOLD.has(id); }

export function marketingImage(img: ApiImage | null | undefined, name: string): MarketingImage {
  const fallback: MarketingImage = { approved: false, src: SILHOUETTE, width: 320, height: 400, alt: `${name} (silhouette; no rights-cleared portrait)`, credit: null, license: img?.license ?? null, source_url: img?.source_url ?? null };
  if (!img || !img.card_url) return { ...fallback, reason: "no_image" };
  if (img.id && AUDIT_HOLD.has(img.id)) return { ...fallback, reason: "attribution_audit_pending" };
  const license = (img.rights_label || img.license || "").trim();
  if (!APPROVED.test(license)) return { ...fallback, reason: `license_not_approved_for_marketing:${license || "unknown"}` };
  if (img.kind && !APPROVED_KINDS.has(img.kind) && img.kind !== "licensed_editorial") return { ...fallback, reason: `kind_not_approved:${img.kind}` };
  if (img.kind === "licensed_editorial") return { ...fallback, reason: "licensed_editorial_requires_contract_review" };
  return {
    approved: true,
    src: img.card_url,
    srcset: img.thumb_url ? `${img.thumb_url} 320w, ${img.card_url} 800w` : undefined,
    width: 800, height: 1000,
    alt: `${name} portrait`,
    credit: img.attribution_text || [img.author, license].filter(Boolean).join(", ") || null,
    license, source_url: img.source_url ?? null,
  };
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
