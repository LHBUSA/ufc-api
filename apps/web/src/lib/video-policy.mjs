/* Official video selection policy for the API website.
 *
 * PROVENANCE. This is a deterministic port of the consumer product's policy
 * (LHBUSA/UFC@ufc-fight-dna-v1 web/lib/videoPolicy.ts + web/lib/videoLabels.ts), adapted only where
 * the commercial API's row shape differs from the consumer's database row. The ranking constants, the
 * channel tiers, the language hints and the scoring weights are carried over unchanged so the two
 * products order the same clips the same way. It is a port rather than an import because the consumer
 * module is TypeScript in another repository and reads database columns; nothing here re-decides what
 * a video IS, and no second crawler exists. All rows come from the canonical /v1/ufc/videos feed.
 *
 * SHAPE DIFFERENCES, and what they cost:
 *   consumer row              commercial API row        effect
 *   channel_name              channel.name              none
 *   source_metadata.language  (not exposed)             language falls back to channel + title, which
 *                                                       is the same path the consumer takes when the
 *                                                       ingest recorded no language
 *   source_metadata           (not exposed)             region restriction is unknown, so isViewable
 *   .region_restriction                                 assumes viewable, exactly as the consumer does
 *                                                       for rows without a recorded restriction
 *
 * RIGHTS. Metadata and links only. Nothing is downloaded, rehosted or redistributed, and the embed URL
 * is the provider's own privacy-enhanced player. Buying API access does not convey any right to the
 * footage; the commercial rights matrix labels this origin THIRD_PARTY_LINK.
 */

export const LANG_LABEL = { en: "English", es: "Spanish", pt: "Portuguese", unknown: "Language unlisted" };
export const LANG_SHORT = { en: "EN", es: "ES", pt: "PT", unknown: "—" };

export const VIDEO_TYPE_LABEL = {
  embedded_episode: "Embedded", countdown: "Countdown", fight_preview: "Preview", full_fight: "Free fight",
  highlights: "Highlights", interview: "Interview", press_conference: "Press conference", media_day: "Media day",
  weigh_in: "Weigh-in", faceoff: "Faceoff", post_fight: "Reaction", analysis: "Breakdown", other: "Official video",
};

/* Channel -> default language and tier (consumer docs/videos.md, channels section). */
const CHANNEL_LANG = [[/brasil|\bbr\b|portugu/i, "pt"], [/espa[nñ]ol|latino|\bes\b/i, "es"], [/^ufc$|ufc fight pass|espn|ufc europe|ufc uk|ufc australia|ufc asia|ufc japan|ufc eurasia|ufc quebec/i, "en"]];
const CHANNEL_TIER = [[/^ufc$/i, 1], [/espn mma/i, 1], [/ufc fight pass/i, 2], [/^ufc (europe|uk|australia|asia|japan|eurasia|quebec)/i, 2], [/brasil|espa[nñ]ol|latino/i, 3]];

const ES_HINT = /\b(el|la|los|las|del|con|contra|pelea|peleador|entrevista|conferencia|resumen|noche|hoy|semana|previa|mejores|momentos|así|más|será|todo|nuevo)\b|ñ/i;
const PT_HINT = /\b(luta|lutador|lutadora|entrevista|coletiva|melhores|momentos|noite|semana|prévia|contra|não|você|também|história|campeão|pesagem)\b|ção|ções/i;

const channelName = (v) => (v && (v.channel?.name ?? v.channel_name)) || "";

export function videoLanguage(v) {
  const ch = channelName(v);
  const channelLang = CHANNEL_LANG.find(([re]) => re.test(ch))?.[1] || "unknown";
  if (channelLang === "es" || channelLang === "pt") return channelLang;
  const title = v?.title || "";
  const es = (title.match(ES_HINT) || []).length, pt = (title.match(PT_HINT) || []).length;
  if (channelLang === "en") return pt >= 2 && /ção|não|você/i.test(title) ? "pt" : es >= 2 && /ñ|¿|¡/i.test(title) ? "es" : "en";
  return "unknown";
}

export function channelTier(v) {
  return CHANNEL_TIER.find(([re]) => re.test(channelName(v)))?.[1] || 3;
}

/* The commercial feed does not carry region restrictions, so an embeddable row is assumed viewable —
   the same assumption the consumer makes when the ingest recorded none. The player still degrades. */
export function isViewable(v) { return v?.embeddable !== false; }
export function regionBlocked() { return false; }

const RELEVANCE = ["embedded_episode", "countdown", "press_conference", "weigh_in", "faceoff", "media_day", "fight_preview", "interview", "highlights", "analysis", "post_fight", "full_fight", "other"];

/* Fight-week lifecycle. The clip that deserves the lead slot changes as the week runs, so the phase
   contributes an additional, deterministic bonus on top of the shared relevance order. */
export const PHASES = {
  early:  ["embedded_episode", "countdown", "fight_preview", "interview"],
  mid:    ["media_day", "press_conference", "faceoff", "countdown"],
  late:   ["weigh_in", "faceoff", "press_conference", "countdown"],
  post:   ["highlights", "post_fight", "press_conference", "full_fight"],
};

/** Which part of fight week are we in, relative to the event date? */
export function fightWeekPhase(eventDate, now = new Date()) {
  if (!eventDate) return "early";
  const days = (Date.parse(`${String(eventDate).slice(0, 10)}T23:59:59Z`) - now.getTime()) / 86400000;
  if (days < 0) return "post";
  if (days <= 1) return "late";
  if (days <= 3) return "mid";
  return "early";
}

