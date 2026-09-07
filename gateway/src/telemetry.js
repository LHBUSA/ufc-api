/* Usage telemetry → Workers Analytics Engine (dataset `ufc_api_usage`).
 * No request bodies, no raw keys, no customer PII. Query recipes: docs/OBSERVABILITY.md.
 *
 * blobs:   [request_id, channel, plan, key_id, route_key, method, status_class, cache_status, colo, rapidapi_user, rapidapi_subscription, denied_reason, path_template]
 * doubles: [status, latency_ms, upstream_latency_ms, allowed]
 * indexes: [subject]
 */
export function writeUsage(env, point) {
  if (!env.USAGE || typeof env.USAGE.writeDataPoint !== "function") return;
  try {
    env.USAGE.writeDataPoint({
      indexes: [String(point.subject || "anonymous").slice(0, 96)],
      blobs: [
        point.request_id || "", point.channel || "", point.plan || "", point.key_id || "", point.route_key || "",
        point.method || "", point.status ? `${Math.floor(point.status / 100)}xx` : "", point.cache_status || "", point.colo || "",
        point.rapidapi_user || "", point.rapidapi_subscription || "", point.denied_reason || "", point.path_template || "",
      ],
      doubles: [Number(point.status || 0), Number(point.latency_ms || 0), Number(point.upstream_latency_ms || 0), point.allowed ? 1 : 0],
    });
  } catch (err) {
    console.warn("[telemetry] writeDataPoint failed", err && err.message);
  }
}
