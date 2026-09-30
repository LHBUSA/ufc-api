import { DurableObject } from "cloudflare:workers";

const SIDE_SHOW = /contender series|road to ufc|dwcs/i;
const MAX_AGE_MS = 72 * 60 * 60 * 1000;

function base(env) {
  return String(env.UPSTREAM_BASE_URL || "https://ufc-api.propbetedge.ai").replace(/\/$/, "");
}

async function getJson(env, path, fetcher = fetch) {
  const headers = { Accept: "application/json", "User-Agent": "proptechusa-ufc-api/portal-refresh" };
  if (env.UPSTREAM_API_KEY) headers["X-API-Key"] = env.UPSTREAM_API_KEY;
  const res = await fetcher(base(env) + path, { headers, redirect: "manual", cf: { cacheTtl: 0 } });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.ok !== true) {
    throw new Error(`portal_upstream_failed:${path}:${res.status}`);
  }
  return { data: body.data, meta: body.meta || {}, apiVersion: res.headers.get("x-api-version") || body.meta?.version || null };
}

function mainBout(bouts) {
  return [...(bouts || [])].sort((a, b) => Number(b.bout_order || 0) - Number(a.bout_order || 0))[0] || null;
}

function compactFighter(f) {
  if (!f) return null;
  return {
    id: f.id ?? null,
    name: f.name ?? null,
    nickname: f.nickname ?? null,
    slug_id: f.slug_id ?? f.espn_athlete_id ?? null,
    stance: f.stance ?? null,
    record_w: f.record_w ?? null,
    record_l: f.record_l ?? null,
    record_d: f.record_d ?? null,
    record_nc: f.record_nc ?? null,
    primary_image: f.primary_image ?? null,
    images: Array.isArray(f.images) ? f.images.slice(0, 4) : undefined,
    ranking: f.ranking ?? null,
  };
}

export async function buildPortalSnapshot(env, { fetcher = fetch } = {}) {
  const generatedAt = new Date().toISOString();
  const [counts, upcoming, registry, rankings] = await Promise.all([
    getJson(env, "/v1/ufc/counts", fetcher),
    getJson(env, "/v1/ufc/events?status=upcoming&limit=12", fetcher),
    getJson(env, "/v1/ufc/dna/metrics", fetcher),
    getJson(env, "/v1/ufc/rankings", fetcher).catch(() => null),
  ]);

  const events = Array.isArray(upcoming.data) ? upcoming.data : [];
  const event = events.find((e) => !SIDE_SHOW.test(String(e?.name || ""))) || events[0];
  if (!event?.id) throw new Error("portal_no_upcoming_event");

  const card = await getJson(env, `/v1/ufc/events/${encodeURIComponent(event.id)}/card?include=media,results`, fetcher);
  const bouts = Array.isArray(card.data?.bouts) ? card.data.bouts : [];
  const main = mainBout(bouts);
  if (!card.data?.event?.id || !main?.fighter_a?.id || !main?.fighter_b?.id) throw new Error("portal_card_incomplete");

  const aId = main.fighter_a.id;
  const bId = main.fighter_b.id;
  const [aDetail, bDetail, aDna, bDna, matchup, videos, weighIns, changes, intelligence] = await Promise.all([
    getJson(env, `/v1/ufc/fighters/${encodeURIComponent(aId)}`, fetcher).catch(() => null),
    getJson(env, `/v1/ufc/fighters/${encodeURIComponent(bId)}`, fetcher).catch(() => null),
    getJson(env, `/v1/ufc/fighters/${encodeURIComponent(aId)}/dna`, fetcher).catch(() => null),
    getJson(env, `/v1/ufc/fighters/${encodeURIComponent(bId)}/dna`, fetcher).catch(() => null),
    getJson(env, `/v1/ufc/matchups/${encodeURIComponent(aId)}/${encodeURIComponent(bId)}/dna`, fetcher).catch(() => null),
    getJson(env, `/v1/ufc/events/${encodeURIComponent(event.id)}/videos`, fetcher).catch(() => null),
    getJson(env, `/v1/ufc/events/${encodeURIComponent(event.id)}/weigh-ins?include=history`, fetcher).catch(() => null),
    getJson(env, `/v1/ufc/events/${encodeURIComponent(event.id)}/card-changes`, fetcher).catch(() => null),
    getJson(env, `/v1/ufc/events/${encodeURIComponent(event.id)}/intelligence`, fetcher).catch(() => null),
  ]);

  return {
    generated_at: generatedAt,
    api_version: counts.apiVersion || upcoming.apiVersion || null,
    fight_dna_definition_version: registry.data?.definition_version ?? null,
    counts: counts.data,
    event: {
      event: card.data.event,
      bout_count: bouts.length,
      bouts,
    },
    main_bout: {
      id: main.id ?? null,
      bout_order: main.bout_order ?? null,
      card_position: main.card_position ?? null,
      weight_class: main.weight_class ?? null,
      scheduled_rounds: main.scheduled_rounds ?? null,
      status: main.status ?? null,
      fighter_a: compactFighter(aDetail?.data || main.fighter_a),
      fighter_b: compactFighter(bDetail?.data || main.fighter_b),
    },
    fighter_a_dna: aDna?.data ?? null,
    fighter_b_dna: bDna?.data ?? null,
    matchup: matchup?.data ?? null,
    rankings: rankings?.data ?? null,
    videos: videos?.data ?? null,
    fight_week: {
      weigh_ins: weighIns?.data ?? null,
      card_changes: changes?.data ?? null,
      intelligence: intelligence?.data ?? null,
    },
    source: "cloudflare-worker",
  };
}

export class PortalSnapshot extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
  }

  async getSnapshot() {
    return (await this.ctx.storage.get("snapshot")) || null;
  }

  async putSnapshot(snapshot) {
    await this.ctx.storage.put("snapshot", snapshot);
    return { ok: true, generated_at: snapshot?.generated_at || null };
  }
}

export function portalStub(env) {
  const id = env.PORTAL_STATE.idFromName("ufc-api-portal");
  return env.PORTAL_STATE.get(id);
}

export async function refreshPortalSnapshot(env, options = {}) {
  const snapshot = await buildPortalSnapshot(env, options);
  await portalStub(env).putSnapshot(snapshot);
  return snapshot;
}

export async function readPortalSnapshot(env, { refreshIfStale = true } = {}) {
  const stub = portalStub(env);
  let snapshot = await stub.getSnapshot();
  const age = snapshot?.generated_at ? Date.now() - Date.parse(snapshot.generated_at) : Infinity;
  if (!snapshot || (refreshIfStale && age > MAX_AGE_MS)) {
    try {
      snapshot = await refreshPortalSnapshot(env);
    } catch (err) {
      if (!snapshot) throw err;
      snapshot = { ...snapshot, stale: true, refresh_error: "upstream_refresh_failed" };
    }
  }
  return snapshot;
}
