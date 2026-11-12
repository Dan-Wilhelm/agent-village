import { describe, expect, it } from "vitest";

import { BUILDINGS, BUILDING_INSIDE_NODE, DESK, DOOR_WIDTH, EDGES, NODES, QUEUE_SLOTS, queueMovePath } from "@/world/layout";
import { buildGraph, segmentHitsRect, shortestPath } from "@/world/pathfinding";
import { buildHouse, buildingColliders, buildDecorations, buildPathTiles } from "@/world/voxels/builders";

const graph = buildGraph(NODES, EDGES);
const nodeById = new Map(NODES.map((n) => [n.id, n]));

/** Wall band of a building: the footprint minus its interior; door gaps are allowed. */
function crossesWall(a: { x: number; z: number }, b: { x: number; z: number }) {
  for (const def of Object.values(BUILDINGS)) {
    const minX = def.center.x - def.size.x / 2;
    const maxX = def.center.x + def.size.x / 2;
    const minZ = def.center.z - def.size.z / 2;
    const maxZ = def.center.z + def.size.z / 2;
    const t = 0.5;
    const half = DOOR_WIDTH / 2 - 0.2; // keep a little clearance in the door
    const walls = {
      north: { minX, maxX, minZ, maxZ: minZ + t },
      south: { minX, maxX, minZ: maxZ - t, maxZ },
      west: { minX, maxX: minX + t, minZ, maxZ },
      east: { minX: maxX - t, maxX, minZ, maxZ },
    } as const;
    for (const [side, rect] of Object.entries(walls)) {
      if (!segmentHitsRect(a, b, rect)) continue;
      if (side === def.door) {
        // allowed only through the door gap
        const horizontal = side === "north" || side === "south";
        const wallCoord = horizontal ? (rect.minZ + rect.maxZ) / 2 : (rect.minX + rect.maxX) / 2;
        const da = horizontal ? b.z - a.z : b.x - a.x;
        if (Math.abs(da) < 1e-9) return `${def.id}:${side}`;
        const tt = (wallCoord - (horizontal ? a.z : a.x)) / da;
        const crossing = horizontal ? a.x + (b.x - a.x) * tt : a.z + (b.z - a.z) * tt;
        const center = horizontal ? def.center.x : def.center.z;
        if (Math.abs(crossing - center) <= half) continue;
      }
      return `${def.id}:${side}`;
    }
  }
  return null;
}

describe("walking graph", () => {
  it("connects every building to every other building", () => {
    const ids = Object.values(BUILDING_INSIDE_NODE);
    for (const from of ids) for (const to of ids) expect(shortestPath(graph, from, to), `${from}->${to}`).not.toBeNull();
  });

  it("never walks through a wall", () => {
    for (const [a, b] of EDGES) expect(crossesWall(nodeById.get(a)!, nodeById.get(b)!), `${a}->${b}`).toBeNull();
  });

  it("reaches every queue slot without crossing walls, and moves forward through the door", () => {
    const officeIn = nodeById.get("office-in")!;
    const officeOut = nodeById.get("office-out")!;
    QUEUE_SLOTS.forEach((s, i) => {
      expect(crossesWall(s.inside ? officeIn : officeOut, s), `slot ${i}`).toBeNull();
      // re-targeted while still walking in via office-out
      expect(crossesWall(officeOut, s), `slot ${i} via office-out`).toBeNull();
      for (let j = 0; j < i; j++) {
        let at: { x: number; z: number } = s;
        for (const p of queueMovePath(i, j)) {
          expect(crossesWall(at, p), `slot ${i}->${j}`).toBeNull();
          at = p;
        }
      }
    });
  });

  it("keeps queue slots in front of the desk and inside the office when marked inside", () => {
    const office = BUILDINGS.office;
    for (const s of QUEUE_SLOTS.filter((q) => q.inside)) {
      expect(s.z).toBeLessThan(DESK.z - DESK.depth / 2);
      expect(s.z).toBeGreaterThan(office.center.z - office.size.z / 2);
    }
  });
});

describe("voxel builders", () => {
  it("leaves a walkable door gap in every house", () => {
    for (const def of Object.values(BUILDINGS).filter((b) => b.kind === "house")) {
      const voxels = buildHouse(def);
      const doorPoint =
        def.door === "north" ? { x: def.center.x, z: def.center.z - def.size.z / 2 + 0.25 }
        : def.door === "south" ? { x: def.center.x, z: def.center.z + def.size.z / 2 - 0.25 }
        : def.door === "west" ? { x: def.center.x - def.size.x / 2 + 0.25, z: def.center.z }
        : { x: def.center.x + def.size.x / 2 - 0.25, z: def.center.z };
      const blocked = voxels.some(
        (v) => Math.abs(v.x - doorPoint.x) < 0.3 && Math.abs(v.z - doorPoint.z) < 0.3 && v.y < 2,
      );
      expect(blocked, def.id).toBe(false);
    }
  });

  it("produces no duplicate voxels", () => {
    for (const def of Object.values(BUILDINGS).filter((b) => b.kind === "house")) {
      const voxels = buildHouse(def);
      const keys = new Set(voxels.map((v) => `${v.x}|${v.y}|${v.z}`));
      expect(keys.size).toBe(voxels.length);
    }
  });

  it("builds colliders that leave the door open", () => {
    for (const def of Object.values(BUILDINGS)) {
      const cols = buildingColliders(def);
      expect(cols.length).toBe(5); // 3 full walls + 2 halves around the door
    }
  });

  it("keeps trees off paths and is deterministic", () => {
    const a = buildDecorations(7);
    const b = buildDecorations(7);
    expect(a.trees.length).toBe(b.trees.length);
    const tiles = buildPathTiles();
    for (const c of a.treeColliders) {
      const [x, , z] = c.center;
      expect(tiles.some((t) => Math.abs(t.x - x) < 1 && Math.abs(t.z - z) < 1)).toBe(false);
    }
  });
});
