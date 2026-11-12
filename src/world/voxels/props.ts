/**
 * Outdoor props: lamp posts, benches, the fountain, the big blossom tree,
 * a mailbox, a signpost, the footbridge and pier, workshop clutter and a
 * little vegetable garden. All DETAIL scale (0.25 m) unless noted.
 */
import { BUILDINGS } from "../layout";
import {
  DETAIL,
  VOXEL,
  box,
  buildTree,
  dedupe,
  insideAnyBuilding,
  pathDistance,
  shade,
  type BoxCollider,
  type Voxel,
} from "./builders";
import { BIG_TREE, BRIDGE, DOCK, FOUNTAIN, PLAZA_RADIUS } from "./terrain";

const d = DETAIL;
const IRON = "#3d3530";
const WOOD = "#a8683f";
const WOOD_DARK = "#6e3f22";

export interface Props {
  detail: Voxel[];
  /** Fountain water surface discs, for the animated water material. */
  big: Voxel[];
  lamps: Array<[number, number, number]>;
  colliders: BoxCollider[];
}

/** Snap to the DETAIL lattice (centers at odd multiples of d/2). */
const snap = (v: number) => Math.round(v / d - 0.5) * d + d / 2;

function lampPost(out: Voxel[], lamps: Props["lamps"], cols: BoxCollider[], x0: number, z0: number) {
  const x = snap(x0);
  const z = snap(z0);
  box(out, d, x - d, 0, z - d, x + d, d, z + d, "#b9ad9c", "stone");
  for (let y = 1; y < 10; y++) out.push({ x, y: (y + 0.5) * d, z, color: IRON });
  // lantern: iron cap, glowing glass, iron base
  box(out, d, x - d, 10 * d, z - d, x + d, 11 * d, z + d, IRON);
  box(out, d, x - d, 11 * d, z - d, x + d, 13 * d, z + d, "#ffd27a", "plain", "glow");
  box(out, d, x - d * 1.5 + d / 2, 13 * d, z - d * 1.5 + d / 2, x + d * 1.5 - d / 2, 14 * d, z + d * 1.5 - d / 2, IRON);
  out.push({ x, y: 14.5 * d, z, color: IRON });
  lamps.push([x, 12 * d, z]);
  cols.push({ center: [x, 1.6, z], halfExtents: [0.2, 1.6, 0.2] });
}

/** Bench along x (alongX) or z, facing +facing direction (sign). */
function bench(out: Voxel[], cols: BoxCollider[], cx: number, cz: number, alongX: boolean, facing: 1 | -1) {
  const len = 6; // 1.5 m
  for (let k = 0; k < len; k++) {
    const t = (k - (len - 1) / 2) * d;
    const bx = snap(cx + (alongX ? t : 0));
    const bz = snap(cz + (alongX ? 0 : t));
    const back = (o: number) => ({ x: alongX ? bx : bx - facing * o, z: alongX ? bz - facing * o : bz });
    const legs = k === 0 || k === len - 1;
    if (legs) {
      out.push({ x: bx, y: d / 2, z: bz, color: IRON });
      const b = back(d);
      out.push({ x: b.x, y: d / 2, z: b.z, color: IRON });
    }
    // seat (2 deep) and backrest
    out.push({ x: bx, y: 1.5 * d, z: bz, color: WOOD, tex: "plank" });
    const s = back(d);
    out.push({ x: s.x, y: 1.5 * d, z: s.z, color: shade(WOOD, -0.06), tex: "plank" });
    const br = back(2 * d);
    out.push({ x: br.x, y: 2.5 * d, z: br.z, color: WOOD, tex: "plank" });
    out.push({ x: br.x, y: 3.5 * d, z: br.z, color: shade(WOOD, -0.06), tex: "plank" });
    if (legs) out.push({ x: br.x, y: 1.5 * d, z: br.z, color: IRON });
  }
  cols.push({
    center: [cx, 0.45, cz],
    halfExtents: alongX ? [0.8, 0.45, 0.4] : [0.4, 0.45, 0.8],
  });
}

