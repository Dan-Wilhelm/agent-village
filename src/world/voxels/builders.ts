/**
 * Procedural voxel builders. Everything in the village is generated here from
 * small cubes — no external models or textures (all art is original).
 */
import {
  BUILDINGS,
  DESK,
  DOOR_HEIGHT,
  DOOR_WIDTH,
  EDGES,
  NODES,
  type BuildingDef,
  type Facing,
} from "../layout";
import { PALETTE } from "../palette";

/** Edge length of one voxel in meters. */
export const VOXEL = 0.5;

export interface Voxel {
  x: number;
  y: number;
  z: number;
  color: string;
}

/** Axis-aligned box collider: center + half extents (meters). */
export interface BoxCollider {
  center: [number, number, number];
  halfExtents: [number, number, number];
}

const ROOF_COLORS: Record<BuildingDef["roof"], [string, string]> = {
  red: [PALETTE.roofRed, PALETTE.roofRedDark],
  blue: [PALETTE.roofBlue, PALETTE.roofBlueDark],
  green: [PALETTE.roofGreen, PALETTE.roofGreenDark],
  purple: [PALETTE.roofPurple, PALETTE.roofPurpleDark],
};

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
  return `${v.x.toFixed(2)}|${v.y.toFixed(2)}|${v.z.toFixed(2)}`;
}

/** Removes duplicates (last write wins), so overlapping parts never z-fight. */
export function dedupe(voxels: Voxel[]): Voxel[] {
  const map = new Map<string, Voxel>();
  for (const v of voxels) map.set(key(v), v);
  return [...map.values()];
}

// ---------------------------------------------------------------------------
// Houses
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

export function buildHouse(def: BuildingDef): Voxel[] {
  const nx = Math.round(def.size.x / VOXEL);
  const nz = Math.round(def.size.z / VOXEL);
  const ny = Math.round(def.wallHeight / VOXEL);
  const ox = def.center.x - def.size.x / 2;
  const oz = def.center.z - def.size.z / 2;
  const doorCells = Math.round(DOOR_WIDTH / VOXEL);
  const doorRows = Math.round(DOOR_HEIGHT / VOXEL);
  const [roofA, roofB] = ROOF_COLORS[def.roof];
  const out: Voxel[] = [];

  const world = (i: number, iy: number, j: number, color: string): Voxel => ({
    x: ox + (i + 0.5) * VOXEL,
    y: (iy + 0.5) * VOXEL,
    z: oz + (j + 0.5) * VOXEL,
    color,
  });

  const inDoor = (i: number, j: number, iy: number) => {
    if (iy >= doorRows) return false;
    const along = def.door === "north" || def.door === "south" ? i : j;
    const len = def.door === "north" || def.door === "south" ? nx : nz;
    const start = Math.floor((len - doorCells) / 2);
    const onDoorSide = sidesOf(i, j, nx, nz).includes(def.door);
    return onDoorSide && along >= start && along < start + doorCells;
  };

  // Walls
  for (let iy = 0; iy < ny; iy++) {
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const sides = sidesOf(i, j, nx, nz);
        if (sides.length === 0) continue;
        if (inDoor(i, j, iy)) continue;
        const corner = sides.length === 2;
        const along = sides[0] === "north" || sides[0] === "south" ? i : j;
        let color: string = def.id === "hq" ? PALETTE.plasterWarm : PALETTE.plaster;
        if (iy === 0) color = PALETTE.stone;
        else if (corner || iy === ny - 1) color = PALETTE.woodDark;
        else if (iy >= 2 && iy <= 3 && along % 5 >= 2 && along % 5 <= 3) color = PALETTE.glass;
        out.push(world(i, iy, j, color));
      }
    }
  }

  // Door frame (lintel + posts) for a cozy look
  const frameRow = doorRows;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      if (!sidesOf(i, j, nx, nz).includes(def.door)) continue;
      if (inDoor(i, j, 0) && frameRow < ny) out.push(world(i, frameRow, j, PALETTE.wood));
    }
  }

  // Roof
  if (def.id === "hq") {
    // Hipped, stepped pyramid roof with a little lantern on top.
    let layer = 0;
    for (let inset = -1; nx - 2 * inset > 0 && nz - 2 * inset > 0; inset++, layer++) {
      const color = layer % 2 === 0 ? roofA : roofB;
      for (let i = inset; i < nx - inset; i++) {
        for (let j = inset; j < nz - inset; j++) {
          const edge = i <= inset + 1 || i >= nx - inset - 2 || j <= inset + 1 || j >= nz - inset - 2;
          const top = nx - 2 * (inset + 1) <= 0 || nz - 2 * (inset + 1) <= 0;
          if (edge || top) out.push(world(i, ny + layer, j, color));
        }
      }
    }
    const cx = Math.floor(nx / 2);
    const cz = Math.floor(nz / 2);
    out.push(world(cx, ny + layer, cz, PALETTE.lantern));
    out.push(world(cx - 1, ny + layer, cz, PALETTE.lantern));
    out.push(world(cx, ny + layer, cz - 1, PALETTE.lantern));
    out.push(world(cx - 1, ny + layer, cz - 1, PALETTE.lantern));
  } else {
    // Gable roof, ridge along x, overhang of one voxel; two rows per step = closed staircase.
    for (let layer = 0; ; layer++) {
      const zMin = -1 + layer;
      const zMax = nz - layer; // inclusive
      if (zMin > zMax) break;
      const color = layer % 2 === 0 ? roofA : roofB;
      for (let i = -1; i <= nx; i++) {
        for (let j = zMin; j <= zMax; j++) {
          const isEdge = j <= zMin + 1 || j >= zMax - 1;
          if (isEdge) out.push(world(i, ny + layer, j, color));
        }
      }
      // Gable end walls (fill the triangle under the roof at both x ends)
      for (const i of [0, nx - 1]) {
        for (let j = zMin + 2; j <= zMax - 2; j++) {
          if (j >= 0 && j < nz) out.push(world(i, ny + layer, j, PALETTE.plaster));
        }
      }
    }
  }

  return dedupe(out);
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

