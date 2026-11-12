/**
 * Interior furniture. The owner spends most of the time in the office, so it
 * gets the most love: couch, bookshelf, plants, a floor lamp, wainscoting,
 * ceiling beams, a pendant lamp and a properly dressed desk. Flat things that
 * need painted detail (rug, pinboard, paintings, task boards) are canvas
 * planes, listed in `surfaces` and rendered by Interiors.tsx.
 */
import { BUILDINGS, DESK } from "../layout";
import { DETAIL, FINE, box, dedupe, shade, type BoxCollider, type Voxel } from "./builders";

const d = DETAIL;
const f = FINE;

export type SurfaceKind =
  | "rug"
  | "runner"
  | "pinboard"
  | "painting-hills"
  | "painting-sea"
  | "clock"
  | "taskboard"
  | "board-overdue"
  | "board-today"
  | "chalkboard"
  | "pegboard"
  | "deskmat"
  | "notebook";

export interface Surface {
  kind: SurfaceKind;
  /** Center position. */
  position: [number, number, number];
  /** Rotation around Y (plane faces +z when 0); use -π/2 for floor (flat). */
  rotationY: number;
  flat?: boolean;
  size: [number, number];
}

export interface Interiors {
  detail: Voxel[];
  fine: Voxel[];
  /** Warm interior lights: position, color, intensity, distance. */
  lights: Array<{ position: [number, number, number]; color: string; intensity: number; distance: number }>;
  surfaces: Surface[];
  colliders: BoxCollider[];
}

const WOOD = "#a8683f";
const WOOD_DARK = "#6e3f22";
const WOOD_LIGHT = "#c99566";
/** Painted wainscoting in the office: a soft sage that balances all the warm wood. */
const SAGE = "#a9c4a0";
const SAGE_DARK = "#7f9f78";
const BOOKS = ["#e0715d", "#6f97cf", "#6dbb8d", "#ffd166", "#c38bff", "#ff9fb8", "#fff6e8", "#8a5a36", "#4f8f6b"];

function pottedPlant(out: Voxel[], x: number, z: number, height: number, pot = "#d9825b", seed = 1) {
  // pot (2×2 with a rim), then a bushy, leafy top that gets narrower
  box(out, d, x - d, 0, z - d, x + d, 2 * d, z + d, pot);
  for (const [a, b] of [
    [-1, -1],
    [-1, 0],
    [0, -1],
    [0, 0],
  ]) out.push({ x: x + (a + 0.5) * d, y: 2.5 * d, z: z + (b + 0.5) * d, color: shade(pot, -0.15) });
  const rows = Math.round(height / d);
  for (let y = 3; y < 3 + rows; y++) {
    const t = (y - 3) / rows;
    const r = t < 0.25 ? 1 : t < 0.8 ? 2 : 1;
    for (let a = -r; a < r; a++) {
      for (let b = -r; b < r; b++) {
        const h = Math.abs(Math.sin((a * 7 + b * 13 + y * 3 + seed) * 12.9898)) % 1;
        if (r === 2 && (a === -2 || a === 1) && (b === -2 || b === 1) && h < 0.6) continue;
        if (h < 0.12) continue;
        out.push({ x: x + (a + 0.5) * d, y: (y + 0.5) * d, z: z + (b + 0.5) * d, color: h > 0.7 ? "#7fcb63" : h > 0.35 ? "#5eb352" : "#4c9444", tex: "leaf" });
      }
    }
  }
}

function bookshelf(out: Voxel[], x0: number, x1: number, z0: number, z1: number, rows: number, seed = 0, alongX = false) {
  const h = rows * 3 * d + d;
  box(out, d, x0, 0, z0, x1, h, z1, (x, y, z) => {
    const sideEdge = alongX ? x < x0 + d || x > x1 - d : z < z0 + d || z > z1 - d;
    const shelf = Math.round((y - d / 2) / d) % 3 === 0 || y > h - d;
    const back = alongX ? z < z0 + d : x > x1 - d || x < x0 + d;
    if (sideEdge || shelf) return WOOD;
    if (back && (alongX ? true : false)) return WOOD_DARK;
    // books: colorful spines, a few gaps
    const k = Math.round((alongX ? x : z) / d) + Math.round(y / d) * 7 + seed;
    const hsh = Math.abs(Math.sin(k * 78.233) * 43758.5453) % 1;
    if (hsh < 0.08) return WOOD_DARK;
    return BOOKS[Math.floor(hsh * BOOKS.length)];
  }, "plank");
}