function fountain(out: Voxel[], big: Voxel[], cols: BoxCollider[]) {
  const { x: fx, z: fz } = FOUNTAIN;
  // round basin rim (DETAIL), water disc and a tiered column
  for (let x = fx - 2.25 + d / 2; x < fx + 2.25; x += d) {
    for (let z = fz - 2.25 + d / 2; z < fz + 2.25; z += d) {
      const r = Math.hypot(x - fx, z - fz);
      if (r > 2.1) continue;
      if (r > 1.7) {
        for (let y = 0; y < 3; y++) out.push({ x, y: (y + 0.5) * d, z, color: y === 2 ? "#efe7da" : "#d6cbbb", tex: "stone" });
      } else {
        out.push({ x, y: d / 2, z, color: "#9fc7c4", tex: "stone" }); // basin floor
      }
    }
  }
  // central column with a round middle bowl, a slimmer upper column and a small top bowl
  const cx = fx - d / 2;
  const cz = fz - d / 2;
  box(out, d, cx - d / 2, d, cz - d / 2, cx + 1.5 * d, 6 * d, cz + 1.5 * d, "#e4dacb", "stone");
  for (let x = fx - 1 + d / 2; x < fx + 1; x += d) {
    for (let z = fz - 1 + d / 2; z < fz + 1; z += d) {
      const r = Math.hypot(x - fx, z - fz);
      if (r > 0.72) continue;
      if (r > 0.45) {
        out.push({ x, y: 6.5 * d, z, color: "#efe7da", tex: "stone" });
        out.push({ x, y: 7.5 * d, z, color: "#f5efe6", tex: "stone" });
      } else if (r > 0.2) out.push({ x, y: 6.5 * d, z, color: "#8fd0e6", tex: "plain" });
    }
  }
  box(out, d, cx - d / 2, 8 * d, cz - d / 2, cx + 1.5 * d, 10 * d, cz + 1.5 * d, "#e4dacb", "stone");
  for (let x = fx - 0.5 + d / 2; x < fx + 0.5; x += d) {
    for (let z = fz - 0.5 + d / 2; z < fz + 0.5; z += d) {
      if (Math.hypot(x - fx, z - fz) > 0.55) continue;
      out.push({ x, y: 10.5 * d, z, color: "#f5efe6", tex: "stone" });
    }
  }
  out.push({ x: cx, y: 11.5 * d, z: cz, color: "#ffd25a" });
  out.push({ x: cx + d, y: 11.5 * d, z: cz, color: "#ffd25a" });
  out.push({ x: cx, y: 11.5 * d, z: cz + d, color: "#ffd25a" });
  out.push({ x: cx + d, y: 11.5 * d, z: cz + d, color: "#ffd25a" });
  // the water surface (animated material in Scene) — VOXEL-scale flat cells are not used; see WaterDiscs
  big.push({ x: fx, y: 0.42, z: fz, color: "#7fc8e0" });
  cols.push({ center: [fx, 0.45, fz], halfExtents: [1.7, 0.45, 1.7] });
}

function bigTree(out: Voxel[], cols: BoxCollider[]) {
  const { x, z } = BIG_TREE;
  // raised round planter with a stone rim
  for (let px = x - 1.75 + d / 2; px < x + 1.75; px += d) {
    for (let pz = z - 1.75 + d / 2; pz < z + 1.75; pz += d) {
      const r = Math.hypot(px - x, pz - z);
      if (r > 1.7) continue;
      if (r > 1.35) {
        out.push({ x: px, y: d / 2, z: pz, color: "#d6cbbb", tex: "stone" });
        out.push({ x: px, y: 1.5 * d, z: pz, color: "#efe7da", tex: "stone" });
      } else {
        out.push({ x: px, y: d / 2, z: pz, color: "#7a5a3c", tex: "dirt" });
        out.push({ x: px, y: 1.5 * d, z: pz, color: r < 0.6 ? "#7a5a3c" : "#6fbf5c", tex: r < 0.6 ? "dirt" : "grass" });
        if (r > 0.7 && (Math.round(px * 8) + Math.round(pz * 4)) % 5 === 0)
          out.push({ x: px, y: 2.5 * d, z: pz, color: ["#ff8fab", "#ffd166", "#ffffff"][Math.abs(Math.round(px * 4)) % 3] });
      }
    }
  }
  cols.push({ center: [x, 0.5, z], halfExtents: [1.3, 0.5, 1.3] });
}

