/**
 * Terrain: the grassy village floor with footpaths and a cobblestone plaza, a
 * pond with a little stream, rolling hills that close the world off, and the
 * small things that make a meadow feel alive (flowers, tufts, rocks, bushes).
 */
import { BUILDINGS } from "../layout";
import {
  DETAIL,
  VOXEL,
  buildTree,
  distToSegment,
  dedupe,
  insideAnyBuilding,
  mulberry32,
  pathDistance,
  shade,
  type BoxCollider,
  type TreeKind,
  type Voxel,
} from "./builders";
import { hash3 } from "./mesher";

/** Radius of the walkable village (an invisible ring of colliders sits here). */
export const WORLD_RADIUS = 36.5;
/** Hills start rising here. */
const HILL_START = 37.5;
const HILL_END = 78;

export const PLAZA_RADIUS = 12.8;

export const POND = { x: -16.5, z: -15.5, r: 4.4 };
export const STREAM: Array<{ x: number; z: number }> = [
  { x: -18.5, z: -18.5 },
  { x: -21, z: -21 },
  { x: -21, z: -25.5 },
  { x: -24.5, z: -29 },
  { x: -26.5, z: -33 },
];
/** Wooden footbridge over the stream: deck runs along x. */
export const BRIDGE = { x: -21, z: -23.25, halfX: 1.75, halfZ: 0.75 };

/** Smooth 2D value noise in [0, 1). */
export function valueNoise(x: number, z: number, scale: number, seed = 1) {
  const fx = x / scale;
  const fz = z / scale;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = fx - ix;
  const tz = fz - iz;
  const sx = tx * tx * (3 - 2 * tx);
  const sz = tz * tz * (3 - 2 * tz);
  const h = (a: number, b: number) => hash3(a, b, seed);
  const a = h(ix, iz) + (h(ix + 1, iz) - h(ix, iz)) * sx;
  const b = h(ix, iz + 1) + (h(ix + 1, iz + 1) - h(ix, iz + 1)) * sx;
  return a + (b - a) * sz;
}

function streamDistance(x: number, z: number) {
  let best = Infinity;
  for (let i = 0; i < STREAM.length - 1; i++) best = Math.min(best, distToSegment(x, z, STREAM[i], STREAM[i + 1]));
  return best;
}

/** True where the ground is open water (pond or stream). */
export function isWater(x: number, z: number) {
  const pr = POND.r + (valueNoise(x, z, 2.5, 9) - 0.5) * 1.6;
  if (Math.hypot(x - POND.x, z - POND.z) < pr) return true;
  return streamDistance(x, z) < 0.8 && Math.hypot(x, z) < HILL_START + 2;
}

/** Little wooden pier reaching into the pond from the north bank. */
export const DOCK = { x: -16.5, z: -12.25, halfX: 0.5, halfZ: 1.75 };
export const FOUNTAIN = { x: -9.5, z: 13.75, r: 1.75 };
export const BIG_TREE = { x: 9.5, z: 13.75 };

export function onDock(x: number, z: number, margin = 0) {
  return Math.abs(x - DOCK.x) <= DOCK.halfX + margin && Math.abs(z - DOCK.z) <= DOCK.halfZ + margin;
}

export function onBridge(x: number, z: number, margin = 0) {
  return Math.abs(x - BRIDGE.x) <= BRIDGE.halfX + margin && Math.abs(z - BRIDGE.z) <= BRIDGE.halfZ + margin;
}

function inField(x: number, z: number, margin = 0) {
  const f = BUILDINGS.training;
  return Math.abs(x - f.center.x) < f.size.x / 2 + margin && Math.abs(z - f.center.z) < f.size.z / 2 + margin;
}

const GRASS = ["#9ccc72", "#94c66c", "#a4d17a", "#8dbf67"];

export interface Ground {
  voxels: Voxel[];
  /** Colliders that keep the player out of water (bridge left open). */
  waterColliders: BoxCollider[];
}

