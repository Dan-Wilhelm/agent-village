/**
 * Village layout: buildings, the walking graph agents use, and the visitor
 * queue in front of the owner's desk. Units are meters; +x = east, +z = south.
 */

export type Facing = "north" | "south" | "east" | "west";
export type BuildingId = "office" | "hq" | "workshop" | "library" | "training";

export interface BuildingDef {
  id: BuildingId;
  name: string;
  subtitle: string;
  /** Center of the footprint on the ground. */
  center: { x: number; z: number };
  /** Footprint size in meters (x by z). Training Ground is an open, fenced field. */
  size: { x: number; z: number };
  wallHeight: number;
  door: Facing;
  kind: "house" | "field";
  roof: "red" | "blue" | "green" | "purple";
}

export const BUILDINGS: Record<BuildingId, BuildingDef> = {
  hq: {
    id: "hq",
    name: "ClickUp HQ",
    subtitle: "Your tasks live here",
    center: { x: 0, z: 0 },
    size: { x: 12, z: 12 },
    wallHeight: 5.5,
    door: "south",
    kind: "house",
    roof: "purple",
  },
  office: {
    id: "office",
    name: "My Office",
    subtitle: "Agents come to you here",
    center: { x: 0, z: 22 },
    size: { x: 10, z: 10 },
    wallHeight: 4,
    door: "north",
    kind: "house",
    roof: "red",
  },
  workshop: {
    id: "workshop",
    name: "Workshop",
    subtitle: "Task creation",
    center: { x: 20, z: 4 },
    size: { x: 10, z: 10 },
    wallHeight: 4,
    door: "west",
    kind: "house",
    roof: "blue",
  },
  library: {
    id: "library",
    name: "Library",
    subtitle: "Meeting notes & docs",
    center: { x: -20, z: 4 },
    size: { x: 10, z: 10 },
    wallHeight: 4,
    door: "east",
    kind: "house",
    roof: "green",
  },
  training: {
    id: "training",
    name: "Training Ground",
    subtitle: "Teach your agents",
    center: { x: 17, z: -17 },
    size: { x: 10, z: 10 },
    wallHeight: 1,
    door: "west",
    kind: "field",
    roof: "green",
  },
};

export const DOOR_WIDTH = 2;
export const DOOR_HEIGHT = 2.5;

// ---------------------------------------------------------------------------
// Walking graph
// ---------------------------------------------------------------------------

export type NodeId = string;
export interface GraphNode {
  id: NodeId;
  x: number;
  z: number;
}

const RING_RADIUS = 11;
const ringNode = (id: string, deg: number): GraphNode => ({
  id,
  x: Math.round(RING_RADIUS * Math.cos((deg * Math.PI) / 180) * 100) / 100,
  z: Math.round(RING_RADIUS * Math.sin((deg * Math.PI) / 180) * 100) / 100,
});

/** 8 nodes on a ring path around ClickUp HQ (angle 0° = east, 90° = south). */
const RING: GraphNode[] = [
  ringNode("ring-e", 0),
  ringNode("ring-se", 45),
  ringNode("ring-s", 90),
  ringNode("ring-sw", 135),
  ringNode("ring-w", 180),
  ringNode("ring-nw", 225),
  ringNode("ring-n", 270),
  ringNode("ring-ne", 315),
];

export const NODES: GraphNode[] = [
  ...RING,
  // HQ (door on the south face at z = 6)
  { id: "hq-out", x: 0, z: 7.5 },
  { id: "hq-door", x: 0, z: 6 },
  { id: "hq-in", x: 0, z: 3 },
  // Office (door on the north face at z = 17)
  { id: "office-out", x: 0, z: 15.5 },
  { id: "office-door", x: 0, z: 17 },
  { id: "office-in", x: 0, z: 18.6 },
  // Workshop (door on the west face at x = 15)
  { id: "workshop-out", x: 13.5, z: 4 },
  { id: "workshop-door", x: 15, z: 4 },
  { id: "workshop-in", x: 17.5, z: 4 },
  // Library (door on the east face at x = -15)
  { id: "library-out", x: -13.5, z: 4 },
  { id: "library-door", x: -15, z: 4 },
  { id: "library-in", x: -17.5, z: 4 },
  // Training Ground (open field, gate on the west side)
  { id: "training-out", x: 10.5, z: -16 },
  { id: "training-gate", x: 12, z: -17 },
  { id: "training-in", x: 16, z: -17 },
];

export const EDGES: Array<[NodeId, NodeId]> = [
  // ring
  ["ring-e", "ring-se"],
  ["ring-se", "ring-s"],
  ["ring-s", "ring-sw"],
  ["ring-sw", "ring-w"],
  ["ring-w", "ring-nw"],
  ["ring-nw", "ring-n"],
  ["ring-n", "ring-ne"],
  ["ring-ne", "ring-e"],
  // HQ
  ["ring-s", "hq-out"],
  ["hq-out", "hq-door"],
  ["hq-door", "hq-in"],
  // Office
  ["ring-s", "office-out"],
  ["office-out", "office-door"],
  ["office-door", "office-in"],
  // Workshop
  ["ring-e", "workshop-out"],
  ["ring-se", "workshop-out"],
  ["workshop-out", "workshop-door"],
  ["workshop-door", "workshop-in"],
  // Library
  ["ring-w", "library-out"],
  ["ring-sw", "library-out"],
  ["library-out", "library-door"],
  ["library-door", "library-in"],
  // Training
  ["ring-ne", "training-out"],
  ["training-out", "training-gate"],
  ["training-gate", "training-in"],
];

/** Where agents "are" when they are at a building. */
export const BUILDING_INSIDE_NODE: Record<BuildingId, NodeId> = {
  office: "office-in",
  hq: "hq-in",
  workshop: "workshop-in",
  library: "library-in",
  training: "training-in",
};

// ---------------------------------------------------------------------------
// Owner's desk and the visitor queue
// ---------------------------------------------------------------------------

/** The owner's desk (center) and where the owner stands behind it, facing the door (north). */
export const DESK = { x: 0, z: 24, width: 3, depth: 1.2, height: 0.9 };
export const PLAYER_SPAWN = { x: 0, z: 25.6 };

/**
 * Queue positions for waiting agents, first = right in front of the desk.
 * Inside the office first, then a short line outside the door.
 */
export const QUEUE_SLOTS: Array<{ x: number; z: number; inside: boolean }> = [
  { x: 0, z: 22.4, inside: true },
  { x: -1.4, z: 21.2, inside: true },
  { x: 1.4, z: 21.2, inside: true },
  { x: -1.4, z: 19.8, inside: true },
  { x: 1.4, z: 19.8, inside: true },
  { x: 0, z: 15.2, inside: false },
  { x: 1.3, z: 14.2, inside: false },
  { x: -1.3, z: 14.2, inside: false },
];

/** Office door center, used when an agent moves from the outside line to the inside queue. */
export const OFFICE_DOOR = { x: 0, z: 17 };

/** Points to walk when moving up in the queue (from one slot to another). */
export function queueMovePath(fromSlot: number, toSlot: number): Array<{ x: number; z: number }> {
  const from = QUEUE_SLOTS[Math.min(fromSlot, QUEUE_SLOTS.length - 1)];
  const to = QUEUE_SLOTS[Math.min(toSlot, QUEUE_SLOTS.length - 1)];
  // Crossing between inside and outside always goes through the door (both directions:
  // a higher-priority visit can push someone back out).
  if (from.inside !== to.inside) return [OFFICE_DOOR, { x: to.x, z: to.z }];
  return [{ x: to.x, z: to.z }];
}