function office(out: Voxel[], fine: Voxel[], lights: Interiors["lights"], surfaces: Surface[], cols: BoxCollider[]) {
  const o = BUILDINGS.office;
  const minX = o.center.x - o.size.x / 2 + 0.5;
  const maxX = o.center.x + o.size.x / 2 - 0.5;
  const minZ = o.center.z - o.size.z / 2 + 0.5;
  const maxZ = o.center.z + o.size.z / 2 - 0.5;
  const H = o.wallHeight;

  // Wainscoting (FINE, 0.8 m high) on all inner walls, leaving the doorway open
  for (let x = minX + f / 2; x < maxX; x += f) {
    for (let y = f / 2; y < 0.8; y += f) {
      const rail = y > 0.7;
      const groove = Math.round((x - minX) / f) % 4 === 0;
      const c = rail ? SAGE_DARK : groove ? shade(SAGE, -0.1) : SAGE;
      fine.push({ x, y, z: maxZ + f / 2 - f, color: c, tex: "plank" });
      if (Math.abs(x - o.center.x) > 1.05) fine.push({ x, y, z: minZ - f / 2 + f, color: c, tex: "plank" });
    }
  }
  for (let z = minZ + f / 2; z < maxZ; z += f) {
    for (let y = f / 2; y < 0.8; y += f) {
      const rail = y > 0.7;
      const groove = Math.round((z - minZ) / f) % 4 === 0;
      const c = rail ? SAGE_DARK : groove ? shade(SAGE, -0.1) : SAGE;
      fine.push({ x: minX + f / 2, y, z, color: c, tex: "plank" });
      fine.push({ x: maxX - f / 2, y, z, color: c, tex: "plank" });
    }
  }

  // Ceiling beams and a flush, warm ceiling light between them
  for (const bz of [19.5, 22.25, 25]) {
    box(out, d, minX, H - d, bz - d / 2 - d / 2, maxX, H, bz + d / 2, WOOD_DARK, "plank");
  }
  box(fine, f, -0.4, H - f, 20.5, 0.4, H, 21.3, "#f3e3c8");
  box(fine, f, -0.3, H - 2 * f, 20.6, 0.3, H - f, 21.2, "#ffe7bf", "plain", "glow");
  lights.push({ position: [o.center.x, 2.6, 21], color: "#ffcf8f", intensity: 5, distance: 8 });

  // Couch along the west wall (seat faces east), with two cushions and a throw pillow
  const cx0 = minX;
  const cz0 = 20.5;
  const cz1 = 23.0;
  const sage = "#7fb8a4";
  box(out, d, cx0, 0, cz0, cx0 + 4 * d, 2 * d, cz1, sage, "cloth"); // base + seat
  box(out, d, cx0, 2 * d, cz0, cx0 + d, 4 * d, cz1, shade(sage, -0.08), "cloth"); // backrest
  box(out, d, cx0 + d, 2 * d, cz0, cx0 + 4 * d, 3 * d, cz0 + d, shade(sage, -0.08), "cloth"); // arms
  box(out, d, cx0 + d, 2 * d, cz1 - d, cx0 + 4 * d, 3 * d, cz1, shade(sage, -0.08), "cloth");
  box(out, d, cx0 + d, 2 * d, cz0 + d, cx0 + 3 * d, 2 * d + d, cz0 + 5 * d, "#f3e1c7", "cloth");
  box(out, d, cx0 + d, 3 * d, cz0 + d, cx0 + 2 * d, 4 * d, cz0 + 2 * d, "#ff9fb8", "cloth");
  box(out, d, cx0 + d, 3 * d, cz1 - 2 * d, cx0 + 2 * d, 4 * d, cz1 - d, "#ffd166", "cloth");
  cols.push({ center: [cx0 + 0.5, 0.5, (cz0 + cz1) / 2], halfExtents: [0.5, 0.5, (cz1 - cz0) / 2] });

  // Side table with a stack of books and a little lamp next to the couch
  box(out, d, cx0, 0, 23.25, cx0 + 3 * d, 2 * d, 24.0, WOOD, "plank");
  box(fine, f, cx0 + 0.15, 0.5, 23.4, cx0 + 0.55, 0.6, 23.8, "#6f97cf");
  box(fine, f, cx0 + 0.15, 0.6, 23.4, cx0 + 0.45, 0.7, 23.7, "#e0715d");
  cols.push({ center: [cx0 + 0.375, 0.25, 23.625], halfExtents: [0.375, 0.25, 0.375] });

  // Floor lamp in the north-west corner (warm glow)
  const lx = minX + 0.375;
  const lz = minZ + 0.625;
  box(out, d, lx - d, 0, lz - d, lx + d, d / 2 + d / 2, lz + d, WOOD_DARK);
  for (let y = 0.25; y < 1.5; y += f) fine.push({ x: lx - f / 2, y: y + f / 2, z: lz - f / 2, color: "#3d3530" });
  box(fine, f, lx - 0.25, 1.5, lz - 0.25, lx + 0.25, 1.8, lz + 0.25, "#ffe0a8", "plain", "glow");
  box(fine, f, lx - 0.3, 1.8, lz - 0.3, lx + 0.3, 1.9, lz + 0.3, "#f3c98b");
  lights.push({ position: [lx + 0.3, 1.6, lz + 0.3], color: "#ffbf73", intensity: 4, distance: 7 });
  cols.push({ center: [lx, 0.9, lz], halfExtents: [0.3, 0.9, 0.3] });

  // Bookshelf on the east wall between the windows
  bookshelf(out, maxX - 2 * d, maxX, 20.5, 23.0, 3, 3);
  cols.push({ center: [maxX - 0.25, 1.1, 21.75], halfExtents: [0.25, 1.1, 1.25] });

  // Plants in the corners
  pottedPlant(out, maxX - 0.5, minZ + 0.5, 1.3, "#d9825b", 1);
  pottedPlant(out, minX + 0.5, maxZ - 0.5, 1.6, "#c38bff", 2);
  pottedPlant(out, maxX - 0.5, maxZ - 0.5, 1.0, "#6f97cf", 3);
  cols.push({ center: [maxX - 0.5, 0.6, minZ + 0.5], halfExtents: [0.35, 0.6, 0.35] });
  cols.push({ center: [minX + 0.5, 0.6, maxZ - 0.5], halfExtents: [0.35, 0.6, 0.35] });
  cols.push({ center: [maxX - 0.5, 0.6, maxZ - 0.5], halfExtents: [0.35, 0.6, 0.35] });

  // Sideboard on the back wall with a record player and a vase
  box(out, d, -1.0, 0, maxZ - 2 * d, 1.0, 3 * d, maxZ, (x, y) => (y > 2 * d ? WOOD : Math.round(x / d) % 4 === 0 ? WOOD_DARK : WOOD_LIGHT), "plank");
  box(fine, f, -0.7, 0.75, maxZ - 0.4, -0.2, 0.85, maxZ - 0.05, "#3d3530");
  box(fine, f, -0.6, 0.85, maxZ - 0.35, -0.3, 0.88, maxZ - 0.1, "#e0715d");
  box(fine, f, 0.4, 0.75, maxZ - 0.3, 0.6, 1.05, maxZ - 0.1, "#8fd3ff");
  box(fine, f, 0.4, 1.05, maxZ - 0.3, 0.6, 1.15, maxZ - 0.1, "#ff8fab");
  cols.push({ center: [0, 0.375, maxZ - 0.25], halfExtents: [1, 0.375, 0.25] });

  // Desk dressing (FINE): laptop, mug, papers, pen cup, plant, desk lamp — real-world sizes
  const top = DESK.height;
  const dz = DESK.z;
  // a little stack of books on the left
  box(fine, f, -1.0, top, 23.7, -0.6, top + f, 24.0, "#4f8f6b", "plank");
  box(fine, f, -0.95, top + f, 23.7, -0.65, top + 2 * f, 24.0, "#e0715d", "plank");
  box(fine, f, -1.0, top + 2 * f, 23.8, -0.7, top + 3 * f, 24.0, "#ffd166", "plank");
  box(fine, f, 0.5, top, 24.1, 0.7, top + 0.2, 24.3, (x, y) => (y > top + f ? "#e0715d" : "#fff6e8")); // mug
  fine.push({ x: 0.75, y: top + 0.15, z: 24.15, color: "#fff6e8" });
  box(fine, f, 0.9, top, 23.7, 1.0, top + 0.2, 23.8, "#6f97cf"); // pen cup
  fine.push({ x: 0.95, y: top + 0.25, z: 23.75, color: "#ffd166" });
  // plant (front-left corner)
  box(fine, f, -1.3, top, 23.6, -1.1, top + 0.2, 23.8, "#d9825b");
  box(fine, f, -1.4, top + 0.2, 23.5, -1.0, top + 0.3, 23.9, "#5eb352", "leaf");
  box(fine, f, -1.3, top + 0.3, 23.6, -1.1, top + 0.5, 23.8, "#7fcb63", "leaf");
  fine.push({ x: -1.35, y: top + 0.35, z: 23.75, color: "#6fbf5c", tex: "leaf" });
  // desk lamp (front-right corner) with a warm shade
  box(fine, f, 1.1, top, 23.6, 1.3, top + f, 23.8, "#4f8f6b");
  box(fine, f, 1.1, top + f, 23.6, 1.2, top + 0.4, 23.7, "#4f8f6b");
  box(fine, f, 1.0, top + 0.4, 23.5, 1.3, top + 0.5, 23.8, "#4f8f6b");
  box(fine, f, 1.1, top + 0.3, 23.6, 1.2, top + 0.4, 23.7, "#ffe0a8", "plain", "glow");
  lights.push({ position: [1.15, top + 0.3, dz - 0.35], color: "#ffcf8a", intensity: 2, distance: 3.5 });

  // desk mat with an open notebook (painted surfaces lying on the desk)
  surfaces.push({ kind: "deskmat", position: [0, top + 0.003, dz + 0.05], rotationY: 0, flat: true, size: [1.2, 0.62] });
  surfaces.push({ kind: "notebook", position: [0.05, top + 0.006, dz + 0.08], rotationY: 0, flat: true, size: [0.56, 0.38] });

  // Canvas surfaces: rug, pinboard and painting on the north wall, a clock above the door
  surfaces.push({ kind: "rug", position: [0, 0.012, 20.6], rotationY: 0, flat: true, size: [4.5, 4.6] });
  surfaces.push({ kind: "pinboard", position: [2.05, 1.85, minZ + 0.02], rotationY: 0, size: [1.5, 1.05] });
  surfaces.push({ kind: "painting-hills", position: [-2.05, 1.85, minZ + 0.02], rotationY: 0, size: [1.2, 0.9] });
  surfaces.push({ kind: "clock", position: [0, 3.2, minZ + 0.02], rotationY: 0, size: [0.55, 0.55] });
  surfaces.push({ kind: "painting-sea", position: [0, 1.95, maxZ - 0.02], rotationY: Math.PI, size: [1.3, 0.8] });
}

