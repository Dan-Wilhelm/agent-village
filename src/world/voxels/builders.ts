/**
 * Procedural voxel builders. Everything in the village is generated here from
 * small cubes — no external models or textures (all art is original).
 *
 * Main structures use 0.5 m voxels (VOXEL); facade details, furniture and
 * plants use 0.25 m voxels (DETAIL) so the world gets finer, hand-made detail
 * without leaving the blocky style.
 */
import {
  BUILDINGS,
  DESK,
  DOOR_HEIGHT,
  DOOR_WIDTH,
  EDGES,
  NODES,
  type BuildingDef,
  type BuildingId,
  type Facing,
} from "../layout";
import { PALETTE } from "../palette";
import type { MeshVoxel, TexName } from "./mesher";

/** Edge length of one structural voxel in meters. */
export const VOXEL = 0.5;
/** Edge length of one detail voxel in meters. */
export const DETAIL = 0.25;
/** Edge length of one fine furniture voxel in meters. */
export const FINE = 0.1;

export type Voxel = MeshVoxel;

/** Axis-aligned box collider: center + half extents (meters). */
export interface BoxCollider {
  center: [number, number, number];
  halfExtents: [number, number, number];
}

/** Deterministic PRNG so the village looks the same on every load. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function key(v: { x: number; y: number; z: number }) {
  return `${v.x.toFixed(3)}|${v.y.toFixed(3)}|${v.z.toFixed(3)}`;
}

/** Removes duplicates (last write wins), so overlapping parts never z-fight. */
export function dedupe(voxels: Voxel[]): Voxel[] {
  const map = new Map<string, Voxel>();
  for (const v of voxels) map.set(key(v), v);
  return [...map.values()];
}

