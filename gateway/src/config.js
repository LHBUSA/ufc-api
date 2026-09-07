/* Config loader. All commercial policy lives in /config/*.json; nothing is hard-coded in the gateway. */
import plansConfig from "../../config/plans.json" with { type: "json" };
import entitlementsConfig from "../../config/entitlements.json" with { type: "json" };
import rapidapiConfig from "../../config/rapidapi.json" with { type: "json" };
import gatewayConfig from "../../config/gateway.json" with { type: "json" };

export const PLANS = plansConfig;
export const ENTITLEMENTS = entitlementsConfig;
export const RAPIDAPI = rapidapiConfig;
export const GATEWAY = gatewayConfig;

export const PLAN_KEYS = Object.keys(PLANS.plans);
export const PUBLIC_PLAN_KEYS = PLANS.plan_order.filter((k) => PLANS.plans[k]?.public !== false);
export const KEY_PREFIX = PLANS.key_prefix;

export function planOf(key) {
  return PLANS.plans[key] || null;
}
