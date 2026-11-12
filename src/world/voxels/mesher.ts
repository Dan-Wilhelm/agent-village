/**
 * Greedy-free voxel mesher: turns a list of colored cubes into ONE merged
 * BufferGeometry per material bucket. Hidden faces between neighbours are
 * culled, every vertex gets baked ambient occlusion (the classic "corner
 * darkening" that makes voxel art read as solid, cozy blocks) and every voxel
 * gets a tiny deterministic color jitter so large surfaces never look flat.
 *
 * Pure math, no DOM — safe to call in tests and during module evaluation.
 */
import { BufferAttribute, BufferGeometry, Color } from "three";

/** Surface detail tiles in the procedural atlas (see atlas.ts). */
export const TEX = {
  plain: 0,
  plank: 1,
  brick: 2,
  cobble: 3,
  shingle: 4,
  grass: 5,
  leaf: 6,
  plaster: 7,
  bark: 8,
  dirt: 9,
  stone: 10,
  cloth: 11,
} as const;
export type TexName = keyof typeof TEX;
export const TEX_COUNT = 12;

/** Atlas layout shared with atlas.ts: each tile sits in a CELL px cell with a wrapped gutter. */
export const ATLAS_CELL = 32;
export const ATLAS_TILE = 16;
export const ATLAS_COLUMNS = 4;
export const ATLAS_ROWS = Math.ceil(TEX_COUNT / ATLAS_COLUMNS);

/** solid = opaque lit cube, glow = emissive (lanterns, lamp shades), glass = see-through. */
export type VoxelMat = "solid" | "glow" | "glass";

export interface MeshVoxel {
  x: number;
  y: number;
  z: number;
  color: string;
  tex?: TexName;
  mat?: VoxelMat;
}

export interface MeshOptions {
  /** Edge length of each cube (m). */
  size: number;
  /** Max relative brightness jitter per voxel (0.05 = ±5 %). */
  jitter?: number;
  /** Strength of the baked corner AO (0 = none, 1 = strong). */
  ao?: number;
  /** Skip faces pointing down (ground, things that sit on the floor). */
  skipBottom?: boolean;
}

export interface MeshResult {
  solid: BufferGeometry | null;
  glow: BufferGeometry | null;
  glass: BufferGeometry | null;
}

// Face table: normal n, in-plane axes a (u) and b (v) with a × b = n (CCW from outside).
const FACES: Array<{ n: [number, number, number]; a: [number, number, number]; b: [number, number, number] }> = [
  { n: [1, 0, 0], a: [0, 0, -1], b: [0, 1, 0] },
  { n: [-1, 0, 0], a: [0, 0, 1], b: [0, 1, 0] },
  { n: [0, 1, 0], a: [1, 0, 0], b: [0, 0, -1] },
  { n: [0, -1, 0], a: [1, 0, 0], b: [0, 0, 1] },
  { n: [0, 0, 1], a: [1, 0, 0], b: [0, 1, 0] },
  { n: [0, 0, -1], a: [-1, 0, 0], b: [0, 1, 0] },
];
const CORNERS: Array<[number, number]> = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

/** Integer hash → [0, 1). */
export function hash3(x: number, y: number, z: number) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