/** Fills an axis-aligned box (in meters, inclusive of the start, exclusive of the end) with voxels of `size`. */
export function box(
  out: Voxel[],
  size: number,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  color: string | ((x: number, y: number, z: number) => string),
  tex?: TexName,
  mat?: MeshVoxel["mat"],
) {
  const eps = 1e-6;
  for (let x = x0 + size / 2; x < x1 - eps; x += size) {
    for (let y = y0 + size / 2; y < y1 - eps; y += size) {
      for (let z = z0 + size / 2; z < z1 - eps; z += size) {
        out.push({ x, y, z, color: typeof color === "function" ? color(x, y, z) : color, tex, mat });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// House styles — every building gets its own personality
// ---------------------------------------------------------------------------

interface HouseStyle {
  wall: string;
  wallAlt: string;
  wallTex: TexName;
  base: string;
  baseTex: TexName;
  baseRows: number;
  beam: string;
  /** Half-timber framing: posts beside windows and a beam band above them. */
  timber: boolean;
  /** Accent pilasters (HQ). */
  pilaster?: string;
  floorA: string;
  floorB: string;
  floorTex: TexName;
  ceiling: string;
  roofA: string;
  roofB: string;
  roofTrim: string;
  ridge: string;
  door: string;
  shutter: string;
  flowers: string[];
  /** Window rows (inclusive) in structural voxels. */
  windowRows: [number, number];
  /** Chimney cell (i, j) on the roof, or null. */
  chimney: [number, number] | null;
}

const STYLES: Record<BuildingId, HouseStyle> = {
  office: {
    wall: "#fff0d8",
    wallAlt: "#fbe6c8",
    wallTex: "plaster",
    base: "#b9ab98",
    baseTex: "stone",
    baseRows: 1,
    beam: "#7a4a2b",
    timber: true,
    floorA: "#cfa77e",
    floorB: "#c29a72",
    floorTex: "plank",
    ceiling: "#f3e3c8",
    roofA: "#e0715d",
    roofB: "#d4644f",
    roofTrim: "#fff6e8",
    ridge: "#a8483a",
    door: "#4f8f6b",
    shutter: "#4f8f6b",
    flowers: ["#ff8fab", "#ffd166", "#ffffff", "#c38bff"],
    windowRows: [2, 4],
    chimney: [4, 5],
  },
  workshop: {
    wall: "#c98d5c",
    wallAlt: "#b97d4f",
    wallTex: "plank",
    base: "#a89c8c",
    baseTex: "stone",
    baseRows: 1,
    beam: "#6b4128",
    timber: false,
    floorA: "#b08a64",
    floorB: "#a37e58",
    floorTex: "plank",
    ceiling: "#9c7048",
    roofA: "#6f97cf",
    roofB: "#6189c2",
    roofTrim: "#f3ead9",
    ridge: "#4b6ea3",
    door: "#e2a33b",
    shutter: "#e2a33b",
    flowers: ["#ffd166", "#ff9f68", "#ffffff"],
    windowRows: [2, 4],
    chimney: [15, 14],
  },
  library: {
    wall: "#e4dccd",
    wallAlt: "#d6ccbb",
    wallTex: "brick",
    base: "#9f978b",
    baseTex: "stone",
    baseRows: 1,
    beam: "#c4b8a4",
    timber: false,
    floorA: "#d9cdb8",
    floorB: "#c9bca5",
    floorTex: "stone",
    ceiling: "#a77a52",
    roofA: "#6dbb8d",
    roofB: "#5fae80",
    roofTrim: "#fff6e8",
    ridge: "#3f8a60",
    door: "#9a5bc4",
    shutter: "#3f8a60",
    flowers: ["#c38bff", "#ff8fab", "#ffffff"],
    windowRows: [2, 5],
    chimney: null,
  },
  hq: {
    wall: "#fff3e2",
    wallAlt: "#f8e8d2",
    wallTex: "plaster",
    base: "#c2b6a6",
    baseTex: "stone",
    baseRows: 2,
    beam: "#f4ead9",
    timber: false,
    pilaster: "#c3adee",
    floorA: "#f8f1fc",
    floorB: "#e6d9f5",
    floorTex: "plain",
    ceiling: "#e9dcf7",
    roofA: "#a283db",
    roofB: "#9474cf",
    roofTrim: "#fff6e8",
    ridge: "#6f52b0",
    door: "#7b5ad0",
    shutter: "#7b5ad0",
    flowers: ["#c38bff", "#ffd166", "#ff8fab", "#ffffff"],
    windowRows: [3, 6],
    chimney: null,
  },
  training: {
    wall: PALETTE.plaster,
    wallAlt: PALETTE.plaster,
    wallTex: "plaster",
    base: PALETTE.stone,
    baseTex: "stone",
    baseRows: 1,
    beam: PALETTE.woodDark,
    timber: false,
    floorA: PALETTE.woodLight,
    floorB: PALETTE.wood,
    floorTex: "plank",
    ceiling: PALETTE.wood,
    roofA: PALETTE.roofGreen,
    roofB: PALETTE.roofGreenDark,
    roofTrim: PALETTE.plaster,
    ridge: PALETTE.roofGreenDark,
    door: PALETTE.wood,
    shutter: PALETTE.wood,
    flowers: [PALETTE.flowerPink],
    windowRows: [2, 4],
    chimney: null,
  },
};

export function houseStyle(id: BuildingId) {
  return STYLES[id];
}

// ---------------------------------------------------------------------------
// House geometry helpers (shared by the shell and the facade details)
// ---------------------------------------------------------------------------

/** Which wall side a perimeter cell is on (corner cells report both). */
function sidesOf(i: number, j: number, nx: number, nz: number): Facing[] {
  const s: Facing[] = [];
  if (j === 0) s.push("north");
  if (j === nz - 1) s.push("south");
  if (i === 0) s.push("west");
  if (i === nx - 1) s.push("east");
  return s;
}

interface HouseGrid {
  nx: number;
  nz: number;
  ny: number;
  ox: number;
  oz: number;
  doorRows: number;
  /** First door cell along the door side. */
  doorStart: number;
  doorCells: number;
}

function grid(def: BuildingDef): HouseGrid {
  const nx = Math.round(def.size.x / VOXEL);
  const nz = Math.round(def.size.z / VOXEL);
  const doorCells = Math.round(DOOR_WIDTH / VOXEL);
  const len = def.door === "north" || def.door === "south" ? nx : nz;
  return {
    nx,
    nz,
    ny: Math.round(def.wallHeight / VOXEL),
    ox: def.center.x - def.size.x / 2,
    oz: def.center.z - def.size.z / 2,
    doorRows: Math.round(DOOR_HEIGHT / VOXEL),
    doorStart: Math.floor((len - doorCells) / 2),
    doorCells,
  };
}

/** Start cells (along the side) of 2-cell-wide windows on one wall. */
export function windowStarts(def: BuildingDef, side: Facing): number[] {
  const g = grid(def);
  const len = side === "north" || side === "south" ? g.nx : g.nz;
  if (side === def.door) return [2, len - 4];
  if (def.id === "hq" && side === "north") return [4, len - 6]; // the middle is the big task-board wall
  if (len >= 24) return [4, 11, 18];
  return [4, len - 6];
}

/** Along-coordinate (cell index) of a perimeter cell on its side. */
function alongOf(side: Facing, i: number, j: number) {
  return side === "north" || side === "south" ? i : j;
}

// ---------------------------------------------------------------------------
// Houses: shell (walls, floor, ceiling, roof) at structural scale
// ---------------------------------------------------------------------------

export function buildHouse(def: BuildingDef): Voxel[] {
  const g = grid(def);
  const { nx, nz, ny, ox, oz, doorRows } = g;
  const st = STYLES[def.id];
  const out: Voxel[] = [];

  const at = (i: number, iy: number, j: number, color: string, tex?: TexName, mat?: Voxel["mat"]): Voxel => ({
    x: ox + (i + 0.5) * VOXEL,
    y: (iy + 0.5) * VOXEL,
    z: oz + (j + 0.5) * VOXEL,
    color,
    tex,
    mat,
  });

  const inDoor = (i: number, j: number, iy: number) => {
    if (iy >= doorRows) return false;
    const onDoorSide = sidesOf(i, j, nx, nz).includes(def.door);
    const along = alongOf(def.door, i, j);
    return onDoorSide && along >= g.doorStart && along < g.doorStart + g.doorCells;
  };
  const windowAt = (side: Facing, along: number, iy: number) => {
    if (iy < st.windowRows[0] || iy > st.windowRows[1]) return false;
    return windowStarts(def, side).some((s) => along >= s && along < s + 2);
  };
  const nearWindow = (side: Facing, along: number) =>
    windowStarts(def, side).some((s) => along === s - 1 || along === s + 2);

  // Floor (one layer below ground level, so it is flush with the terrain)
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const checker = def.id === "hq" ? (i + j) % 2 === 0 : j % 2 === 0;
      out.push(at(i, -1, j, checker ? st.floorA : st.floorB, st.floorTex));
    }
  }

  // Walls
  for (let iy = 0; iy < ny; iy++) {
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const sides = sidesOf(i, j, nx, nz);
        if (sides.length === 0) continue;
        if (inDoor(i, j, iy)) continue;
        const corner = sides.length === 2;
        const side = sides[0];
        const along = alongOf(side, i, j);
        const plank = st.wallTex === "plank";
        let color = plank ? (iy % 2 === 0 ? st.wall : st.wallAlt) : (i * 3 + j * 5 + iy) % 7 === 0 ? st.wallAlt : st.wall;
        let tex: TexName = st.wallTex;
        let mat: Voxel["mat"] = "solid";

        if (iy < st.baseRows) {
          color = (i + j + iy) % 3 === 0 ? shade(st.base, -0.06) : st.base;
          tex = st.baseTex;
        } else if (corner) {
          color = st.pilaster ?? st.beam;
          tex = st.pilaster ? "plain" : def.id === "library" ? "stone" : "plank";
          if (def.id === "library") color = iy % 2 === 0 ? "#f1ebe0" : "#cfc5b4"; // quoins
        } else if (!corner && windowAt(side, along, iy)) {
          color = "#d6ecff";
          tex = "plain";
          mat = "glass";
        } else if (iy === ny - 1) {
          color = def.id === "hq" ? "#a283db" : st.beam;
          tex = def.id === "hq" ? "plain" : def.id === "library" ? "stone" : "plank";
        } else if (def.id === "hq" && iy === ny - 2) {
          color = "#fffaf2"; // cornice band
          tex = "stone";
        } else if (st.timber && (iy === doorRows || nearWindow(side, along))) {
          color = st.beam;
          tex = "plank";
        } else if (def.id === "hq" && nearWindow(side, along) && iy >= st.baseRows) {
          color = st.pilaster!;
          tex = "plain";
        }
        out.push(at(i, iy, j, color, tex, mat));
      }
    }
  }

  // Lintel over the door
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      if (!sidesOf(i, j, nx, nz).includes(def.door)) continue;
      if (inDoor(i, j, 0) && doorRows < ny) out.push(at(i, doorRows, j, st.beam === "#f4ead9" ? "#fffaf2" : st.beam, "plank"));
    }
  }

  // Ceiling (closes the attic so rooms feel cozy; planks visible from below)
  for (let i = 1; i < nx - 1; i++) {
    for (let j = 1; j < nz - 1; j++) out.push(at(i, ny, j, j % 2 === 0 ? st.ceiling : shade(st.ceiling, -0.05), "plank"));
  }

  if (def.id === "hq") buildHqRoof(def, g, st, at, out);
  else buildGableRoof(def, g, st, at, out);

  return dedupe(out);
}

