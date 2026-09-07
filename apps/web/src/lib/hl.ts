/* Tiny JSON syntax highlighter for static docs (server-side, no client JS). */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function hlJson(value: unknown, indent = 2): string {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, indent);
  return esc(text).replace(/("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(?:\s*:)?|\b(?:true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g, (m) => {
    if (m.startsWith('"')) return m.endsWith(":") ? `<span class="k">${m.slice(0, -1)}</span>:` : `<span class="s">${m}</span>`;
    if (m === "true" || m === "false") return `<span class="b">${m}</span>`;
    if (m === "null") return `<span class="z">${m}</span>`;
    return `<span class="n">${m}</span>`;
  });
}

export function hlShell(text: string): string {
  return esc(text).replace(/(\$[A-Z_]+)/g, '<span class="n">$1</span>').replace(/(https?:\/\/[^\s"]+)/g, '<span class="s">$1</span>').replace(/^(#.*)$/gm, '<span class="c">$1</span>');
}

export function fmtNumber(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? iso + "T00:00:00Z" : iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function planChip(plan: string | null): string {
  if (!plan) return "enterprise";
  return plan;
}

export function originChip(origin: string): { cls: string; label: string } {
  const map: Record<string, { cls: string; label: string }> = {
    SOURCE_FACT: { cls: "source", label: "Source" },
    PBE_DERIVED: { cls: "derived", label: "PBE derived" },
    LICENSED: { cls: "licensed", label: "Licensed" },
    EDITORIAL: { cls: "editorial", label: "Editorial" },
    MEDIA: { cls: "media", label: "Media" },
    THIRD_PARTY_LINK: { cls: "link", label: "Third-party link" },
  };
  return map[origin] || { cls: "", label: origin };
}