function hq(out: Voxel[], fine: Voxel[], lights: Interiors["lights"], surfaces: Surface[], cols: BoxCollider[]) {
  const b = BUILDINGS.hq;
  const minX = b.center.x - b.size.x / 2 + 0.5;
  const maxX = b.center.x + b.size.x / 2 - 0.5;
  const minZ = b.center.z - b.size.z / 2 + 0.5;
  const maxZ = b.center.z + b.size.z / 2 - 0.5;
  const H = b.wallHeight;

  // Round meeting table with four stools
  const tx = 0;
  const tz = -2.5;
  for (let x = tx - 1.5 + d / 2; x < tx + 1.5; x += d) {
    for (let z = tz - 1.5 + d / 2; z < tz + 1.5; z += d) {
      const r = Math.hypot(x - tx, z - tz);
      if (r > 1.4) continue;
      out.push({ x, y: 3.5 * d, z, color: r > 1.1 ? "#9a7be0" : WOOD_LIGHT, tex: r > 1.1 ? "plain" : "plank" });
    }
  }
  box(out, d, tx - d, 0, tz - d, tx + d, 3 * d, tz + d, WOOD);
  box(out, d, tx - 2 * d, 0, tz - 2 * d, tx + 2 * d, d, tz + 2 * d, WOOD_DARK);
  for (const [sx, sz] of [
    [0, -1.9],
    [1.9, 0],
    [-1.9, 0],
  ]) {
    const x = tx + sx;
    const z = tz + sz;
    box(out, d, x - d, 0, z - d, x + d, 2 * d, z + d, (xx, y) => (y > d ? "#ffd166" : WOOD), "cloth");
  }
  // laptop-ish slates and paper stacks on the table
  box(fine, f, -0.6, 0.9, -2.9, -0.1, 0.95, -2.5, "#fffaf2");
  box(fine, f, 0.3, 0.9, -2.3, 0.8, 0.95, -1.9, "#ffd166");
  box(fine, f, 0.1, 0.9, -3.2, 0.4, 1.05, -2.9, "#8fd3ff");
  cols.push({ center: [tx, 0.5, tz], halfExtents: [1.4, 0.5, 1.4] });

  // Big task board on the north wall + two smaller boards on the side walls
  surfaces.push({ kind: "taskboard", position: [0, 2.6, minZ + 0.03], rotationY: 0, size: [5.2, 2.7] });
  surfaces.push({ kind: "board-overdue", position: [minX + 0.03, 2.4, -1.75], rotationY: Math.PI / 2, size: [1.8, 1.4] });
  surfaces.push({ kind: "board-today", position: [maxX - 0.03, 2.4, -1.75], rotationY: -Math.PI / 2, size: [1.8, 1.4] });
  surfaces.push({ kind: "runner", position: [0, 0.012, 2.4], rotationY: 0, flat: true, size: [2.2, 6.0] });

  // Plants in all four corners, low cabinets under the side boards
  pottedPlant(out, minX + 0.5, minZ + 0.5, 1.8, "#c38bff", 5);
  pottedPlant(out, maxX - 0.5, minZ + 0.5, 1.8, "#c38bff", 6);
  pottedPlant(out, minX + 0.5, maxZ - 0.5, 1.2, "#d9825b", 7);
  pottedPlant(out, maxX - 0.5, maxZ - 0.5, 1.2, "#d9825b", 8);
  for (const [px, pz] of [
    [minX + 0.5, minZ + 0.5],
    [maxX - 0.5, minZ + 0.5],
    [minX + 0.5, maxZ - 0.5],
    [maxX - 0.5, maxZ - 0.5],
  ]) cols.push({ center: [px, 0.6, pz], halfExtents: [0.35, 0.6, 0.35] });
  box(out, d, minX, 0, -2.75, minX + 2 * d, 3 * d, -0.75, WOOD_LIGHT, "plank");
  box(out, d, maxX - 2 * d, 0, -2.75, maxX, 3 * d, -0.75, WOOD_LIGHT, "plank");
  cols.push({ center: [minX + 0.25, 0.4, -1.75], halfExtents: [0.25, 0.4, 1] });
  cols.push({ center: [maxX - 0.25, 0.4, -1.75], halfExtents: [0.25, 0.4, 1] });

  // Hanging lanterns
  for (const [lx, lz] of [
    [-2.5, -2.5],
    [2.5, -2.5],
    [-2.5, 2.5],
    [2.5, 2.5],
  ]) {
    const x = lx + f / 2;
    const z = lz + f / 2;
    for (let y = H - f / 2; y > 4.2; y -= f) fine.push({ x, y, z, color: "#3d3530" });
    box(fine, f, x - 0.15 - f / 2, 3.8, z - 0.15 - f / 2, x + 0.15 + f / 2, 4.2, z + 0.15 + f / 2, "#ffd27a", "plain", "glow");
    box(fine, f, x - 0.2 - f / 2, 4.2, z - 0.2 - f / 2, x + 0.2 + f / 2, 4.3, z + 0.2 + f / 2, "#7b5ad0");
  }
  lights.push({ position: [0, 4, 0], color: "#ffd9a8", intensity: 9, distance: 13 });
}