/** Village ground on a 0.5 m grid: grass, paths, plaza, field, water banks and bed. */
export function buildGround(): Ground {
  const out: Voxel[] = [];
  const waterRows = new Map<number, number[]>();
  const R = HILL_START + 4;
  for (let x = -R + VOXEL / 2; x < R; x += VOXEL) {
    for (let z = -R + VOXEL / 2; z < R; z += VOXEL) {
      const r = Math.hypot(x, z);
      if (r > R) continue;
      if (insideAnyBuilding(x, z) && !inField(x, z)) continue; // houses bring their own floors
      const y = -VOXEL / 2;
      if (isWater(x, z)) {
        const deep = Math.hypot(x - POND.x, z - POND.z) < POND.r - 1.2;
        out.push({ x, y: y - VOXEL, z, color: deep ? "#5c9c8f" : "#7fb3a0", tex: "dirt" });
        if (!onBridge(x, z) && !onDock(x, z)) {
          const row = Math.round(z / VOXEL);
          if (!waterRows.has(row)) waterRows.set(row, []);
          waterRows.get(row)!.push(x);
        }
        continue;
      }
      const n = valueNoise(x, z, 6, 3);
      const n2 = valueNoise(x, z, 17, 5);
      const pd = pathDistance(x, z);
      const edge = (valueNoise(x, z, 1.3, 11) - 0.5) * 0.45;
      let color: string;
      let tex: Voxel["tex"] = "grass";
      const nearWater = [-1, 1].some((dx) => isWater(x + dx * VOXEL, z)) || [-1, 1].some((dz) => isWater(x, z + dz * VOXEL));
      const fd = Math.hypot(x - FOUNTAIN.x, z - FOUNTAIN.z);
      const td = Math.hypot(x - BIG_TREE.x, z - BIG_TREE.z);
      if (fd < 3.6 || td < 3.1) {
        const ringStone = fd < 3.6 ? fd > 3.1 : td > 2.6;
        const pick = hash3(Math.round(x * 2), Math.round(z * 2), 78);
        color = ringStone ? "#b9ad9c" : pick < 0.25 ? "#cfc4b5" : "#ddd3c4";
        tex = ringStone ? "stone" : "cobble";
      } else if (r < PLAZA_RADIUS && !inField(x, z)) {
        // cobblestone plaza with a darker curb ring and a lighter walking ring
        const ring = Math.abs(r - 11) < 0.9;
        const curb = r > PLAZA_RADIUS - 0.55;
        const base = curb ? "#b9ad9c" : ring ? "#e4dacb" : "#d6cbbb";
        const pick = hash3(Math.round(x * 2), Math.round(z * 2), 77);
        color = pick < 0.2 ? shade(base, -0.06) : pick > 0.85 ? shade(base, 0.05) : base;
        tex = curb ? "stone" : "cobble";
      } else if (inField(x, z)) {
        color = n > 0.55 ? "#d8c08c" : "#cfb47f";
        tex = "dirt";
      } else if (pd < 0.95 + edge) {
        const pick = hash3(Math.round(x * 2), Math.round(z * 2), 31);
        color = pick < 0.25 ? "#dcc396" : pick > 0.9 ? "#efdcb3" : "#e6cfa2";
        tex = "dirt";
      } else if (nearWater) {
        color = "#e3d2a2";
        tex = "dirt";
      } else {
        const idx = Math.floor(n * 3.999);
        color = GRASS[idx];
        if (n2 > 0.68) color = shade(color, 0.05); // sunny meadow patches
        if (n2 < 0.25) color = shade(color, -0.04);
        if (pd < 1.5 + edge) color = shade(color, -0.04); // worn edge next to the path
      }
      out.push({ x, y, z, color, tex });
    }
  }

  // Merge water cells row by row into box colliders.
  const waterColliders: BoxCollider[] = [];
  for (const [row, xs] of waterRows) {
    xs.sort((a, b) => a - b);
    let start = xs[0];
    let prev = xs[0];
    const flush = (a: number, b: number) =>
      waterColliders.push({
        center: [(a + b) / 2, 0.5, row * VOXEL],
        halfExtents: [(b - a) / 2 + VOXEL / 2, 0.5, VOXEL / 2],
      });
    for (let i = 1; i < xs.length; i++) {
      if (xs[i] - prev > VOXEL + 1e-6) {
        flush(start, prev);
        start = xs[i];
      }
      prev = xs[i];
    }
    flush(start, prev);
  }
  return { voxels: out, waterColliders };
}

/** Rolling hills (1 m voxels) around the village with grassy tops and earthy sides. */
export function hillHeight(x: number, z: number) {
  const r = Math.hypot(x, z);
  if (r < HILL_START) return 0;
  const t = (r - HILL_START) / (HILL_END - HILL_START);
  const n = valueNoise(x, z, 9, 21) * 0.7 + valueNoise(x, z, 23, 22) * 0.6;
  let h = Math.pow(t, 1.15) * 15 + (n - 0.6) * 4 + 1;
  if (streamDistance(x, z) < 2.2) h = Math.min(h, 0.6 + (r - HILL_START) * 0.08); // the stream's little valley
  return Math.max(r > HILL_START + 1 ? 1 : 0, Math.round(h));
}

