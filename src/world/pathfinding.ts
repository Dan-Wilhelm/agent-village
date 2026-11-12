import type { GraphNode, NodeId } from "./layout";

export interface Graph {
  nodes: Map<NodeId, GraphNode>;
  adjacency: Map<NodeId, Array<{ to: NodeId; cost: number }>>;
}

export function buildGraph(nodes: GraphNode[], edges: Array<[NodeId, NodeId]>): Graph {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const adjacency = new Map<NodeId, Array<{ to: NodeId; cost: number }>>();
  for (const n of nodes) adjacency.set(n.id, []);
  for (const [a, b] of edges) {
    const na = nodeMap.get(a);
    const nb = nodeMap.get(b);
    if (!na || !nb) throw new Error(`Edge references unknown node: ${a} -> ${b}`);
    const cost = Math.hypot(na.x - nb.x, na.z - nb.z);
    adjacency.get(a)!.push({ to: b, cost });
    adjacency.get(b)!.push({ to: a, cost });
  }
  return { nodes: nodeMap, adjacency };
}

/** Dijkstra shortest path. Returns node ids from `from` to `to` (inclusive), or null. */
export function shortestPath(graph: Graph, from: NodeId, to: NodeId): NodeId[] | null {
  if (!graph.nodes.has(from) || !graph.nodes.has(to)) return null;
  if (from === to) return [from];

  const dist = new Map<NodeId, number>([[from, 0]]);
  const prev = new Map<NodeId, NodeId>();
  const open = new Set<NodeId>([from]);

  while (open.size > 0) {
    let current: NodeId | null = null;
    let best = Infinity;
    for (const id of open) {
      const d = dist.get(id) ?? Infinity;
      if (d < best) {
        best = d;
        current = id;
      }
    }
    if (current === null) break;
    if (current === to) break;
    open.delete(current);

    for (const { to: next, cost } of graph.adjacency.get(current) ?? []) {
      const candidate = best + cost;
      if (candidate < (dist.get(next) ?? Infinity)) {
        dist.set(next, candidate);
        prev.set(next, current);
        open.add(next);
      }
    }
  }

  if (!dist.has(to)) return null;
  const path: NodeId[] = [to];
  let cursor = to;
  while (cursor !== from) {
    const p = prev.get(cursor);
    if (!p) return null;
    path.unshift(p);
    cursor = p;
  }
  return path;
}

/** True if segment a→b passes through the axis-aligned rectangle (shrunk by `inset`). */
export function segmentHitsRect(
  a: { x: number; z: number },
  b: { x: number; z: number },
  rect: { minX: number; maxX: number; minZ: number; maxZ: number },
): boolean {
  // Liang–Barsky clipping.
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const checks: Array<[number, number]> = [
    [-dx, a.x - rect.minX],
    [dx, rect.maxX - a.x],
    [-dz, a.z - rect.minZ],
    [dz, rect.maxZ - a.z],
  ];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
    }
  }
  return t0 < t1;
}
