/**
 * Figma links → API keys. Handles design/file/proto/board/slides/make links,
 * branch links (/branch/:branchKey) and node-id "1-2" → API id "1:2".
 */
export interface FigmaRef {
  fileKey: string;
  nodeId: string | null;
}

export function parseFigmaUrl(input: string): FigmaRef | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (!/(^|\.)figma\.com$/.test(url.hostname)) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2 || !["design", "file", "proto", "board", "slides", "make", "deck"].includes(parts[0])) return null;
  let fileKey = parts[1];
  const branchAt = parts.indexOf("branch");
  if (branchAt > 0 && parts[branchAt + 1]) fileKey = parts[branchAt + 1];
  if (!/^[A-Za-z0-9]{10,64}$/.test(fileKey)) return null;
  const raw = url.searchParams.get("node-id");
  const nodeId = raw ? normaliseNodeId(raw) : null;
  return { fileKey, nodeId };
}

/** "1-2" or "1:2" (also "I1:2;3:4" instance ids) → API form with colons. */
export function normaliseNodeId(raw: string): string | null {
  const id = decodeURIComponent(raw).trim().replace(/-/g, ":");
  return /^[A-Za-z0-9:;]{3,120}$/.test(id) ? id : null;
}