// ---------------------------------------------------------------------------
// Training Ground (fenced field)
// ---------------------------------------------------------------------------

export function buildField(def: BuildingDef): Voxel[] {
  const out: Voxel[] = [];
  const minX = def.center.x - def.size.x / 2;
  const maxX = def.center.x + def.size.x / 2;
  const minZ = def.center.z - def.size.z / 2;
  const maxZ = def.center.z + def.size.z / 2;
  const halfGate = DOOR_WIDTH / 2;

  const inGate = (x: number, z: number) => {
    switch (def.door) {
      case "west":
        return Math.abs(x - minX) < 0.01 && Math.abs(z - def.center.z) < halfGate;
      case "east":
        return Math.abs(x - maxX) < 0.01 && Math.abs(z - def.center.z) < halfGate;
      case "north":
        return Math.abs(z - minZ) < 0.01 && Math.abs(x - def.center.x) < halfGate;
      case "south":
        return Math.abs(z - maxZ) < 0.01 && Math.abs(x - def.center.x) < halfGate;
    }
  };

  const fenceAt = (x: number, z: number, post: boolean) => {
    if (inGate(x, z)) return;
    const px = x + (x >= maxX ? -VOXEL / 2 : VOXEL / 2);
    const pz = z + (z >= maxZ ? -VOXEL / 2 : VOXEL / 2);
    out.push({ x: px, y: VOXEL * 1.5, z: pz, color: PALETTE.fence });
    if (post) {
      out.push({ x: px, y: VOXEL * 0.5, z: pz, color: PALETTE.woodDark });
      out.push({ x: px, y: VOXEL * 2.5, z: pz, color: PALETTE.woodDark });
    }
  };

  let n = 0;
  for (let x = minX; x < maxX; x += VOXEL, n++) {
    fenceAt(x, minZ, n % 4 === 0);
    fenceAt(x, maxZ - VOXEL, n % 4 === 0);
  }
  n = 0;
  for (let z = minZ; z < maxZ; z += VOXEL, n++) {
    fenceAt(minX, z, n % 4 === 0);
    fenceAt(maxX - VOXEL, z, n % 4 === 0);
  }

  // A blackboard on stilts at the back of the field + two hay bales.
  const bx = def.center.x + 2.5;
  const bz = def.center.z;
  for (let y = 0; y < 4; y++) out.push({ x: bx, y: (y + 0.5) * VOXEL, z: bz - 1.25, color: PALETTE.woodDark });
  for (let y = 0; y < 4; y++) out.push({ x: bx, y: (y + 0.5) * VOXEL, z: bz + 1.25, color: PALETTE.woodDark });
  for (let zz = -1; zz <= 1; zz += VOXEL) {
    for (let y = 2; y < 5; y++) out.push({ x: bx, y: (y + 0.5) * VOXEL, z: bz + zz, color: "#3f5a4a" });
  }
  for (const [hx, hz] of [
    [def.center.x - 2, def.center.z + 3],
    [def.center.x - 2.5, def.center.z - 3],
  ]) {
    for (const dx of [0, VOXEL]) {
      for (const dz of [0, VOXEL]) out.push({ x: hx + dx, y: VOXEL / 2, z: hz + dz, color: PALETTE.flowerYellow });
    }
  }
  return dedupe(out);
}

// ---------------------------------------------------------------------------
// Office furniture
// ---------------------------------------------------------------------------

export function buildDesk(): { voxels: Voxel[]; collider: BoxCollider } {
  const out: Voxel[] = [];
  const nx = Math.round(DESK.width / VOXEL);
  const nz = Math.round(DESK.depth / VOXEL);
  const ox = DESK.x - DESK.width / 2;
  const oz = DESK.z - DESK.depth / 2;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const leg = (i === 0 || i === nx - 1) && (j === 0 || j === nz - 1);
      out.push({ x: ox + (i + 0.5) * VOXEL, y: VOXEL * 1.5, z: oz + (j + 0.5) * VOXEL, color: PALETTE.woodLight });
      if (leg) out.push({ x: ox + (i + 0.5) * VOXEL, y: VOXEL * 0.5, z: oz + (j + 0.5) * VOXEL, color: PALETTE.woodDark });
    }
  }
  return {
    voxels: out,
    collider: { center: [DESK.x, DESK.height / 2, DESK.z], halfExtents: [DESK.width / 2, DESK.height / 2, DESK.depth / 2] },
  };
}

