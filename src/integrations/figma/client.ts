import { z } from "zod";

/**
 * Minimal Figma REST client (personal access token, header X-Figma-Token).
 * Read: files, nodes, image exports, comments. Write: comments only (the REST
 * API cannot create or change designs). Figma's rate limits are low (file reads
 * ~10–20/min on full/dev seats), so callers keep requests few.
 */
const BASE = "https://api.figma.com/v1";

export class FigmaError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "FigmaError";
  }
}

const boxSchema = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).nullish();
export type FigmaNode = {
  id: string;
  name: string;
  type: string;
  characters?: string;
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number } | null;
  children?: FigmaNode[];
};
const nodeSchema: z.ZodType<FigmaNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    characters: z.string().optional(),
    absoluteBoundingBox: boxSchema,
    children: z.array(nodeSchema).optional(),
  }),
) as z.ZodType<FigmaNode>;

const meSchema = z.object({ id: z.coerce.string(), handle: z.string(), email: z.string().nullish() });
const fileSchema = z.object({ name: z.string(), lastModified: z.string().nullish(), document: nodeSchema });
const nodesSchema = z.object({
  name: z.string(),
  lastModified: z.string().nullish(),
  nodes: z.record(z.string(), z.object({ document: nodeSchema }).nullable()),
});
const imagesSchema = z.object({ err: z.string().nullish(), images: z.record(z.string(), z.string().nullable()) });
const commentsSchema = z.object({
  comments: z.array(
    z.object({
      id: z.coerce.string(),
      message: z.string(),
      created_at: z.string().nullish(),
      resolved_at: z.string().nullish(),
      user: z.object({ handle: z.string().nullish() }).nullish(),
      client_meta: z.object({ node_id: z.string().nullish() }).passthrough().nullish(),
      parent_id: z.coerce.string().nullish(),
    }),
  ),
});

export function createFigmaClient(token: string, fetchImpl: typeof fetch = fetch, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))) {
  async function request<T>(method: "GET" | "POST", path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(`${BASE}${path}`, {
        method,
        headers: { "X-Figma-Token": token, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });
      if (res.status === 429 && attempt === 0) {
        const wait = Number(res.headers.get("retry-after"));
        if (Number.isFinite(wait) && wait > 0 && wait <= 20) {
          await sleep(wait * 1000);
          continue;
        }
        throw new FigmaError(`Figma's rate limit is reached — try again in ${Number.isFinite(wait) && wait > 0 ? Math.ceil(wait) : "a few"} seconds.`, 429);
      }
      const text = await res.text();
      let json: unknown;
      try {
        json = text ? JSON.parse(text) : undefined;
      } catch {
        json = undefined;
      }
      if (!res.ok) {
        const msg = (json as { err?: string; message?: string } | undefined)?.err ?? (json as { message?: string } | undefined)?.message;
        if (res.status === 403) throw new FigmaError(msg ? `Figma refused: ${msg}` : "Figma refused access (token scope or file permission).", 403);
        if (res.status === 404) throw new FigmaError("Figma file or frame not found (or not shared with this account).", 404);
        throw new FigmaError(msg ?? `Figma request failed (${res.status})`, res.status);
      }
      const parsed = schema.safeParse(json);
      if (!parsed.success) throw new FigmaError("Unexpected answer from Figma.", 502);
      return parsed.data;
    }
  }
  const enc = encodeURIComponent;
  return {
    me: () => request("GET", "/me", meSchema),
    file: (key: string, depth = 2) => request("GET", `/files/${enc(key)}?depth=${depth}`, fileSchema),
    nodes: (key: string, ids: string[], depth = 3) =>
      request("GET", `/files/${enc(key)}/nodes?ids=${ids.map(enc).join(",")}&depth=${depth}`, nodesSchema),
    images: (key: string, ids: string[], scale = 1) =>
      request("GET", `/images/${enc(key)}?ids=${ids.map(enc).join(",")}&format=png&scale=${Math.min(4, Math.max(0.01, scale))}`, imagesSchema),
    comments: (key: string) => request("GET", `/files/${enc(key)}/comments`, commentsSchema),
    postComment: (key: string, message: string, nodeId?: string) =>
      request("POST", `/files/${enc(key)}/comments`, z.object({ id: z.coerce.string() }).passthrough(), {
        message,
        ...(nodeId ? { client_meta: { node_id: nodeId, node_offset: { x: 0, y: 0 } } } : {}),
      }),
  };
}
export type FigmaClient = ReturnType<typeof createFigmaClient>;

/** Text and structure of a node tree, compact for the agent (no images). */
export function summariseNode(node: FigmaNode, maxChars = 6000) {
  const texts: string[] = [];
  const frames: Array<{ id: string; name: string; type: string; size: string | null }> = [];
  let budget = maxChars;
  const walk = (n: FigmaNode, depth: number) => {
    if (n.type === "TEXT" && n.characters && budget > 0) {
      const t = n.characters.trim().slice(0, budget);
      if (t) {
        texts.push(`${n.name}: ${t}`);
        budget -= t.length;
      }
    }
    if (depth <= 2 && ["FRAME", "COMPONENT", "COMPONENT_SET", "SECTION", "INSTANCE", "GROUP"].includes(n.type) && frames.length < 60) {
      const b = n.absoluteBoundingBox;
      frames.push({ id: n.id, name: n.name, type: n.type, size: b ? `${Math.round(b.width)}×${Math.round(b.height)}` : null });
    }
    for (const c of n.children ?? []) walk(c, depth + 1);
  };
  walk(node, 0);
  return { frames, texts };
}