function mailbox(out: Voxel[], cols: BoxCollider[], x0: number, z0: number) {
  const x = snap(x0);
  const z = snap(z0);
  for (let y = 0; y < 4; y++) out.push({ x, y: (y + 0.5) * d, z, color: WOOD_DARK, tex: "plank" });
  box(out, d, x - d, 4 * d, z - d * 1.5 + d / 2, x + d, 6 * d, z + d * 1.5 + d / 2, "#e0715d");
  box(out, d, x - d, 6 * d, z - d / 2, x + d, 7 * d, z + d / 2 + d, "#c95f53");
  out.push({ x: x + d * 1.5, y: 6.5 * d, z: z - d, color: "#ffd25a" }); // little flag
  out.push({ x: x + d * 1.5, y: 7.5 * d, z: z - d, color: "#ffd25a" });
  cols.push({ center: [x, 0.8, z], halfExtents: [0.3, 0.8, 0.35] });
}

/** Signpost with color-coded arrow boards pointing to each building. */
function signpost(out: Voxel[], cols: BoxCollider[], x0: number, z0: number) {
  const x = snap(x0);
  const z = snap(z0);
  for (let y = 0; y < 11; y++) out.push({ x, y: (y + 0.5) * d, z, color: WOOD_DARK, tex: "plank" });
  out.push({ x, y: 11.5 * d, z, color: "#fff6e8" });
  const arrows: Array<{ dx: number; dz: number; color: string; y: number }> = [
    { dx: 0, dz: -1, color: "#a283db", y: 9.5 }, // HQ (north)
    { dx: 1, dz: 0, color: "#6f97cf", y: 8.5 }, // workshop (east)
    { dx: -1, dz: 0, color: "#6dbb8d", y: 7.5 }, // library (west)
    { dx: 0, dz: 1, color: "#e0715d", y: 6.5 }, // office (south)
  ];
  for (const a of arrows) {
    for (let k = 1; k <= 4; k++) {
      const tip = k === 4;
      out.push({ x: x + a.dx * k * d, y: a.y * d, z: z + a.dz * k * d, color: tip ? shade(a.color, -0.15) : a.color, tex: "plank" });
      if (!tip) {
        // boards are two voxels tall, except for the pointed tip
        out.push({ x: x + a.dx * k * d + (a.dz !== 0 ? d : 0), y: a.y * d, z: z + a.dz * k * d + (a.dx !== 0 ? d : 0), color: a.color, tex: "plank" });
      }
    }
  }
  cols.push({ center: [x, 1.4, z], halfExtents: [0.15, 1.4, 0.15] });
}

function footbridge(out: Voxel[]) {
  const { x, z, halfX, halfZ } = BRIDGE;
  for (let px = x - halfX + d / 2; px < x + halfX; px += d) {
    const t = Math.abs(px - x) / halfX;
    const lift = t < 0.35 ? 1 : 0; // gentle hump in the middle
    for (let pz = z - halfZ + d / 2; pz < z + halfZ; pz += d) {
      const plank = Math.round((px - x) / d) % 2 === 0 ? WOOD : shade(WOOD, -0.08);
      out.push({ x: px, y: (lift + 0.5) * d - d * 0.6, z: pz, color: plank, tex: "plank" });
      if (lift) out.push({ x: px, y: -0.5 * d - d * 0.6 + d, z: pz, color: WOOD_DARK, tex: "plank" });
    }
    // railings on both sides
    for (const pz of [z - halfZ - d / 2, z + halfZ + d / 2]) {
      const post = Math.round((px - x + halfX) / d) % 4 === 0;
      if (post) for (let y = 0; y < 4; y++) out.push({ x: px, y: (lift + y + 0.5) * d - d * 0.6, z: pz, color: WOOD_DARK, tex: "plank" });
      out.push({ x: px, y: (lift + 3.5) * d - d * 0.6, z: pz, color: WOOD, tex: "plank" });
    }
  }
}