export function buildHills(): Voxel[] {
  const out: Voxel[] = [];
  const S = 1;
  for (let x = -HILL_END + S / 2; x < HILL_END; x += S) {
    for (let z = -HILL_END + S / 2; z < HILL_END; z += S) {
      const r = Math.hypot(x, z);
      if (r < HILL_START - 1 || r > HILL_END) continue;
      const h = hillHeight(x, z);
      if (h <= 0) continue;
      const lowest = Math.min(hillHeight(x + S, z), hillHeight(x - S, z), hillHeight(x, z + S), hillHeight(x, z - S));
      const from = Math.max(0, Math.min(h - 1, lowest));
      const n = valueNoise(x, z, 7, 4);
      for (let y = from; y < h; y++) {
        const top = y === h - 1;
        const color = top ? (n > 0.6 ? "#9ccc72" : n > 0.35 ? "#93c56b" : "#8bbd66") : y === h - 2 ? "#b08c66" : "#a5825e";
        out.push({ x, y: y + 0.5, z, color, tex: top ? "grass" : "dirt" });
      }
    }
  }
  return out;
}

/** Pines and round trees dotted over the hills (backdrop, no colliders needed). */
export function buildHillTrees(): Voxel[] {
  const rand = mulberry32(99);
  const out: Voxel[] = [];
  const placed: Array<{ x: number; z: number }> = [];
  for (let attempt = 0; attempt < 2500 && placed.length < 120; attempt++) {
    const a = rand() * Math.PI * 2;
    const r = HILL_START + 1.5 + rand() * 30;
    const x = Math.round((Math.cos(a) * r) / VOXEL) * VOXEL;
    const z = Math.round((Math.sin(a) * r) / VOXEL) * VOXEL;
    if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < 3.6)) continue;
    if (streamDistance(x, z) < 2.5) continue;
    const h = hillHeight(x, z);
    placed.push({ x, z });
    const kind: TreeKind = rand() > 0.45 ? "pine" : rand() > 0.3 ? "oak" : rand() > 0.5 ? "autumn" : "blossom";
    out.push(...buildTree(x, z, rand() > 0.5 ? 2 : 1, kind, h));
  }
  return out;
}

/** Ring of invisible walls just inside the hills. */
export function boundaryColliders(): BoxCollider[] {
  const n = 28;
  const cols: BoxCollider[] = [];
  const half = (Math.PI * WORLD_RADIUS) / n + 0.6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    // rotated boxes are not supported by our simple collider type, so approximate with small squares
    for (let k = -2; k <= 2; k++) {
      const t = a + (k / 5) * ((2 * Math.PI) / n);
      cols.push({
        center: [Math.cos(t) * (WORLD_RADIUS + 0.6), 1.5, Math.sin(t) * (WORLD_RADIUS + 0.6)],
        halfExtents: [half / 5 + 0.5, 1.5, half / 5 + 0.5],
      });
    }
  }
  return cols;
}

export interface Meadow {
  /** Flowers, grass blades, reeds, mushrooms (PLANT scale, swaying). */
  plants: Voxel[];
  /** Rocks and bushes (DETAIL scale). */
  rocks: Voxel[];
  bushes: Voxel[];
  colliders: BoxCollider[];
}

/** Edge length of the delicate plant voxels (grass blades, flower stems). */
export const PLANT = 0.1;