function workshop(out: Voxel[], fine: Voxel[], lights: Interiors["lights"], surfaces: Surface[], cols: BoxCollider[]) {
  const b = BUILDINGS.workshop;
  const maxX = b.center.x + b.size.x / 2 - 0.5;
  const minZ = b.center.z - b.size.z / 2 + 0.5;
  const maxZ = b.center.z + b.size.z / 2 - 0.5;
  // Workbench along the east wall with a vice and wood offcuts
  box(out, d, maxX - 3 * d, 3 * d, 1.5, maxX, 4 * d, 6.5, WOOD_LIGHT, "plank");
  for (const z of [1.5, 6.25]) box(out, d, maxX - 3 * d, 0, z, maxX - 2 * d, 3 * d, z + d, WOOD_DARK, "plank");
  box(out, d, maxX - 3 * d, d, 1.5, maxX, 1.5 * d + d / 2, 6.5, WOOD, "plank");
  box(fine, f, maxX - 0.7, 1.0, 2.0, maxX - 0.4, 1.2, 2.3, "#6f97cf");
  box(fine, f, maxX - 0.6, 1.0, 4.0, maxX - 0.2, 1.1, 5.2, "#e9c99a", "plank");
  cols.push({ center: [maxX - 0.375, 0.5, 4], halfExtents: [0.375, 0.5, 2.5] });
  surfaces.push({ kind: "pegboard", position: [maxX - 0.03, 2.0, 4], rotationY: -Math.PI / 2, size: [3.6, 1.3] });
  // Crates in the corners
  for (const [x, z] of [
    [maxX - 0.5, minZ + 0.5],
    [maxX - 0.5, maxZ - 0.5],
    [maxX - 1.25, maxZ - 0.5],
  ]) {
    box(out, d, x - 2 * d, 0, z - 2 * d, x + 2 * d, 3 * d, z + 2 * d, (xx, y, zz) => ((Math.abs(xx - x) > d && Math.abs(zz - z) > d) || y > 2 * d ? "#8a5a36" : "#d9a066"), "plank");
    cols.push({ center: [x, 0.375, z], halfExtents: [0.5, 0.375, 0.5] });
  }
  pottedPlant(out, b.center.x - b.size.x / 2 + 1, minZ + 0.5, 1.0, "#d9825b", 9);
  cols.push({ center: [b.center.x - b.size.x / 2 + 1, 0.6, minZ + 0.5], halfExtents: [0.35, 0.6, 0.35] });
  lights.push({ position: [b.center.x + 1, 3.2, b.center.z], color: "#ffd2a0", intensity: 5, distance: 10 });
}