type At = (i: number, iy: number, j: number, color: string, tex?: TexName, mat?: Voxel["mat"]) => Voxel;

function buildGableRoof(def: BuildingDef, g: HouseGrid, st: HouseStyle, at: At, out: Voxel[]) {
  const { nx, nz, ny } = g;
  let top = 0;
  for (let layer = 0; ; layer++) {
    const zMin = -1 + layer;
    const zMax = nz - layer; // inclusive
    if (zMin > zMax) break;
    top = layer;
    const ridge = zMax - zMin <= 1;
    for (let i = -1; i <= nx; i++) {
      for (let j = zMin; j <= zMax; j++) {
        const isEdge = j <= zMin + 1 || j >= zMax - 1;
        if (!isEdge) continue;
        let color = (layer + (i % 4 === 0 ? 1 : 0)) % 2 === 0 ? st.roofA : st.roofB;
        if (layer === 0 && (j === zMin || j === zMax)) color = st.roofTrim; // eave fascia
        if (i === -1 || i === nx) color = layer === 0 ? st.roofTrim : shade(color, -0.12); // gable trim
        if (ridge) color = st.ridge;
        out.push(at(i, ny + layer, j, color, ridge || color === st.roofTrim ? "plain" : "shingle"));
      }
    }
    // Gable end walls (fill the triangle under the roof at both x ends)
    for (const i of [0, nx - 1]) {
      for (let j = zMin + 2; j <= zMax - 2; j++) {
        if (j < 0 || j >= nz) continue;
        const mid = (nz - 1) / 2;
        const attic = layer >= 2 && layer <= 3 && Math.abs(j - mid) <= 0.5;
        if (attic) out.push(at(i, ny + layer, j, "#ffc86b", "plain", "glow"));
        else
          out.push(
            at(
              i,
              ny + layer,
              j,
              st.timber && (Math.abs(j - mid) === 1.5 || layer === 1) ? st.beam : st.wallTex === "plank" ? (layer % 2 ? st.wallAlt : st.wall) : st.wall,
              st.timber && (Math.abs(j - mid) === 1.5 || layer === 1) ? "plank" : st.wallTex,
            ),
          );
      }
    }
  }
  if (st.chimney) {
    const [ci, cj] = st.chimney;
    const rise = Math.min(cj, nz - 1 - cj) + 4;
    for (let iy = ny; iy <= ny + Math.min(rise, top + 2); iy++) {
      for (const di of [0, 1]) {
        for (const dj of [0, 1]) {
          const capRow = iy === ny + Math.min(rise, top + 2);
          out.push(at(ci + di, iy, cj + dj, capRow ? "#8d8378" : (iy + di + dj) % 2 ? "#b8705a" : "#a8604c", capRow ? "stone" : "brick"));
        }
      }
    }
  }
}

function buildHqRoof(def: BuildingDef, g: HouseGrid, st: HouseStyle, at: At, out: Voxel[]) {
  const { nx, nz, ny } = g;
  // Hipped roof (45°, readable from the plaza) that ends in a flat platform for the cupola.
  let layer = 0;
  for (; ; layer++) {
    const inset = -1 + layer;
    const w = nx - 2 * inset;
    const last = w <= 8;
    for (let i = inset; i < nx - inset; i++) {
      for (let j = inset; j < nz - inset; j++) {
        const edge = i <= inset + 1 || i >= nx - inset - 2 || j <= inset + 1 || j >= nz - inset - 2;
        if (!edge && !last) continue;
        const rim = i === inset || i === nx - inset - 1 || j === inset || j === nz - inset - 1;
        const hip = (i - inset === j - inset || i - inset === nz - inset - 1 - j) && rim;
        let color = (layer + ((i + j) % 5 === 0 ? 1 : 0)) % 2 === 0 ? st.roofA : st.roofB;
        if (hip) color = st.ridge;
        if (layer === 0 && rim) color = st.roofTrim;
        if (last && !rim) color = st.ridge;
        out.push(at(i, ny + layer, j, color, color === st.roofTrim ? "plain" : "shingle"));
      }
    }
    if (last) break;
  }

  // Cupola with glowing arches, a pointed cap, a golden finial.
  const c0 = nx / 2 - 2;
  const base = ny + layer + 1;
  for (let iy = base; iy < base + 3; iy++) {
    for (let i = c0; i < c0 + 4; i++) {
      for (let j = c0; j < c0 + 4; j++) {
        const ring = i === c0 || i === c0 + 3 || j === c0 || j === c0 + 3;
        if (!ring) continue;
        const cornerPost = (i === c0 || i === c0 + 3) && (j === c0 || j === c0 + 3);
        if (cornerPost || iy === base + 2) out.push(at(i, iy, j, "#fffaf2", "stone"));
        else out.push(at(i, iy, j, "#ffd27a", "plain", "glow"));
      }
    }
  }
  for (let i = c0 - 1; i < c0 + 5; i++) for (let j = c0 - 1; j < c0 + 5; j++) out.push(at(i, base + 3, j, st.roofTrim, "plain"));
  for (let i = c0; i < c0 + 4; i++) for (let j = c0; j < c0 + 4; j++) out.push(at(i, base + 4, j, st.ridge, "shingle"));
  for (let i = c0 + 1; i < c0 + 3; i++) for (let j = c0 + 1; j < c0 + 3; j++) out.push(at(i, base + 5, j, st.roofA, "shingle"));
}

/** Darkens (negative) or lightens (positive) a hex color by an amount in [−1, 1]. */
export function shade(hex: string, amount: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount)));
  const r = f((n >> 16) & 255);
  const gg = f((n >> 8) & 255);
  const b = f(n & 255);
  return `#${((r << 16) | (gg << 8) | b).toString(16).padStart(6, "0")}`;
}