function pier(out: Voxel[]) {
  const { x, z, halfX, halfZ } = DOCK;
  for (let px = x - halfX + d / 2; px < x + halfX; px += d) {
    for (let pz = z - halfZ + d / 2; pz < z + halfZ; pz += d) {
      const k = Math.round((pz - z) / d);
      out.push({ x: px, y: -d / 2 + 0.02, z: pz, color: k % 2 ? WOOD : shade(WOOD, -0.08), tex: "plank" });
    }
  }
  for (const px of [x - halfX - d / 2, x + halfX + d / 2]) {
    for (const pz of [z - halfZ + d / 2, z, z + halfZ - d / 2]) {
      for (let y = -3; y < 2; y++) out.push({ x: px, y: (y + 0.5) * d, z: pz, color: WOOD_DARK, tex: "plank" });
    }
  }
}

/** Crates, barrels, a log pile and a sawhorse by the workshop. */
function workshopYard(out: Voxel[], cols: BoxCollider[]) {
  const w = BUILDINGS.workshop;
  const x0 = w.center.x - w.size.x / 2 - 0.5;
  for (const [cz, kind] of [
    [w.center.z - 4.0, "barrel"],
    [w.center.z - 3.25, "crate"],
    [w.center.z + 3.4, "logs"],
  ] as Array<[number, string]>) {
    const cx = snap(x0 - 0.35);
    const z = snap(cz);
    if (kind === "barrel") {
      for (let y = 0; y < 4; y++) {
        for (let a = -1; a <= 1; a++) {
          for (let b = -1; b <= 1; b++) {
            if (Math.abs(a) + Math.abs(b) === 2 && (y === 0 || y === 3)) continue;
            out.push({ x: cx + a * d, y: (y + 0.5) * d, z: z + b * d, color: y === 1 || y === 2 ? (Math.abs(a) + Math.abs(b) === 2 ? "#8a5a36" : "#a8683f") : IRON, tex: "plank" });
          }
        }
      }
      cols.push({ center: [cx, 0.5, z], halfExtents: [0.4, 0.5, 0.4] });
    } else if (kind === "crate") {
      box(out, d, cx - 1.5 * d + d / 2 - d / 2, 0, z - d, cx + d, 3 * d, z + 2 * d, (x, y, zz) => {
        const edge = [x, y, zz].filter((v, i) => {
          const lo = [cx - d, 0, z - d][i];
          const hi = [cx + d, 3 * d, z + 2 * d][i];
          return Math.abs(v - lo - d / 2) < 1e-6 || Math.abs(v - hi + d / 2) < 1e-6;
        }).length >= 2;
        return edge ? "#8a5a36" : "#d9a066";
      }, "plank");
      cols.push({ center: [cx, 0.4, z + d / 2], halfExtents: [0.4, 0.4, 0.45] });
    } else {
      for (let row = 0; row < 3; row++) {
        for (let k = 0; k < 3 - row; k++) {
          const lz = z + (k - (2 - row) / 2) * 2 * d;
          for (let lx = -2; lx <= 2; lx++) {
            const end = Math.abs(lx) === 2;
            out.push({ x: cx + lx * d, y: (row + 0.5) * d * 1.0 + row * 0.0, z: snap(lz), color: end ? "#e9c99a" : "#8a5a36", tex: end ? "plain" : "bark" });
          }
        }
      }
      cols.push({ center: [cx, 0.4, z], halfExtents: [0.65, 0.4, 0.5] });
    }
  }
}

