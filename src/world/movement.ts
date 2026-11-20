"use client";

/**
 * Agent movement lives OUTSIDE React state: positions change every frame, so
 * they are kept in a plain mutable registry and read inside useFrame. React
 * state (the store) only changes on arrival events.
 */
import {
  BUILDING_INSIDE_NODE,
  EDGES,
  NODES,
  QUEUE_SLOTS,
  queueMovePath,
  type BuildingId,
  type NodeId,
} from "./layout";
import { buildGraph, shortestPath } from "./pathfinding";

export const WALK_SPEED = 2.4; // m/s

export interface Mover {
  x: number;
  z: number;
  heading: number;
  /** Remaining points to walk through. */
  path: Array<{ x: number; z: number }>;
  /** Graph node the agent is at / last passed (for routing). */
  node: NodeId;
  /** Index of the office queue slot the agent stands at, or null. */
  slot: number | null;
  onArrive?: () => void;
  /** Small per-agent offset so agents at the same building don't overlap. */
  spread: { x: number; z: number };
  /** When the current walk started (earlier = right of way when two agents meet). */
  startedAt?: number;
  /** Seconds spent waiting for another agent (after a while it walks around instead). */
  waited?: number;
}

/** Personal space between agents (m). */
export const PERSONAL_SPACE = 0.9;
const MAX_WAIT_S = 1.2;
let clock = 0;

const graph = buildGraph(NODES, EDGES);
export const movers = new Map<string, Mover>();

export function placeAgent(id: string, building: BuildingId, spread: { x: number; z: number }) {
  const node = BUILDING_INSIDE_NODE[building];
  const n = graph.nodes.get(node)!;
  movers.set(id, { x: n.x + spread.x, z: n.z + spread.z, heading: 0, path: [], node, slot: null, spread });
}

function routeTo(mover: Mover, targetNode: NodeId) {
  const ids = shortestPath(graph, mover.node, targetNode) ?? [targetNode];
  return ids.map((id) => {
    const n = graph.nodes.get(id)!;
    return { x: n.x, z: n.z };
  });
}

/** Walk to a building (stands near its inside node). */
export function sendToBuilding(id: string, building: BuildingId, onArrive?: () => void) {
  const mover = movers.get(id);
  if (!mover) return;
  const target = BUILDING_INSIDE_NODE[building];
  const path = routeTo(mover, target);
  const last = path[path.length - 1];
  path[path.length - 1] = { x: last.x + mover.spread.x, z: last.z + mover.spread.z };
  mover.path = path;
  mover.node = target;
  mover.slot = null;
  mover.onArrive = onArrive;
  mover.startedAt = clock;
}

/** Walk to (or move up to) a queue slot in front of the owner's desk. */
export function sendToSlot(id: string, slotIndex: number, onArrive?: () => void) {
  const mover = movers.get(id);
  if (!mover) return;
  const slot = QUEUE_SLOTS[Math.min(slotIndex, QUEUE_SLOTS.length - 1)];
  if (mover.slot !== null && mover.path.length === 0) {
    // Already standing in the queue: move up (through the door when coming in from outside).
    mover.path = queueMovePath(mover.slot, slotIndex);
    if (slot.inside) mover.node = "office-in";
  } else if (mover.slot !== null) {
    // Still on the way to the queue: keep the route, just change the final spot.
    mover.path[mover.path.length - 1] = { x: slot.x, z: slot.z };
  } else {
    const via = slot.inside ? "office-in" : "office-out";
    mover.path = [...routeTo(mover, via), { x: slot.x, z: slot.z }];
    mover.node = via;
  }
  mover.slot = slotIndex;
  mover.onArrive = onArrive;
  mover.startedAt ??= clock;
  if (mover.path.length === 0) mover.startedAt = undefined;
}

/** The closest other agent right ahead (within personal space, in a forward cone), if any. */
function blockerAhead(self: Mover, dirX: number, dirZ: number) {
  let best: Mover | null = null;
  let bestDist = Infinity;
  for (const other of movers.values()) {
    if (other === self) continue;
    const dx = other.x - self.x;
    const dz = other.z - self.z;
    const d = Math.hypot(dx, dz);
    if (d > PERSONAL_SPACE || d < 1e-6) continue;
    if (dx * dirX + dz * dirZ < 0.3 * d) continue; // beside or behind: no problem
    if (d < bestDist) [best, bestDist] = [other, d];
  }
  return best;
}

/** Minimum distance in every direction (also when passing beside someone). */
export const MIN_SEPARATION = 0.65;

