/* Minimal stand-in for `cloudflare:workers` so gateway modules load under plain Node for unit tests. */
export class DurableObject {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
}