// ---------------------------------------------------------------------------
// Houses: facade details at DETAIL scale (frames, sills, shutters, flower
// boxes, door frames, open door leaves, lanterns, banners, porch columns)
// ---------------------------------------------------------------------------

export interface HouseExtras {
  detail: Voxel[];
  /** World positions of chimney tops (for smoke). */
  chimneys: Array<[number, number, number]>;
  /** Warm lantern positions (for light glows / fireflies). */
  lanterns: Array<[number, number, number]>;
  colliders: BoxCollider[];
}

export function buildHouseExtras(def: BuildingDef): HouseExtras {
  const g = grid(def);
  const st = STYLES[def.id];
  const out: Voxel[] = [];
  const lanterns: Array<[number, number, number]> = [];
  const colliders: BoxCollider[] = [];
  const minX = def.center.x - def.size.x / 2;
  const maxX = def.center.x + def.size.x / 2;
  const minZ = def.center.z - def.size.z / 2;
  const maxZ = def.center.z + def.size.z / 2;
  const d = DETAIL;

  /**
   * Places a detail voxel on the outside of a wall. `u` = meters along the side
   * (left→right seen from outside), `y` = meters up, `out` = layer index away from the wall (0 = touching).
   */
  const face = (side: Facing, u: number, y: number, o: number, color: string, tex?: TexName, mat?: Voxel["mat"]) => {
    const off = (o + 0.5) * d;
    const cy = y + d / 2;
    switch (side) {
      case "north":
        out.push({ x: maxX - u - d / 2, y: cy, z: minZ - off, color, tex, mat });
        break;
      case "south":
        out.push({ x: minX + u + d / 2, y: cy, z: maxZ + off, color, tex, mat });
        break;
      case "west":
        out.push({ x: minX - off, y: cy, z: minZ + u + d / 2, color, tex, mat });
        break;
      case "east":
        out.push({ x: maxX + off, y: cy, z: maxZ - u - d / 2, color, tex, mat });
        break;
    }
  };
  const sideLen = (side: Facing) => (side === "north" || side === "south" ? def.size.x : def.size.z);
  // Converts a cell index along a side (as used by the shell, measured from min x / min z) to `u` meters.
  const cellToU = (side: Facing, cell: number) => {
    const fromMin = cell * VOXEL;
    return side === "south" || side === "west" ? fromMin : sideLen(side) - fromMin - VOXEL;
  };

  const frame = def.id === "hq" ? "#fffaf2" : def.id === "workshop" ? "#f3ead9" : "#fff8ee";
  const [r0, r1] = st.windowRows;
  for (const side of ["north", "south", "east", "west"] as Facing[]) {
    for (const s of windowStarts(def, side)) {
      // window spans cells s, s+1 → in u meters [u0, u0 + 1)
      const uA = cellToU(side, s);
      const uB = cellToU(side, s + 1);
      const u0 = Math.min(uA, uB);
      const y0 = r0 * VOXEL;
      const y1 = (r1 + 1) * VOXEL;
      // frame: top + sides + mullion cross
      for (let u = u0 - d; u < u0 + 1 + d - 1e-6; u += d) {
        face(side, u, y1, 0, frame, "plain");
        face(side, u, y0 - d, 0, frame, "plain");
        face(side, u, y0 - d, 1, frame, "plain"); // sill sticks out
      }
      for (let y = y0; y < y1 - 1e-6; y += d) {
        face(side, u0 - d, y, 0, frame, "plain");
        face(side, u0 + 1, y, 0, frame, "plain");
      }
      // shutters (not on the HQ, which gets pilasters)
      if (def.id !== "hq") {
        for (let y = y0; y < y1 - 1e-6; y += d) {
          for (const su of [u0 - 3 * d, u0 - 2 * d, u0 + 1 + d, u0 + 1 + 2 * d]) {
            const slat = Math.round((y - y0) / d) % 2 === 0;
            face(side, su, y, 0, slat ? st.shutter : shade(st.shutter, -0.15), "plank");
          }
        }
      }
      // flower box under the window (front and library/office/workshop only)
      if (def.id !== "hq" || side === def.door) {
        for (let u = u0 - d; u < u0 + 1 + d - 1e-6; u += d) {
          face(side, u, y0 - 2 * d, 1, def.id === "hq" ? "#8e6fd8" : "#9a6038", "plank");
          face(side, u, y0 - 2 * d, 2, def.id === "hq" ? "#8e6fd8" : "#9a6038", "plank");
          const idx = Math.round((u - u0) / d);
          face(side, u, y0 - d, 2, idx % 2 === 0 ? st.flowers[(idx / 2 + s) % st.flowers.length | 0] : "#5aa850", "leaf");
          if (idx % 3 === 0) face(side, u, y0, 2, "#6cbf5b", "leaf");
        }
      }
    }
  }

  // Door frame, open door leaves, lantern and a welcome mat
  const side = def.door;
  const len = sideLen(side);
  const du0 = len / 2 - DOOR_WIDTH / 2;
  const du1 = len / 2 + DOOR_WIDTH / 2;
  const dh = DOOR_HEIGHT;
  for (let y = 0; y < dh + 2 * d - 1e-6; y += d) {
    face(side, du0 - d, y, 0, st.beam === "#f4ead9" ? "#fffaf2" : shade(st.beam, 0.1), "plank");
    face(side, du1, y, 0, st.beam === "#f4ead9" ? "#fffaf2" : shade(st.beam, 0.1), "plank");
  }
  for (let u = du0 - 2 * d; u < du1 + 2 * d - 1e-6; u += d) {
    face(side, u, dh, 0, st.beam === "#f4ead9" ? "#fffaf2" : shade(st.beam, 0.1), "plank");
    face(side, u, dh + d, 1, st.roofB, "shingle"); // tiny canopy
    face(side, u, dh + d, 0, st.roofB, "shingle");
    face(side, u, dh + d, 2, st.roofA, "shingle");
  }
  // Leaves swung open flat against the facade, beside the frame
  for (const [from, to] of [
    [du0 - 5 * d, du0 - d],
    [du1 + d, du1 + 5 * d],
  ]) {
    for (let u = from; u < to - 1e-6; u += d) {
      for (let y = 0; y < dh - 1e-6; y += d) {
        const panel = (Math.round((u - from) / d) === 0 || Math.round((u - from) / d) === 3 || Math.round(y / d) % 4 === 0) ? shade(st.door, -0.12) : st.door;
        face(side, u, y, 0, panel, "plank");
      }
    }
  }
  // lantern hanging from a bracket beside the door, above the open leaf
  const lu = du1 + 2 * d;
  face(side, lu, dh, 0, "#3d3530");
  face(side, lu, dh, 1, "#3d3530");
  face(side, lu, dh - d, 1, "#ffcf7a", "plain", "glow");
  face(side, lu, dh - 2 * d, 1, "#3d3530");
  const lp = { x: 0, z: 0 };
  const off = 1.5 * d;
  if (side === "north") Object.assign(lp, { x: maxX - lu - d / 2, z: minZ - off });
  if (side === "south") Object.assign(lp, { x: minX + lu + d / 2, z: maxZ + off });
  if (side === "west") Object.assign(lp, { x: minX - off, z: minZ + lu + d / 2 });
  if (side === "east") Object.assign(lp, { x: maxX + off, z: maxZ - lu - d / 2 });
  lanterns.push([lp.x, dh - 0.5 * d, lp.z]);

  // HQ: porch columns, banners
  if (def.id === "hq") {
    for (const u of [du0 - 3 * d, du1 + 2 * d]) {
      for (let y = 0; y < dh + 2 * d - 1e-6; y += d) {
        const cap = y < d || y >= dh + d - 1e-6;
        for (const o of [2, 3]) face(side, u, y, o, cap ? "#e9e0d2" : "#fffaf2", "stone");
        face(side, u + d, y, 2, cap ? "#e9e0d2" : "#fffaf2", "stone");
        face(side, u + d, y, 3, cap ? "#e9e0d2" : "#fffaf2", "stone");
      }
    }
    for (let u = du0 - 4 * d; u < du1 + 4 * d - 1e-6; u += d) {
      for (const o of [1, 2, 3, 4]) face(side, u, dh + 2 * d, o, o === 4 ? "#fff6e8" : "#9474cf", "shingle");
    }
    // tall banners between the windows
    for (const u of [du0 - 8 * d, du1 + 6 * d]) {
      for (let y = 2 * VOXEL; y < 4.8 - 1e-6; y += d) {
        for (const du of [0, d]) {
          const emblem = y > 3.4 && y < 3.9;
          face(side, u + du, y, 0, emblem ? "#ffd25a" : "#7b5ad0", "cloth");
        }
      }
      face(side, u, 2 * VOXEL - d, 0, "#7b5ad0", "cloth");
    }
    // porch column colliders (the door path stays free between them)
    for (const u of [du0 - 3 * d, du1 + 2 * d]) {
      const cu = u + d; // center of the 2-wide column
      const depth = 3 * d; // center of layers 2..3
      if (side === "south") colliders.push({ center: [minX + cu, 1.5, maxZ + depth], halfExtents: [0.25, 1.5, 0.25] });
    }
  }

  // Flower beds in front of the house (not in the door path)
  const bedColors = st.flowers;
  if (def.id !== "hq") {
    for (const [from, to] of [
      [0.5, du0 - 1.6],
      [du1 + 2, len - 0.5],
    ]) {
      for (let u = from; u < to - 1e-6; u += d) {
        const idx = Math.round(u / d);
        face(side, u, 0, 1, "#8b5a3c", "dirt");
        face(side, u, 0, 2, "#8b5a3c", "dirt");
        face(side, u, 0, 3, "#d9cdb8", "stone"); // little stone edge
        if (idx % 2 === 0) face(side, u, d, 1, bedColors[idx % bedColors.length], "leaf");
        else face(side, u, d, 1, "#5aa850", "leaf");
        if (idx % 3 === 1) face(side, u, d, 2, "#6cbf5b", "leaf");
      }
    }
  }

  // Library: climbing ivy patches
  if (def.id === "library") {
    const rand = mulberry32(42);
    for (const s of ["north", "south", "west"] as Facing[]) {
      for (let k = 0; k < 3; k++) {
        const u0 = 0.4 + rand() * (sideLen(s) - 1.4);
        for (let y = 0; y < 3.6; y += d) {
          const w = Math.max(0, Math.round(3 - y * 0.6 + rand() * 2));
          for (let q = 0; q < w; q++) if (rand() > 0.25) face(s, u0 + q * d, y, 0, rand() > 0.5 ? "#5aa850" : "#4c9444", "leaf");
        }
      }
    }
  }

  // Workshop: awning over the door side + barrels
  if (def.id === "workshop") {
    for (let u = du0 - 4 * d; u < du1 + 4 * d - 1e-6; u += d) {
      for (let o = 0; o < 5; o++) {
        const stripe = Math.floor((u - du0) / (2 * d)) % 2 === 0;
        face(side, u, dh + 2 * d - o * 0.06, o, stripe ? "#f6efe2" : "#e0715d", "cloth");
      }
    }
  }

  const chimneys: Array<[number, number, number]> = [];
  if (st.chimney && def.id !== "hq") {
    const [ci, cj] = st.chimney;
    const rise = Math.min(cj, g.nz - 1 - cj) + 4;
    let top = 0;
    for (let layer = 0; -1 + layer <= g.nz - layer; layer++) top = layer;
    const row = g.ny + Math.min(rise, top + 2);
    chimneys.push([g.ox + (ci + 1) * VOXEL, (row + 1) * VOXEL + 0.1, g.oz + (cj + 1) * VOXEL]);
  }

  return { detail: dedupe(out), chimneys, lanterns, colliders };
}