function library(out: Voxel[], fine: Voxel[], lights: Interiors["lights"], surfaces: Surface[], cols: BoxCollider[]) {
  const b = BUILDINGS.library;
  const minX = b.center.x - b.size.x / 2 + 0.5;
  const minZ = b.center.z - b.size.z / 2 + 0.5;
  const maxZ = b.center.z + b.size.z / 2 - 0.5;
  // Tall shelves on the west wall between windows, and along the north wall
  bookshelf(out, minX, minX + 2 * d, minZ, 0.75, 4, 11);
  bookshelf(out, minX, minX + 2 * d, 2.25, 5.75, 4, 12);
  bookshelf(out, minX, minX + 2 * d, 7.25, maxZ, 4, 13);
  cols.push({ center: [minX + 0.25, 1.4, 4], halfExtents: [0.25, 1.4, 4] });
  bookshelf(out, -21.75, -18.25, minZ, minZ + 2 * d, 4, 14, true);
  bookshelf(out, -21.75, -18.25, maxZ - 2 * d, maxZ, 4, 16, true);
  cols.push({ center: [-20, 1.4, minZ + 0.25], halfExtents: [1.75, 1.4, 0.25] });
  cols.push({ center: [-20, 1.4, maxZ - 0.25], halfExtents: [1.75, 1.4, 0.25] });
  // Reading table with a green lamp and an open book
  box(out, d, -22.0, 3 * d, 3.0, -20.5, 4 * d, 5.0, WOOD, "plank");
  for (const [x, z] of [
    [-22.0, 3.0],
    [-20.75, 3.0],
    [-22.0, 4.75],
    [-20.75, 4.75],
  ]) box(out, d, x, 0, z, x + d, 3 * d, z + d, WOOD_DARK, "plank");
  box(fine, f, -21.6, 1.0, 3.6, -21.0, 1.05, 4.2, "#fffaf2");
  box(fine, f, -21.35, 1.0, 3.6, -21.25, 1.07, 4.2, "#e0715d");
  box(fine, f, -21.9, 1.0, 4.4, -21.7, 1.3, 4.6, "#3d3530");
  box(fine, f, -22.0, 1.3, 4.3, -21.6, 1.4, 4.7, "#3f8a60");
  box(fine, f, -21.95, 1.25, 4.35, -21.65, 1.3, 4.65, "#ffe0a8", "plain", "glow");
  cols.push({ center: [-21.25, 0.5, 4], halfExtents: [0.75, 0.5, 1] });
  pottedPlant(out, -16.6, minZ + 1.0, 1.2, "#6dbb8d", 10);
  lights.push({ position: [-21, 2.6, 4], color: "#ffd2a0", intensity: 5, distance: 10 });
}

export function buildInteriors(): Interiors {
  const detail: Voxel[] = [];
  const fine: Voxel[] = [];
  const lights: Interiors["lights"] = [];
  const surfaces: Surface[] = [];
  const colliders: BoxCollider[] = [];
  office(detail, fine, lights, surfaces, colliders);
  hq(detail, fine, lights, surfaces, colliders);
  workshop(detail, fine, lights, surfaces, colliders);
  library(detail, fine, lights, surfaces, colliders);
  const t = BUILDINGS.training;
  surfaces.push({ kind: "chalkboard", position: [t.center.x + 4.24, 1.45, t.center.z - 0.5], rotationY: -Math.PI / 2, size: [2.5, 1.5] });
  return { detail: dedupe(detail), fine: dedupe(fine), lights, surfaces, colliders };
}
