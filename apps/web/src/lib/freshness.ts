/* Freshness of the generated public showcase snapshot.
   fresh: <= 60 min · aging: <= 6 h · stale: beyond that. The site never invents current numbers to hide staleness;
   it labels the snapshot honestly and keeps showing the last good data. */
export type FreshState = "fresh" | "aging" | "stale";
export interface Freshness { state: FreshState; minutes: number; label: string; capturedAt: string; iso: string; }

export function freshness(generatedAt: string, now: Date = new Date()): Freshness {
  const t = Date.parse(generatedAt);
  const minutes = Math.max(0, Math.round((now.getTime() - t) / 60000));
  const state: FreshState = minutes <= 60 ? "fresh" : minutes <= 360 ? "aging" : "stale";
  return { state, minutes, label: ago(minutes), capturedAt: fmtUtc(generatedAt), iso: generatedAt };
}

export function ago(minutes: number): string {
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const h = Math.floor(minutes / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return `${d} d ago`;
}

export function fmtUtc(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }) + " UTC";
}