/** Wall colliders for a house (door gap left open) or a fenced field (gate left open). */
export function buildingColliders(def: BuildingDef): BoxCollider[] {
  const t = VOXEL / 2; // half thickness
  const h = def.kind === "field" ? 0.6 : def.wallHeight / 2;
  const cy = h;
  const minX = def.center.x - def.size.x / 2;
  const maxX = def.center.x + def.size.x / 2;
  const minZ = def.center.z - def.size.z / 2;
  const maxZ = def.center.z + def.size.z / 2;
  const halfDoor = DOOR_WIDTH / 2;
  const cols: BoxCollider[] = [];

  const wallX = (z: number, fromX: number, toX: number) => {
    if (toX - fromX <= 0) return;
    cols.push({ center: [(fromX + toX) / 2, cy, z], halfExtents: [(toX - fromX) / 2, h, t] });
  };
  const wallZ = (x: number, fromZ: number, toZ: number) => {
    if (toZ - fromZ <= 0) return;
    cols.push({ center: [x, cy, (fromZ + toZ) / 2], halfExtents: [t, h, (toZ - fromZ) / 2] });
  };

  const sides: Array<{ side: Facing; run: () => void; gap: () => void }> = [
    {
      side: "north",
      run: () => wallX(minZ + t, minX, maxX),
      gap: () => {
        wallX(minZ + t, minX, def.center.x - halfDoor);
        wallX(minZ + t, def.center.x + halfDoor, maxX);
      },
    },
    {
      side: "south",
      run: () => wallX(maxZ - t, minX, maxX),
      gap: () => {
        wallX(maxZ - t, minX, def.center.x - halfDoor);
        wallX(maxZ - t, def.center.x + halfDoor, maxX);
      },
    },
    {
      side: "west",
      run: () => wallZ(minX + t, minZ, maxZ),
      gap: () => {
        wallZ(minX + t, minZ, def.center.z - halfDoor);
        wallZ(minX + t, def.center.z + halfDoor, maxZ);
      },
    },
    {
      side: "east",
      run: () => wallZ(maxX - t, minZ, maxZ),
      gap: () => {
        wallZ(maxX - t, minZ, def.center.z - halfDoor);
        wallZ(maxX - t, def.center.z + halfDoor, maxZ);
      },
    },
  ];
  for (const s of sides) (s.side === def.door ? s.gap : s.run)();
  return cols;
}

