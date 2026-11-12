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
}

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
}

/** Advance every mover; call once per frame. */
export function stepMovers(dt: number) {
  for (const mover of movers.values()) {
    if (mover.path.length === 0) continue;
    let budget = WALK_SPEED * Math.min(dt, 0.1);
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
    if (mover.path.length === 0) {
      const done = mover.onArrive;
      mover.onArrive = undefined;
      done?.();
    }
  }
}

export function isMoving(id: string) {
  return (movers.get(id)?.path.length ?? 0) > 0;
}