/** Scatter flowers, grass blades, bushes, rocks, reeds and lily pads. */
export function buildMeadow(blocked: (x: number, z: number) => boolean): Meadow {
  const rand = mulberry32(2024);
  const plants: Voxel[] = [];
  const rocks: Voxel[] = [];
  const bushes: Voxel[] = [];
  const colliders: BoxCollider[] = [];
  const p = PLANT;
  const snap = (v: number) => Math.round(v / p - 0.5) * p + p / 2;
  const snapD = (v: number) => Math.round(v / DETAIL - 0.5) * DETAIL + DETAIL / 2;
  const free = (x: number, z: number, pathMargin: number) =>
    Math.hypot(x, z) < WORLD_RADIUS - 0.5 &&
    Math.hypot(x, z) > PLAZA_RADIUS + 0.3 &&
    Math.hypot(x - FOUNTAIN.x, z - FOUNTAIN.z) > 3.8 &&
    Math.hypot(x - BIG_TREE.x, z - BIG_TREE.z) > 3.3 &&
    pathDistance(x, z) > pathMargin &&
    !insideAnyBuilding(x, z, 0.6) &&
    !inField(x, z, 0.3) &&
    !isWater(x, z) &&
    !blocked(x, z);

  const stem = "#5a9e4b";
  const flowerColors = ["#ff8fab", "#ffd166", "#ffffff", "#c38bff", "#ff9f68", "#8fd3ff"];
  const flower = (x: number, z: number, color: string, height: number) => {
    for (let y = 0; y < height; y++) plants.push({ x, y: (y + 0.5) * p, z, color: stem, tex: "leaf" });
    const top = (height + 0.5) * p;
    // a little plus-shaped blossom with a yellow heart
    plants.push({ x, y: top, z, color: color === "#ffd166" ? "#ff9f43" : "#ffd166" });
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) plants.push({ x: x + dx * p, y: top, z: z + dz * p, color });
    if (rand() > 0.5) plants.push({ x: x + p, y: p * 1.5, z, color: "#6fb35a", tex: "leaf" }); // leaf
  };
  const blades = (x: number, z: number) => {
    const c = rand() > 0.5 ? "#79b860" : "#86c169";
    const n = 2 + Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) {
      const bx = x + Math.round((rand() - 0.5) * 3) * p;
      const bz = z + Math.round((rand() - 0.5) * 3) * p;
      const h = 1 + Math.floor(rand() * 3);
      for (let y = 0; y < h; y++) plants.push({ x: bx, y: (y + 0.5) * p, z: bz, color: y === h - 1 ? shade(c, 0.12) : c, tex: "leaf" });
    }
  };

  // Flower patches: clusters of one or two colors
  for (let n = 0; n < 90; n++) {
    const cx = (rand() - 0.5) * 70;
    const cz = (rand() - 0.5) * 70;
    if (!free(cx, cz, 1.4)) continue;
    const c1 = flowerColors[Math.floor(rand() * flowerColors.length)];
    const c2 = flowerColors[Math.floor(rand() * flowerColors.length)];
    const count = 6 + Math.floor(rand() * 10);
    for (let i = 0; i < count; i++) {
      const x = snap(cx + (rand() - 0.5) * 2.8);
      const z = snap(cz + (rand() - 0.5) * 2.8);
      if (!free(x, z, 1.25)) continue;
      flower(x, z, rand() > 0.3 ? c1 : c2, 2 + Math.floor(rand() * 3));
    }
  }
  // Grass tufts everywhere on the grass
  for (let i = 0; i < 2200; i++) {
    const x = snap((rand() - 0.5) * 74);
    const z = snap((rand() - 0.5) * 74);
    if (!free(x, z, 1.15)) continue;
    blades(x, z);
  }
  // Reeds and cattails around the pond, lily pads on it
  for (let i = 0; i < 170; i++) {
    const a = rand() * Math.PI * 2;
    const rr = POND.r + (rand() - 0.3) * 1.6;
    const x = snap(POND.x + Math.cos(a) * rr);
    const z = snap(POND.z + Math.sin(a) * rr);
    if (isWater(x, z)) {
      if (rand() > 0.55 && Math.hypot(x - POND.x, z - POND.z) < POND.r - 1) {
        const lx = snapD(x);
        const lz = snapD(z);
        for (const [dx, dz] of [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ]) if (rand() > 0.15) plants.push({ x: lx + (dx - 0.5) * p, y: -0.1, z: lz + (dz - 0.5) * p, color: "#5fae6f", tex: "leaf" });
        if (rand() > 0.6) plants.push({ x: lx - p / 2, y: 0.0, z: lz - p / 2, color: "#ffc6d6" });
      }
      continue;
    }
    if (pathDistance(x, z) < 1.2 || onDock(x, z, 0.4)) continue;
    if (rand() > 0.55) continue;
    const h = 3 + Math.floor(rand() * 5);
    for (let y = 0; y < h; y++) plants.push({ x, y: (y + 0.5) * p, z, color: y > h - 3 ? "#7fbf5f" : "#6aa84f", tex: "leaf" });
    if (rand() > 0.5) {
      plants.push({ x, y: (h + 0.5) * p, z, color: "#8a5a36" });
      plants.push({ x, y: (h + 1.5) * p, z, color: "#8a5a36" });
    }
  }
  // Mushrooms in shady spots
  for (let i = 0; i < 50; i++) {
    const x = snap((rand() - 0.5) * 66);
    const z = snap((rand() - 0.5) * 66);
    if (!free(x, z, 1.5)) continue;
    const cap = rand() > 0.5 ? "#e0475b" : "#d9a066";
    plants.push({ x, y: p / 2, z, color: "#fff3dd" });
    plants.push({ x, y: p * 1.5, z, color: "#fff3dd" });
    for (const [dx, dz] of [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) plants.push({ x: x + dx * p, y: p * 2.5, z: z + dz * p, color: dx === 0 && dz === 0 ? "#fff3dd" : cap });
  }

  // Rocks (some mossy) and berry bushes at DETAIL scale, with colliders
  const d = DETAIL;
  for (let i = 0; i < 150 && colliders.length < 46; i++) {
    const x = snapD((rand() - 0.5) * 70);
    const z = snapD((rand() - 0.5) * 70);
    if (!free(x, z, 2.2)) continue;
    const isBush = rand() > 0.4;
    const big = rand() > 0.55;
    if (isBush) {
      const berry = rand() > 0.5 ? "#e0475b" : "#7b5ad0";
      const flowering = rand() > 0.6;
      const r = big ? 0.75 : 0.55;
      const n = Math.ceil(r / d) + 1;
      for (let dx = -n; dx <= n; dx++) {
        for (let dz = -n; dz <= n; dz++) {
          for (let dy = 0; dy <= n * 2; dy++) {
            const wob = (rand() - 0.5) * 0.12;
            if (Math.hypot(dx * d, (dy * d - r * 0.75) * 1.25, dz * d) > r + wob) continue;
            const top = dy * d > r * 0.9;
            let c = rand() > 0.5 ? "#5eb352" : "#4fa04a";
            if (top && rand() > 0.5) c = "#6fbf5c";
            if (rand() > 0.94) c = flowering ? "#fff6e8" : berry;
            bushes.push({ x: x + dx * d, y: (dy + 0.5) * d, z: z + dz * d, color: c, tex: "leaf" });
          }
        }
      }
      colliders.push({ center: [x, 0.6, z], halfExtents: [r * 0.8, 0.6, r * 0.8] });
    } else {
      const mossy = rand() > 0.5;
      const rx = big ? 0.6 : 0.4;
      const rz = big ? 0.5 : 0.35;
      const ry = big ? 0.55 : 0.35;
      const n = 4;
      for (let dx = -n; dx <= n; dx++) {
        for (let dz = -n; dz <= n; dz++) {
          for (let dy = 0; dy <= n; dy++) {
            const e = (dx * d) ** 2 / rx ** 2 + (dy * d) ** 2 / ry ** 2 + (dz * d) ** 2 / rz ** 2;
            if (e > 1 + (rand() - 0.5) * 0.35) continue;
            const top = (dy + 1) * d > ry * 0.8;
            const c = mossy && top && rand() > 0.3 ? "#86b866" : rand() > 0.5 ? "#b1a99e" : "#a0978b";
            rocks.push({ x: x + dx * d, y: (dy + 0.5) * d, z: z + dz * d, color: c, tex: "stone" });
          }
        }
      }
      colliders.push({ center: [x, 0.3, z], halfExtents: [rx + 0.05, 0.3, rz + 0.05] });
    }
  }
  // a few rocks where the stream leaves the hills (its little spring)
  const sp = STREAM[STREAM.length - 2];
  for (const [ox, oz] of [
    [1.5, 0.5],
    [-1.25, -0.75],
  ]) {
    box3(rocks, d, snapD(sp.x + ox), snapD(sp.z + oz), 0.5, 0.5);
  }
  return { plants: dedupe(plants), rocks: dedupe(rocks), bushes: dedupe(bushes), colliders };
}

function box3(out: Voxel[], d: number, x: number, z: number, w: number, h: number) {
  for (let px = x - w / 2 + d / 2; px < x + w / 2; px += d)
    for (let pz = z - w / 2 + d / 2; pz < z + w / 2; pz += d)
      for (let py = d / 2; py < h; py += d) out.push({ x: px, y: py, z: pz, color: "#a0978b", tex: "stone" });
}