class Bucket {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  uv: number[] = [];
  idx: number[] = [];
  build(): BufferGeometry | null {
    if (this.idx.length === 0) return null;
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute("normal", new BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute("color", new BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute("uv", new BufferAttribute(new Float32Array(this.uv), 2));
    const count = this.pos.length / 3;
    g.setIndex(new BufferAttribute(count > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

const colorCache = new Map<string, Color>();
function linearColor(hex: string) {
  let c = colorCache.get(hex);
  if (!c) {
    c = new Color(hex); // converted to linear working space by three's color management
    colorCache.set(hex, c);
  }
  return c;
}

export function meshVoxels(voxels: MeshVoxel[], opts: MeshOptions): MeshResult {
  const { size, jitter = 0.04, ao = 1, skipBottom = false } = opts;
  const unit = size / 2; // grid key resolution: half a voxel, so offset lattices still work
  const g = (v: number) => Math.round(v / unit);
  const k = (x: number, y: number, z: number) => `${x},${y},${z}`;

  // occupancy: 1 = opaque (solid/glow), 2 = glass
  const occ = new Map<string, number>();
  for (const v of voxels) occ.set(k(g(v.x), g(v.y), g(v.z)), v.mat === "glass" ? 2 : 1);
  const opaque = (x: number, y: number, z: number) => occ.get(k(x, y, z)) === 1;

  const buckets = { solid: new Bucket(), glow: new Bucket(), glass: new Bucket() };
  const aoCurve = [1 - 0.5 * ao, 1 - 0.32 * ao, 1 - 0.15 * ao, 1];
  const half = size / 2;
  const cellU = ATLAS_CELL / (ATLAS_CELL * ATLAS_COLUMNS);
  const cellV = 1 / ATLAS_ROWS;
  const inset = (ATLAS_CELL - ATLAS_TILE) / 2 / ATLAS_CELL;
  const span = ATLAS_TILE / ATLAS_CELL;

  for (const v of voxels) {
    const gx = g(v.x);
    const gy = g(v.y);
    const gz = g(v.z);
    const mat = v.mat ?? "solid";
    const bucket = buckets[mat];
    const base = linearColor(v.color);
    const j = 1 + (hash3(gx, gy, gz) - 0.5) * 2 * jitter;
    const warm = (hash3(gz, gx, gy) - 0.5) * jitter * 0.6; // tiny hue drift
    const r = base.r * j * (1 + warm);
    const gg = base.g * j;
    const b = base.b * j * (1 - warm);
    const tex = TEX[v.tex ?? "plain"];
    const u0 = (tex % ATLAS_COLUMNS) * cellU + inset * cellU;
    const v0 = 1 - (Math.floor(tex / ATLAS_COLUMNS) + 1) * cellV + inset * cellV;

    for (let f = 0; f < 6; f++) {
      const { n, a, b: bAxis } = FACES[f];
      if (skipBottom && n[1] === -1) continue;
      const nx = gx + n[0] * 2;
      const ny = gy + n[1] * 2;
      const nz = gz + n[2] * 2;
      const neighbour = occ.get(k(nx, ny, nz));
      if (neighbour === 1) continue;
      if (neighbour === 2 && mat === "glass") continue;

      const start = bucket.pos.length / 3;
      const aos: number[] = [];
      for (const [su, sv] of CORNERS) {
        let level = 3;
        if (mat === "solid" && ao > 0) {
          const s1 = opaque(nx + a[0] * su * 2, ny + a[1] * su * 2, nz + a[2] * su * 2) ? 1 : 0;
          const s2 = opaque(nx + bAxis[0] * sv * 2, ny + bAxis[1] * sv * 2, nz + bAxis[2] * sv * 2) ? 1 : 0;
          const c = opaque(
            nx + (a[0] * su + bAxis[0] * sv) * 2,
            ny + (a[1] * su + bAxis[1] * sv) * 2,
            nz + (a[2] * su + bAxis[2] * sv) * 2,
          )
            ? 1
            : 0;
          level = s1 && s2 ? 0 : 3 - s1 - s2 - c;
        }
        aos.push(level);
        const shade = aoCurve[level];
        bucket.pos.push(
          v.x + (n[0] + a[0] * su + bAxis[0] * sv) * half,
          v.y + (n[1] + a[1] * su + bAxis[1] * sv) * half,
          v.z + (n[2] + a[2] * su + bAxis[2] * sv) * half,
        );
        bucket.nor.push(n[0], n[1], n[2]);
        bucket.col.push(r * shade, gg * shade, b * shade);
        bucket.uv.push(u0 + ((su + 1) / 2) * span * cellU, v0 + ((sv + 1) / 2) * span * cellV);
      }
      // flip the quad diagonal so AO gradients interpolate without seams
      if (aos[0] + aos[2] < aos[1] + aos[3]) {
        bucket.idx.push(start + 1, start + 2, start + 3, start + 1, start + 3, start);
      } else {
        bucket.idx.push(start, start + 1, start + 2, start, start + 2, start + 3);
      }
    }
  }

  return { solid: buckets.solid.build(), glow: buckets.glow.build(), glass: buckets.glass.build() };
}