/** A small fenced vegetable garden west of the office. */
function garden(out: Voxel[], cols: BoxCollider[]) {
  const x0 = -12.5;
  const x1 = -7.5;
  const z0 = 19.5;
  const z1 = 24.5;
  for (let x = x0 + d / 2; x < x1; x += d) {
    for (let z = z0 + d / 2; z < z1; z += d) {
      const border = x < x0 + d || x > x1 - d || z < z0 + d || z > z1 - d;
      if (border) {
        const k = Math.round((x - x0) / d) + Math.round((z - z0) / d);
        const gate = Math.abs(z - (z0 + z1) / 2) < 0.4 && x > x1 - d;
        if (gate) continue;
        if (k % 2 === 0) {
          for (let y = 0; y < 3; y++) out.push({ x, y: (y + 0.5) * d, z, color: "#fff8ee", tex: "plank" });
        } else out.push({ x, y: 1.5 * d, z, color: "#f3ead9", tex: "plank" });
        continue;
      }
      const row = Math.floor((z - z0) / (3 * d));
      const soil = row % 2 === 0;
      out.push({ x, y: -d / 2 + 0.03, z, color: soil ? "#7a5a3c" : "#a07c55", tex: "dirt" });
      if (soil && Math.round((x - x0) / d) % 3 === 1) {
        const crop = [
          ["#ff9f43", "#5aa850"], // carrots
          ["#7fcb63", "#5aa850"], // cabbages
          ["#e0475b", "#5aa850"], // tomatoes
          ["#f7c25a", "#5aa850"], // pumpkins
        ][row / 2 % 4 | 0];
        out.push({ x, y: d / 2, z, color: crop[0] });
        out.push({ x, y: 1.5 * d, z, color: crop[1], tex: "leaf" });
      }
    }
  }
  // scarecrow
  const sx = snap((x0 + x1) / 2);
  const sz = snap(z0 + 1.1);
  for (let y = 0; y < 7; y++) out.push({ x: sx, y: (y + 0.5) * d, z: sz, color: WOOD_DARK, tex: "plank" });
  for (let k = -2; k <= 2; k++) out.push({ x: sx + k * d, y: 5.5 * d, z: sz, color: "#6f97cf", tex: "cloth" });
  box(out, d, sx - d, 7 * d, sz - d, sx + d, 9 * d, sz + d, "#ead07c", "dirt");
  box(out, d, sx - 1.5 * d - d / 2 + d / 2, 9 * d, sz - 1.5 * d + d / 2 - d / 2, sx + 1.5 * d, 10 * d, sz + 1.5 * d, "#c9853f", "cloth");
  cols.push({ center: [(x0 + x1) / 2, 0.5, z0 + d / 2], halfExtents: [(x1 - x0) / 2, 0.5, d / 2] });
  cols.push({ center: [(x0 + x1) / 2, 0.5, z1 - d / 2], halfExtents: [(x1 - x0) / 2, 0.5, d / 2] });
  cols.push({ center: [x0 + d / 2, 0.5, (z0 + z1) / 2], halfExtents: [d / 2, 0.5, (z1 - z0) / 2] });
}

export const GARDEN_AREA = { minX: -13, maxX: -7, minZ: 19, maxZ: 25 };

export function buildProps(): Props {
  const out: Voxel[] = [];
  const big: Voxel[] = [];
  const lamps: Props["lamps"] = [];
  const cols: BoxCollider[] = [];

  // Lamp posts around the plaza edge, between the radiating paths
  for (let k = 0; k < 16; k++) {
    const a = ((k + 0.5) / 16) * Math.PI * 2;
    const r = PLAZA_RADIUS - 0.45;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (pathDistance(x, z) < 1.4 || insideAnyBuilding(x, z, 0.5)) continue;
    if (k % 2 === 1) continue;
    lampPost(out, lamps, cols, x, z);
  }
  // Lamp posts along the longer paths
  for (const [x, z] of [
    [-2.1, 15.9],
    [-12.2, 6.2],
    [12.4, 1.6],
    [9.0, -14.6],
    [-16.2, -10.4],
  ]) {
    if (pathDistance(x, z) > 1.1) lampPost(out, lamps, cols, x, z);
  }

  // Benches: around the fountain and the big tree, facing them
  bench(out, cols, FOUNTAIN.x, FOUNTAIN.z + 2.9, true, -1);
  bench(out, cols, FOUNTAIN.x - 2.9, FOUNTAIN.z, false, 1);
  bench(out, cols, BIG_TREE.x, BIG_TREE.z + 2.4, true, -1);
  bench(out, cols, BIG_TREE.x + 2.4, BIG_TREE.z, false, -1);
  // by the pond
  bench(out, cols, -12.25, -12.5, false, -1);

  fountain(out, big, cols);
  bigTree(out, cols);
  mailbox(out, cols, 2.6, 15.6);
  signpost(out, cols, -2.6, 12.9);
  footbridge(out);
  pier(out);
  workshopYard(out, cols);
  garden(out, cols);

  return { detail: dedupe(out), big, lamps, colliders: cols };
}

/** The grand blossom tree on the plaza (VOXEL scale). */
export function buildBigTree(): Voxel[] {
  return buildTree(BIG_TREE.x - VOXEL / 2, BIG_TREE.z - VOXEL / 2, 2, "blossom", 0.5);
}