const snap4 = (v: number) => Math.round(v / DETAIL - 0.5) * DETAIL + DETAIL / 2;

// ---------------------------------------------------------------------------
// Training Ground (fenced field) — DETAIL scale
// ---------------------------------------------------------------------------

export function buildField(def: BuildingDef): Voxel[] {
  const out: Voxel[] = [];
  const d = DETAIL;
  const minX = def.center.x - def.size.x / 2;
  const maxX = def.center.x + def.size.x / 2;
  const minZ = def.center.z - def.size.z / 2;
  const maxZ = def.center.z + def.size.z / 2;
  const halfGate = DOOR_WIDTH / 2;
  const rail = "#c99566";
  const post = "#7a4a2b";

  const inGate = (x: number, z: number) => {
    switch (def.door) {
      case "west":
        return Math.abs(x - minX) < 0.3 && Math.abs(z - def.center.z) < halfGate;
      case "east":
        return Math.abs(x - maxX) < 0.3 && Math.abs(z - def.center.z) < halfGate;
      case "north":
        return Math.abs(z - minZ) < 0.3 && Math.abs(x - def.center.x) < halfGate;
      case "south":
        return Math.abs(z - maxZ) < 0.3 && Math.abs(x - def.center.x) < halfGate;
    }
  };

  // Fence: posts every meter, two rails, a pointed post cap. Runs on the inside of the footprint edge.
  const fenceCell = (x: number, z: number, n: number) => {
    if (inGate(x, z)) return;
    const isPost = n % 4 === 0;
    if (isPost) {
      for (let y = 0; y < 5; y++) out.push({ x, y: (y + 0.5) * d, z, color: post, tex: "plank" });
      out.push({ x, y: 5.5 * d, z, color: "#fff6e8" });
    } else {
      out.push({ x, y: 1.5 * d, z, color: rail, tex: "plank" });
      out.push({ x, y: 3.5 * d, z, color: rail, tex: "plank" });
    }
  };
  let n = 0;
  for (let x = minX + d / 2; x < maxX; x += d, n++) {
    fenceCell(x, minZ + d / 2, n);
    fenceCell(x, maxZ - d / 2, n);
  }
  n = 0;
  for (let z = minZ + d / 2; z < maxZ; z += d, n++) {
    fenceCell(minX + d / 2, z, n);
    fenceCell(maxX - d / 2, z, n);
  }
  // Gate posts with little flags
  const gateAxisX = def.door === "west" || def.door === "east";
  const gx = def.door === "west" ? minX + d / 2 : def.door === "east" ? maxX - d / 2 : def.center.x;
  const gz = def.door === "north" ? minZ + d / 2 : def.door === "south" ? maxZ - d / 2 : def.center.z;
  for (const s of [-1, 1]) {
    const px = gateAxisX ? gx : gx + s * (halfGate + d / 2);
    const pz = gateAxisX ? gz + s * (halfGate + d / 2) : gz;
    for (let y = 0; y < 9; y++) out.push({ x: px, y: (y + 0.5) * d, z: pz, color: post, tex: "plank" });
    out.push({ x: px, y: 9.5 * d, z: pz, color: "#ffd25a" });
  }
  // Gate arch beam
  for (let t = -halfGate - d / 2; t <= halfGate + d / 2 + 1e-6; t += d) {
    out.push({ x: gateAxisX ? gx : gx + t, y: 8.5 * d, z: gateAxisX ? gz + t : gz, color: post, tex: "plank" });
  }

  // Training dummies: straw body on a post with a red target face
  const dummy = (x: number, z: number) => {
    for (let y = 0; y < 3; y++) out.push({ x, y: (y + 0.5) * d, z, color: post, tex: "plank" });
    box(out, d, x - d * 1.5, 3 * d, z - d, x + d * 1.5, 7 * d, z + d, (xx, yy) => (Math.abs(yy - 5.5 * d) < 0.01 ? "#c9853f" : "#e8c66a"), "dirt");
    box(out, d, x - d / 2, 7 * d, z - d / 2, x + d / 2, 9 * d, z + d / 2, "#e8c66a", "dirt");
    out.push({ x, y: 5.5 * d, z: z - d * 1.5, color: "#e0715d" });
    out.push({ x: x - d * 2, y: 6.5 * d, z, color: "#e8c66a", tex: "dirt" });
    out.push({ x: x + d * 2, y: 6.5 * d, z, color: "#e8c66a", tex: "dirt" });
  };
  dummy(def.center.x + 1.125, def.center.z - 3.375);
  dummy(def.center.x + 3.125, def.center.z - 3.375);

  // Two posts for the chalkboard (the board itself is a painted surface)
  for (const s of [-1, 1]) {
    const px = def.center.x + 4.375;
    const pz = def.center.z - 0.5 + s * 1.375;
    for (let y = 0; y < 9; y++) out.push({ x: px, y: (y + 0.5) * d, z: snap4(pz), color: post, tex: "plank" });
  }

  // Archery-style target board on an easel
  const tx = def.center.x + 3.875;
  const tz = def.center.z + 2.625;
  for (let y = 0; y < 8; y++) out.push({ x: tx + d, y: (y + 0.5) * d, z: tz - d * 2, color: post, tex: "plank" });
  for (let y = 0; y < 8; y++) out.push({ x: tx + d, y: (y + 0.5) * d, z: tz + d * 2, color: post, tex: "plank" });
  for (let a = -2; a <= 2; a++) {
    for (let b = -2; b <= 2; b++) {
      const r = Math.max(Math.abs(a), Math.abs(b));
      const color = r === 0 ? "#ffd25a" : r === 1 ? "#e0715d" : "#fff6e8";
      out.push({ x: tx, y: (5.5 + b) * d, z: tz + a * d, color });
    }
  }

  // Hay bales (2×1×1 m) with twine bands
  for (const [hx, hz, along] of [
    [def.center.x - 2.5, def.center.z + 3.25, true],
    [def.center.x - 3.0, def.center.z - 3.25, false],
    [def.center.x - 2.25, def.center.z - 3.25, false],
  ] as Array<[number, number, boolean]>) {
    const lx = along ? 1 : 0.5;
    const lz = along ? 0.5 : 1;
    box(out, d, hx - lx / 2, 0, hz - lz / 2, hx + lx / 2, 0.5, hz + lz / 2, (x, _y, z) => {
      const u = along ? x - hx : z - hz;
      return Math.abs(Math.abs(u) - 0.25) < 0.13 ? "#c9a24a" : "#ead07c";
    }, "dirt");
  }
  return dedupe(out);
}