// ---------------------------------------------------------------------------
// Nature & paths
// ---------------------------------------------------------------------------

export function buildTree(x: number, z: number, size: 1 | 2 = 1): Voxel[] {
  const out: Voxel[] = [];
  const trunkH = 3 + size;
  for (let y = 0; y < trunkH; y++) out.push({ x, y: (y + 0.5) * VOXEL, z, color: PALETTE.trunk });
  const r = 1 + size;
  for (let dy = 0; dy <= r + 1; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const d = Math.hypot(dx, dy - 1, dz);
        if (d <= r + 0.35) {
          const color = (dx + dy + dz) % 3 === 0 ? PALETTE.leafLight : PALETTE.leaf;
          out.push({ x: x + dx * VOXEL, y: (trunkH + dy + 0.5) * VOXEL, z: z + dz * VOXEL, color });
        }
      }
    }
  }
  return out;
}

/** Flat path tiles along every walking-graph edge that runs outside buildings. */
export function buildPathTiles(): Voxel[] {
  const nodes = new Map(NODES.map((n) => [n.id, n]));
  const tiles = new Map<string, Voxel>();
  const insideAnyBuilding = (x: number, z: number) =>
    Object.values(BUILDINGS).some(
      (b) =>
        x > b.center.x - b.size.x / 2 &&
        x < b.center.x + b.size.x / 2 &&
        z > b.center.z - b.size.z / 2 &&
        z < b.center.z + b.size.z / 2,
    );
  for (const [a, b] of EDGES) {
    const na = nodes.get(a)!;
    const nb = nodes.get(b)!;
    const len = Math.hypot(nb.x - na.x, nb.z - na.z);
    const steps = Math.ceil(len / (VOXEL / 2));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const px = na.x + (nb.x - na.x) * t;
      const pz = na.z + (nb.z - na.z) * t;
      for (const ox of [-0.5, 0, 0.5]) {
        for (const oz of [-0.5, 0, 0.5]) {
          const gx = Math.round((px + ox) / VOXEL) * VOXEL;
          const gz = Math.round((pz + oz) / VOXEL) * VOXEL;
          if (insideAnyBuilding(gx, gz)) continue;
          const k = `${gx}|${gz}`;
          if (!tiles.has(k)) {
            const edge = Math.abs(ox) + Math.abs(oz) >= 1;
            tiles.set(k, { x: gx, y: 0, z: gz, color: edge ? PALETTE.pathEdge : PALETTE.path });
          }
        }
      }
    }
  }
  return [...tiles.values()];
}

export interface Decorations {
  trees: Voxel[];
  flowers: Voxel[];
  treeColliders: BoxCollider[];
}

/** Trees and flowers, placed deterministically and kept off paths and buildings. */
export function buildDecorations(seed = 7): Decorations {
  const rand = mulberry32(seed);
  const pathTiles = buildPathTiles();
  const nearPath = (x: number, z: number, margin: number) =>
    pathTiles.some((t) => Math.abs(t.x - x) < margin && Math.abs(t.z - z) < margin);
  const nearBuilding = (x: number, z: number, margin: number) =>
    Object.values(BUILDINGS).some(
      (b) =>
        x > b.center.x - b.size.x / 2 - margin &&
        x < b.center.x + b.size.x / 2 + margin &&
        z > b.center.z - b.size.z / 2 - margin &&
        z < b.center.z + b.size.z / 2 + margin,
    );

  const trees: Voxel[] = [];
  const treeColliders: BoxCollider[] = [];
  const placed: Array<{ x: number; z: number }> = [];
  for (let attempt = 0; attempt < 400 && placed.length < 26; attempt++) {
    const x = Math.round(((rand() - 0.5) * 70) / VOXEL) * VOXEL;
    const z = Math.round(((rand() - 0.5) * 70 + 2) / VOXEL) * VOXEL;
    if (nearPath(x, z, 3) || nearBuilding(x, z, 3.5)) continue;
    if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < 4.5)) continue;
    placed.push({ x, z });
    trees.push(...buildTree(x, z, rand() > 0.6 ? 2 : 1));
    treeColliders.push({ center: [x, 1, z], halfExtents: [0.3, 1, 0.3] });
  }

  const flowers: Voxel[] = [];
  const colors = [PALETTE.flowerPink, PALETTE.flowerYellow, PALETTE.flowerWhite];
  for (let attempt = 0; attempt < 900 && flowers.length < 160; attempt++) {
    const x = Math.round(((rand() - 0.5) * 60) / VOXEL) * VOXEL;
    const z = Math.round(((rand() - 0.5) * 60 + 2) / VOXEL) * VOXEL;
    if (nearPath(x, z, 1) || nearBuilding(x, z, 0.8)) continue;
    flowers.push({ x, y: 0, z, color: colors[Math.floor(rand() * colors.length)] });
  }

  return { trees: dedupe(trees), flowers, treeColliders };
}