/** A walking agent is gently pushed away from anyone closer than MIN_SEPARATION (standing agents keep their spot). */
function keepApart(self: Mover) {
  for (const other of movers.values()) {
    if (other === self) continue;
    const dx = self.x - other.x;
    const dz = self.z - other.z;
    const d = Math.hypot(dx, dz);
    if (d >= MIN_SEPARATION) continue;
    // Never push an agent away from its final spot (queue slot / home): it would never arrive.
    const finalPoint = self.path.at(-1);
    if (!finalPoint || Math.hypot(finalPoint.x - self.x, finalPoint.z - self.z) < 0.3) continue;
    const push = MIN_SEPARATION - d;
    const nx = d > 1e-6 ? dx / d : 1;
    const nz = d > 1e-6 ? dz / d : 0;
    self.x += nx * push;
    self.z += nz * push;
  }
}

/** Who goes first when two walking agents meet: the one that set off earlier. */
function hasRightOfWay(a: Mover, b: Mover) {
  return (a.startedAt ?? Infinity) < (b.startedAt ?? Infinity);
}

/** Advance every mover; call once per frame. Agents keep their distance instead of walking through each other. */
export function stepMovers(dt: number) {
  const step = Math.min(dt, 0.1);
  clock += step;
  for (const mover of movers.values()) {
    if (mover.path.length === 0) continue;
    const t0 = mover.path[0];
    const len0 = Math.hypot(t0.x - mover.x, t0.z - mover.z);
    if (len0 > 1e-3) {
      const dirX = (t0.x - mover.x) / len0;
      const dirZ = (t0.z - mover.z) / len0;
      let blocker = blockerAhead(mover, dirX, dirZ);
      // Someone beyond my next point is no obstacle: I stop (or turn) before reaching them.
      if (blocker && Math.hypot(blocker.x - mover.x, blocker.z - mover.z) > len0) blocker = null;
      if (blocker) {
        const blockerWalking = blocker.path.length > 0;
        // Same direction: just follow at a distance (no overtaking manoeuvres).
        if (blockerWalking) {
          const bt = blocker.path[0];
          const bl = Math.hypot(bt.x - blocker.x, bt.z - blocker.z);
          if (bl > 1e-3 && ((bt.x - blocker.x) / bl) * dirX + ((bt.z - blocker.z) / bl) * dirZ > 0.5) {
            mover.waited = 0;
            mover.heading = Math.atan2(dirX, dirZ);
            continue;
          }
        }
        // A walking agent with right of way passes first: wait briefly.
        if (blockerWalking && hasRightOfWay(blocker, mover) && (mover.waited ?? 0) < MAX_WAIT_S) {
          mover.waited = (mover.waited ?? 0) + step;
          mover.heading = Math.atan2(dirX, dirZ);
          continue;
        }
        // Someone stands in the way (or waited long enough): walk around them on the free side.
        const toX = blocker.x - mover.x;
        const toZ = blocker.z - mover.z;
        const side = dirX * toZ - dirZ * toX > 0 ? -1 : 1; // step away from the blocker's side
        const sx = dirX * 0.45 + -dirZ * side * 0.9;
        const sz = dirZ * 0.45 + dirX * side * 0.9;
        const sl = Math.hypot(sx, sz);
        const move = WALK_SPEED * step * 0.8;
        mover.x += (sx / sl) * move;
        mover.z += (sz / sl) * move;
        mover.heading = Math.atan2(sx, sz);
        keepApart(mover);
        continue;
      }
    }
    mover.waited = 0;
    let budget = WALK_SPEED * step;
    while (budget > 0 && mover.path.length > 0) {
      const target = mover.path[0];
      const dx = target.x - mover.x;
      const dz = target.z - mover.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 1e-3) {
        mover.path.shift();
        continue;
      }
      mover.heading = Math.atan2(dx, dz);
      if (dist <= budget) {
        mover.x = target.x;
        mover.z = target.z;
        budget -= dist;
        mover.path.shift();
      } else {
        mover.x += (dx / dist) * budget;
        mover.z += (dz / dist) * budget;
        budget = 0;
      }
    }
    keepApart(mover);
    if (mover.path.length === 0) {
      mover.startedAt = undefined;
      const done = mover.onArrive;
      mover.onArrive = undefined;
      done?.();
    }
  }
}

export function isMoving(id: string) {
  return (movers.get(id)?.path.length ?? 0) > 0;
}

// Development only: lets automated browser tests measure agent distances.
if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
  (window as unknown as { __movers?: typeof movers }).__movers = movers;
}