// ---------------------------------------------------------------------------
// Office desk (FINE scale) — a real desk with drawers and a modesty panel
// ---------------------------------------------------------------------------

export function buildDesk(): { voxels: Voxel[]; collider: BoxCollider } {
  const out: Voxel[] = [];
  const f = FINE;
  const x0 = DESK.x - DESK.width / 2;
  const x1 = DESK.x + DESK.width / 2;
  const z0 = DESK.z - DESK.depth / 2; // front (agents' side, north)
  const z1 = DESK.z + DESK.depth / 2; // owner's side (south)
  const top = DESK.height;
  const wood = "#7d5034";
  const woodLight = "#94603d";
  const woodDark = "#5a3720";
  // top slab with a darker edge band
  box(out, f, x0, top - 2 * f, z0, x1, top, z1, (x, y, z) => {
    const edge = x < x0 + f || x > x1 - f || z < z0 + f || z > z1 - f;
    if (y < top - f) return woodDark;
    return edge ? "#b07a4e" : Math.floor((x - x0) / 0.3) % 2 === 0 ? woodLight : shade(woodLight, -0.05);
  }, "plank");
  // pedestals with three drawers each (drawer fronts face the owner, south)
  for (const [px0, px1] of [
    [x0 + f, x0 + 0.8],
    [x1 - 0.8, x1 - f],
  ]) {
    box(out, f, px0, 0, z0 + 2 * f, px1, top - 2 * f, z1 - f, wood, "plank");
    for (let k = 0; k < 3; k++) {
      const ya = 0.08 + k * 0.24;
      box(out, f, px0 + f, ya, z1 - f, px1 - f, ya + 0.2, z1, "#a8744b", "plank");
      out.push({ x: (px0 + px1) / 2, y: ya + 0.15, z: z1 + f / 2, color: "#e8c25a" });
    }
    out.push({ x: px0 + f / 2, y: f / 2, z: z0 + 2.5 * f, color: woodDark });
  }
  // modesty panel facing the visitors (north), with an inset panel trim
  box(out, f, x0 + 0.8, 0.2, z0 + 2 * f, x1 - 0.8, top - 2 * f, z0 + 3 * f, (x, y) => {
    const trim = y < 0.3 || y > top - 0.35 || x < x0 + 0.9 || x > x1 - 0.9;
    return trim ? wood : shade(wood, -0.08);
  }, "plank");
  return {
    voxels: dedupe(out),
    collider: { center: [DESK.x, DESK.height / 2, DESK.z], halfExtents: [DESK.width / 2, DESK.height / 2, DESK.depth / 2] },
  };
}

// ---------------------------------------------------------------------------
// Nature
// ---------------------------------------------------------------------------

export type TreeKind = "oak" | "blossom" | "pine" | "birch" | "autumn";

const TREE_LEAVES: Record<TreeKind, string[]> = {
  oak: ["#5eb352", "#6cbf5b", "#7fcb63", "#4fa04a"],
  blossom: ["#ffc2d4", "#ffb0c8", "#ffd3e0", "#f9a3bf"],
  pine: ["#3f8f5a", "#4a9c63", "#367f50"],
  birch: ["#9bd36a", "#b0dd73", "#8ac85f"],
  autumn: ["#f4a340", "#eb8a3a", "#f7c25a", "#e07a3a"],
};

