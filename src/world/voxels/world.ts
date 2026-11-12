/**
 * Assembles the whole village from the builders: voxel lists per render
 * model, every collider and a few points of interest. Pure (no DOM), so the
 * layout tests can check the exact colliders the scene uses.
 */
import { BUILDINGS } from "../layout";
import {
  buildDecorations,
  buildDesk,
  buildField,
  buildHouse,
  buildHouseExtras,
  buildingColliders,
  dedupe,
  type BoxCollider,
  type Voxel,
} from "./builders";
import { buildInteriors, type Interiors } from "./interiors";
import { buildBigTree, buildProps, GARDEN_AREA } from "./props";
import {
  BIG_TREE,
  FOUNTAIN,
  POND,
  STREAM,
  boundaryColliders,
  buildGround,
  buildHillTrees,
  buildHills,
  buildMeadow,
  isWater,
} from "./terrain";

export interface VillageWorld {
  ground: Voxel[];
  hills: Voxel[];
  houses: Voxel[];
  trees: Voxel[];
  hillTrees: Voxel[];
  bushes: Voxel[];
  rocks: Voxel[];
  detail: Voxel[];
  plants: Voxel[];
  fine: Voxel[];
  interiors: Interiors;
  chimneys: Array<[number, number, number]>;
  blossoms: Array<{ x: number; z: number; top: number }>;
  /** Walls of buildings and the fenced field. */
  wallColliders: BoxCollider[];
  /** Every other solid thing (furniture, props, trees, rocks, water, desk). */
  propColliders: BoxCollider[];
  /** Invisible ring at the edge of the walkable world. */
  boundary: BoxCollider[];
}

function inRect(x: number, z: number, r: { minX: number; maxX: number; minZ: number; maxZ: number }, m = 0) {
  return x > r.minX - m && x < r.maxX + m && z > r.minZ - m && z < r.maxZ + m;
}

function insideCollider(x: number, z: number, cols: BoxCollider[], margin: number) {
  return cols.some(
    (c) =>
      Math.abs(x - c.center[0]) < c.halfExtents[0] + margin && Math.abs(z - c.center[2]) < c.halfExtents[2] + margin,
  );
}

export function buildVillage(): VillageWorld {
  const defs = Object.values(BUILDINGS);
  const houseDefs = defs.filter((b) => b.kind === "house");
  const field = defs.find((b) => b.kind === "field")!;

  const houses = houseDefs.flatMap((d) => buildHouse(d));
  const extras = houseDefs.map((d) => buildHouseExtras(d));
  const desk = buildDesk();
  const props = buildProps();
  const interiors = buildInteriors();
  const ground = buildGround();

  const streamNear = (x: number, z: number, m: number) =>
    STREAM.some((p, i) => {
      if (i === 0) return false;
      const a = STREAM[i - 1];
      const dx = p.x - a.x;
      const dz = p.z - a.z;
      const l2 = dx * dx + dz * dz;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
      return Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)) < m;
    });
  const treeBlocked = (x: number, z: number) =>
    Math.hypot(x - POND.x, z - POND.z) < POND.r + 3 ||
    streamNear(x, z, 3) ||
    inRect(x, z, GARDEN_AREA, 3) ||
    Math.hypot(x - FOUNTAIN.x, z - FOUNTAIN.z) < 5.5 ||
    Math.hypot(x - BIG_TREE.x, z - BIG_TREE.z) < 6 ||
    insideCollider(x, z, props.colliders, 2.5);
  const deco = buildDecorations(7, treeBlocked);

  const meadow = buildMeadow(
    (x, z) =>
      inRect(x, z, GARDEN_AREA, 0.5) ||
      insideCollider(x, z, props.colliders, 0.4) ||
      deco.treeSpots.some((t) => Math.hypot(t.x - x, t.z - z) < 0.6) ||
      isWater(x, z),
  );

  const bigTree = buildBigTree();
  const blossoms = [
    ...deco.treeSpots.filter((t) => t.kind === "blossom").map((t) => ({ x: t.x, z: t.z, top: 4.5 })),
    { x: BIG_TREE.x, z: BIG_TREE.z, top: 5.5 },
  ];

  const wallColliders = defs.flatMap(buildingColliders);
  const propColliders: BoxCollider[] = [
    desk.collider,
    ...deco.treeColliders,
    { center: [BIG_TREE.x, 1, BIG_TREE.z], halfExtents: [0.4, 1, 0.4] },
    ...meadow.colliders,
    ...props.colliders,
    ...interiors.colliders,
    ...extras.flatMap((e) => e.colliders),
    ...ground.waterColliders,
  ];

  return {
    ground: ground.voxels,
    hills: buildHills(),
    houses,
    trees: dedupe([...deco.trees, ...bigTree]),
    hillTrees: buildHillTrees(),
    bushes: meadow.bushes,
    rocks: meadow.rocks,
    detail: dedupe([...extras.flatMap((e) => e.detail), ...props.detail, ...buildField(field), ...interiors.detail]),
    plants: meadow.plants,
    fine: dedupe([...desk.voxels, ...interiors.fine]),
    interiors,
    chimneys: extras.flatMap((e) => e.chimneys),
    blossoms,
    wallColliders,
    propColliders,
    boundary: boundaryColliders(),
  };
}