/** Deterministic score; higher is better. Mirrors the consumer weights, plus the phase bonus. */
export function videoScore(v, prefer = "en", now = Date.now(), phase = null) {
  const lang = videoLanguage(v);
  let s = 0;
  if (prefer !== "all") s += lang === prefer ? 1000 : lang === "unknown" ? 400 : 0;
  else s += lang === "en" ? 300 : 200;
  s += v.embeddable === false ? -5000 : v.embeddable === true ? 300 : 150;
  s += isViewable(v) ? 200 : -4000;
  s += (4 - channelTier(v)) * 60;
  const ageH = v.published_at ? Math.max(0, (now - Date.parse(v.published_at)) / 3600e3) : 24 * 30;
  s += Math.max(0, 80 - Math.log2(1 + ageH) * 8);
  const rel = RELEVANCE.indexOf(v.video_type);
  s += rel < 0 ? 0 : (RELEVANCE.length - rel) * 3;
  if (phase && PHASES[phase]) {
    const i = PHASES[phase].indexOf(v.video_type);
    if (i >= 0) s += (PHASES[phase].length - i) * 40;
  }
  return s;
}

export function rankVideos(videos, prefer = "en", phase = null) {
  const now = Date.now();
  return [...videos].sort((a, b) => videoScore(b, prefer, now, phase) - videoScore(a, prefer, now, phase));
}

export function filterByLanguage(videos, lang) {
  if (lang === "all") return videos;
  return videos.filter((v) => videoLanguage(v) === lang);
}

/** English when there are enough English clips, otherwise all — still labelled either way. */
export function defaultLanguage(videos, min = 2) {
  return filterByLanguage(videos, "en").length >= min ? "en" : "all";
}

/** Provider embed URL, privacy-enhanced, built from the provider id at render time. */
export function embedUrl(v) {
  if (!v) return null;
  if (v.embed_url) return v.embed_url;
  return v.provider === "youtube" && v.provider_video_id ? `https://www.youtube-nocookie.com/embed/${v.provider_video_id}` : null;
}

export function thumbnailUrl(v) {
  if (v?.thumbnail_url) return v.thumbnail_url;
  return v?.provider === "youtube" && v.provider_video_id ? `https://i.ytimg.com/vi/${v.provider_video_id}/hqdefault.jpg` : null;
}

export const typeLabel = (t) => VIDEO_TYPE_LABEL[t] || "Official video";

/** Project one API row into the compact shape the site and the snapshot both render. */
export function projectVideo(v, opts = {}) {
  const lang = videoLanguage(v);
  return {
    id: v.id,
    provider: v.provider ?? null,
    provider_video_id: v.provider_video_id ?? null,
    url: v.url ?? null,
    embed_url: embedUrl(v),
    thumbnail_url: thumbnailUrl(v),
    title: v.title ?? null,
    channel: v.channel ? { id: v.channel.id ?? null, name: v.channel.name ?? null, verified: v.channel.verified ?? null } : null,
    published_at: v.published_at ?? null,
    duration_sec: v.duration_sec ?? null,
    video_type: v.video_type ?? "other",
    video_type_label: v.video_type_label || typeLabel(v.video_type),
    language: lang,
    language_label: LANG_LABEL[lang],
    language_short: LANG_SHORT[lang],
    embeddable: v.embeddable === true,
    /* the consumer's link_status contract: only published rows ever leave the database, so anything we
       can see is published. Recorded explicitly so the site never has to guess. */
    link_status: "published",
    viewable: isViewable(v),
    attribution: v.attribution ?? (v.channel?.name ? `YouTube · ${v.channel.name}` : null),
    links: { event_id: v.links?.event_id ?? null, bout_id: v.links?.bout_id ?? null, fighter_ids: v.links?.fighter_ids ?? [] },
    resolver_confidence: v.resolver_confidence ?? null,
    captured_at: opts.captured_at ?? v.captured_at ?? null,
  };
}

/**
 * Pick the lead clip and its supporting grid for a fight-week desk.
 * Returns { featured, selected, phase, language, counts } and never invents rows.
 */
export function selectFightWeekVideos(videos, { eventId = null, eventDate = null, max = 7, now = new Date() } = {}) {
  const rows = (videos || []).filter((v) => v && v.id);
  /* de-duplicate on the provider id: the same clip can be linked to more than one surface */
  const seen = new Set();
  const unique = [];
  for (const v of rows) {
    const k = v.provider_video_id || v.id;
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(v);
  }
  const phase = fightWeekPhase(eventDate, now);
  const prefer = defaultLanguage(unique);
  /* current-event relevance first, then everything else in policy order */
  const current = eventId ? unique.filter((v) => v.links?.event_id === eventId) : [];
  const rest = unique.filter((v) => !current.includes(v));
  const ordered = [...rankVideos(current, prefer, phase), ...rankVideos(rest, prefer, phase)];
  const chosen = ordered.slice(0, max);
  const counts = { total: unique.length, current_event: current.length, en: 0, es: 0, pt: 0, unknown: 0, embeddable: 0, non_embeddable: 0 };
  for (const v of unique) {
    counts[videoLanguage(v)]++;
    if (v.embeddable === true) counts.embeddable++; else counts.non_embeddable++;
  }
  return {
    phase,
    language: prefer,
    featured: chosen[0] ? projectVideo(chosen[0], { captured_at: now.toISOString() }) : null,
    selected: chosen.map((v) => projectVideo(v, { captured_at: now.toISOString() })),
    counts,
  };
}