/** A voxel tree at (x, z) standing on `baseY`. Deterministic per position. */
export function buildTree(x: number, z: number, size: 1 | 2 = 1, kind: TreeKind = "oak", baseY = 0): Voxel[] {
  const out: Voxel[] = [];
  const rand = mulberry32(Math.round(x * 131 + z * 977 + size * 7));
  const leaves = TREE_LEAVES[kind];
  const trunkColor = kind === "birch" ? "#efe9df" : "#8a5a36";
  const pick = () => leaves[Math.floor(rand() * leaves.length)];

  if (kind === "pine") {
    const trunkH = 2;
    for (let y = 0; y < trunkH; y++) out.push({ x, y: baseY + (y + 0.5) * VOXEL, z, color: trunkColor, tex: "bark" });
    const tiers = 3 + size;
    let y = trunkH;
    for (let t = 0; t < tiers; t++) {
      const r = tiers - t + (size === 2 ? 0.5 : 0);
      for (let dy = 0; dy < 2; dy++, y++) {
        const rr = r - dy * 0.8;
        for (let dx = -Math.ceil(rr); dx <= Math.ceil(rr); dx++) {
          for (let dz = -Math.ceil(rr); dz <= Math.ceil(rr); dz++) {
            if (Math.hypot(dx, dz) > rr + 0.2) continue;
            const snowy = dy === 1 && Math.hypot(dx, dz) < 0.9 && t === tiers - 1;
            out.push({ x: x + dx * VOXEL, y: baseY + (y + 0.5) * VOXEL, z: z + dz * VOXEL, color: snowy ? "#5fae6f" : pick(), tex: "leaf" });
          }
        }
      }
    }
    out.push({ x, y: baseY + (y + 0.5) * VOXEL, z, color: leaves[0], tex: "leaf" });
    return out;
  }

  const trunkH = (kind === "birch" ? 4 : 3) + size;
  for (let y = 0; y < trunkH; y++) {
    const mark = kind === "birch" && (y * 3 + Math.round(x)) % 4 === 0;
    out.push({ x, y: baseY + (y + 0.5) * VOXEL, z, color: mark ? "#3d3530" : trunkColor, tex: "bark" });
  }
  // a couple of root/branch stubs
  if (kind !== "birch") {
    out.push({ x: x + VOXEL, y: baseY + 0.25, z, color: trunkColor, tex: "bark" });
    out.push({ x, y: baseY + 0.25, z: z - VOXEL, color: trunkColor, tex: "bark" });
  }
  const r = (kind === "birch" ? 1.2 : 1.6) + size * 0.9;
  const cy = trunkH + r * 0.7;
  const blobs: Array<[number, number, number, number]> = [[0, 0, 0, r]];
  for (let b = 0; b < 3; b++) {
    const a = rand() * Math.PI * 2;
    blobs.push([Math.cos(a) * r * 0.7, (rand() - 0.3) * r * 0.6, Math.sin(a) * r * 0.7, r * (0.55 + rand() * 0.2)]);
  }
  const R = Math.ceil(r * 1.8);
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      for (let dz = -R; dz <= R; dz++) {
        const inside = blobs.some(([bx, by, bz, br]) => Math.hypot(dx - bx, (dy - by) * 1.15, dz - bz) <= br + 0.25);
        if (!inside) continue;
        const yy = cy + dy;
        if (yy < trunkH - 1) continue;
        // lighter on top, darker underneath: fake sky light inside the canopy
        const topness = dy / R;
        let color = pick();
        if (topness > 0.35 && rand() > 0.4) color = shade(leaves[0], 0.12);
        if (topness < -0.3) color = shade(color, kind === "blossom" ? -0.04 : -0.12);
        if (kind === "oak" && rand() > 0.985) color = "#ff6b6b"; // little apples
        out.push({ x: x + dx * VOXEL, y: baseY + (yy + 0.5) * VOXEL, z: z + dz * VOXEL, color, tex: "leaf" });
      }
    }
  }
  return out;
}

/** Shortest distance from (x, z) to segment a→b. */
export function distToSegment(x: number, z: number, a: { x: number; z: number }, b: { x: number; z: number }) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l2 = dx * dx + dz * dz;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
  return Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
}

export function insideAnyBuilding(x: number, z: number, margin = 0) {
  return Object.values(BUILDINGS).some(
    (b) =>
      x > b.center.x - b.size.x / 2 - margin &&
      x < b.center.x + b.size.x / 2 + margin &&
      z > b.center.z - b.size.z / 2 - margin &&
      z < b.center.z + b.size.z / 2 + margin,
  );
}

const NODE_MAP = new Map(NODES.map((n) => [n.id, n]));
const SEGMENTS = EDGES.map(([a, b]) => [NODE_MAP.get(a)!, NODE_MAP.get(b)!] as const);

/** Distance from (x, z) to the nearest walking-graph edge. */
export function pathDistance(x: number, z: number) {
  let best = Infinity;
  for (const [a, b] of SEGMENTS) best = Math.min(best, distToSegment(x, z, a, b));
  return best;
}

/** Half width of the visible footpaths (m). */
export const PATH_HALF_WIDTH = 0.95;

let pathTileCache: Voxel[] | null = null;
/** Ground cells (0.5 m grid) covered by footpaths along every walking-graph edge outside buildings. */
export function buildPathTiles(): Voxel[] {
  if (pathTileCache) return pathTileCache;
  const tiles: Voxel[] = [];
  for (let x = -40 + VOXEL / 2; x < 40; x += VOXEL) {
    for (let z = -40 + VOXEL / 2; z < 40; z += VOXEL) {
      if (insideAnyBuilding(x, z)) continue;
      if (pathDistance(x, z) < PATH_HALF_WIDTH) tiles.push({ x, y: -VOXEL / 2, z, color: PALETTE.path, tex: "dirt" });
    }
  }
  pathTileCache = tiles;
  return tiles;
}

export interface Decorations {
  trees: Voxel[];
  treeColliders: BoxCollider[];
  treeSpots: Array<{ x: number; z: number; kind: TreeKind }>;
}

/** Village trees, placed deterministically and kept off paths, plaza, pond and buildings. */
export function buildDecorations(seed = 7, blocked: (x: number, z: number) => boolean = () => false): Decorations {
  const rand = mulberry32(seed);
  const trees: Voxel[] = [];
  const treeColliders: BoxCollider[] = [];
  const placed: Array<{ x: number; z: number; kind: TreeKind }> = [];
  const kinds: TreeKind[] = ["oak", "oak", "oak", "blossom", "birch", "pine", "autumn", "oak", "blossom"];
  for (let attempt = 0; attempt < 900 && placed.length < 34; attempt++) {
    const x = Math.round(((rand() - 0.5) * 66) / VOXEL) * VOXEL;
    const z = Math.round(((rand() - 0.5) * 66 + 2) / VOXEL) * VOXEL;
    if (Math.hypot(x, z) > 33) continue;
    if (pathDistance(x, z) < 3 || insideAnyBuilding(x, z, 3.5) || Math.hypot(x, z) < 15) continue;
    if (blocked(x, z)) continue;
    if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < 4.8)) continue;
    const kind = kinds[Math.floor(rand() * kinds.length)];
    placed.push({ x, z, kind });
    trees.push(...buildTree(x, z, rand() > 0.55 ? 2 : 1, kind));
    treeColliders.push({ center: [x, 1, z], halfExtents: [0.3, 1, 0.3] });
  }
  return { trees: dedupe(trees), treeColliders, treeSpots: placed };
}
