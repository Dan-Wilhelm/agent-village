/**
 * Splits agent text into plain text, **bold**, [task:ID] chips and links.
 * Links: Markdown [label](https://…) or bare https:// URLs; both become short
 * hyperlinks ("Drive", "Frame.io", "Link" …) instead of long raw URLs.
 * Only http(s) URLs become links.
 */
export type Token =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "task"; id: string }
  | { kind: "link"; href: string; label: string };

const PATTERN = /(\[task:[A-Za-z0-9_-]{1,40}\]|\*\*[^*\n]+\*\*|\[[^\]\n]{1,80}\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<>()[\]]+)/g;

/** A short, readable label for a bare URL. */
export function labelForUrl(href: string): string {
  let host = "";
  try {
    host = new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return "Link";
  }
  if (host === "drive.google.com") return "Drive";
  if (host === "docs.google.com") return href.includes("/spreadsheets/") ? "Sheet" : href.includes("/presentation/") ? "Slides" : "Doc";
  if (host.endsWith("frame.io")) return "Frame.io";
  if (host.endsWith("figma.com")) return "Figma";
  if (host.endsWith("clickup.com")) return "ClickUp";
  if (host.endsWith("loom.com")) return "Loom";
  return "Link";
}

function safeHref(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  for (const part of text.split(PATTERN)) {
    if (!part) continue;
    const task = part.match(/^\[task:([A-Za-z0-9_-]{1,40})\]$/);
    if (task) {
      out.push({ kind: "task", id: task[1] });
      continue;
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      out.push({ kind: "bold", text: part.slice(2, -2) });
      continue;
    }
    const md = part.match(/^\[([^\]\n]{1,80})\]\((https?:\/\/[^\s)]+)\)$/);
    if (md) {
      const href = safeHref(md[2]);
      if (href) out.push({ kind: "link", href, label: md[1].trim().slice(0, 40) || labelForUrl(href) });
      else out.push({ kind: "text", text: md[1] });
      continue;
    }
    if (/^https?:\/\//.test(part)) {
      // Trailing punctuation belongs to the sentence, not the URL.
      const m = part.match(/^(.*?)([.,;:!?]*)$/)!;
      const href = safeHref(m[1]);
      if (href) {
        out.push({ kind: "link", href, label: labelForUrl(href) });
        if (m[2]) out.push({ kind: "text", text: m[2] });
      } else out.push({ kind: "text", text: part });
      continue;
    }
    out.push({ kind: "text", text: part });
  }
  return out;
}
