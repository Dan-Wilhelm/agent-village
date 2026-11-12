/**
 * Procedural surface-detail atlas, painted at runtime into a small canvas.
 * Tiles are grey-scale multipliers (≈ 0.75–1.0) on top of the voxel vertex
 * colors, so one texture serves every color in the village. All patterns are
 * original and drawn here in code — nothing is downloaded.
 */
import { CanvasTexture, LinearMipmapLinearFilter, NearestFilter, RepeatWrapping } from "three";

import { ATLAS_CELL, ATLAS_COLUMNS, ATLAS_ROWS, ATLAS_TILE, TEX, type TexName } from "./mesher";

type Painter = (px: (x: number, y: number, v: number) => void, rnd: () => number) => void;

const T = ATLAS_TILE;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const noise = (amount: number): Painter => (px, rnd) => {
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) px(x, y, 1 - rnd() * amount);
};

const bevel = (px: (x: number, y: number, v: number) => void, dark = 0.9, light = 1) => {
  for (let i = 0; i < T; i++) {
    px(i, 0, light);
    px(0, i, light);
    px(i, T - 1, dark);
    px(T - 1, i, dark);
  }
};

const PAINTERS: Record<TexName, Painter> = {
  plain: (px, rnd) => {
    noise(0.03)(px, rnd);
    bevel(px, 0.9, 1);
  },
  plaster: (px, rnd) => {
    noise(0.06)(px, rnd);
    for (let i = 0; i < 6; i++) px(Math.floor(rnd() * T), Math.floor(rnd() * T), 0.9);
  },
  plank: (px, rnd) => {
    for (let y = 0; y < T; y++) {
      const board = Math.floor(y / 8);
      const tone = 0.93 + board * 0.04 + rnd() * 0.02;
      for (let x = 0; x < T; x++) {
        const grain = Math.sin(x * 0.9 + board * 3 + y * 0.4) * 0.025;
        px(x, y, tone + grain - rnd() * 0.03);
      }
    }
    for (let x = 0; x < T; x++) {
      px(x, 0, 0.72);
      px(x, 8, 0.72);
    }
    const seam = 5 + Math.floor(rnd() * 6);
    for (let y = 1; y < 8; y++) px(seam, y, 0.78);
    for (let y = 9; y < T; y++) px((seam + 8) % T, y, 0.78);
    px(2, 3, 0.7);
    px(13, 12, 0.7);
  },
  brick: (px, rnd) => {
    for (let y = 0; y < T; y++) {
      const row = Math.floor(y / 4);
      const off = row % 2 === 0 ? 0 : 4;
      for (let x = 0; x < T; x++) {
        const brick = Math.floor((x + off) / 8);
        const mortar = y % 4 === 0 || (x + off) % 8 === 0;
        const tone = 0.9 + ((brick * 7 + row * 3) % 5) * 0.025;
        px(x, y, mortar ? 0.76 : tone - rnd() * 0.04);
      }
    }
  },
  stone: (px, rnd) => {
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        const block = (y < 8 ? 0 : 1) * 2 + ((x + (y < 8 ? 0 : 6)) % T < 10 ? 0 : 1);
        const edge = y === 0 || y === 8 || (x + (y < 8 ? 0 : 6)) % T === 0 || (x + (y < 8 ? 0 : 6)) % T === 10;
        px(x, y, edge ? 0.74 : 0.9 + block * 0.025 - rnd() * 0.07);
      }
    }
  },
  cobble: (px, rnd) => {
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) px(x, y, 0.7);
    const stones = [
      [3, 3, 3],
      [10, 2, 3],
      [6, 9, 3.5],
      [13, 9, 3],
      [2, 13, 2.5],
      [11, 14, 2.5],
      [15, 4, 2],
    ];
    for (const [cx, cy, r] of stones) {
      const tone = 0.88 + rnd() * 0.12;
      for (let y = -4; y <= 4; y++) {
        for (let x = -4; x <= 4; x++) {
          const d = Math.hypot(x, y);
          if (d > r) continue;
          const shade = tone - (d / r) * 0.08 + (y < 0 ? 0.03 : 0);
          px((cx + x + T) % T, (cy + y + T) % T, shade - rnd() * 0.03);
        }
      }
    }
  },
  shingle: (px, rnd) => {
    for (let y = 0; y < T; y++) {
      const row = Math.floor(y / 4);
      const off = row % 2 === 0 ? 0 : 2;
      for (let x = 0; x < T; x++) {
        const local = y % 4;
        const sx = (x + off) % 4;
        const rounded = local === 3 && (sx === 0 || sx === 3);
        const gap = sx === 0 && local < 3;
        let v = 0.97 - local * 0.035 - rnd() * 0.03;
        if (gap) v = 0.8;
        if (rounded || local === 3) v = 0.78;
        px(x, y, v);
      }
    }
  },
  grass: (px, rnd) => {
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        const r = rnd();
        px(x, y, r < 0.12 ? 0.84 : r > 0.92 ? 1.0 : 0.94 + rnd() * 0.04);
      }
    }
  },
  leaf: (px, rnd) => {
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        const r = rnd();
        px(x, y, r < 0.2 ? 0.78 : r > 0.85 ? 1.0 : 0.91);
      }
    }
  },
  bark: (px, rnd) => {
    for (let x = 0; x < T; x++) {
      const stripe = x % 4 === 0 ? 0.75 : 0.92 + rnd() * 0.06;
      for (let y = 0; y < T; y++) px(x, y, stripe - (rnd() < 0.1 ? 0.1 : 0));
    }
  },
  dirt: (px, rnd) => {
    noise(0.08)(px, rnd);
    for (let i = 0; i < 9; i++) {
      const x = Math.floor(rnd() * T);
      const y = Math.floor(rnd() * T);
      px(x, y, 1);
      px((x + 1) % T, y, 0.96);
      px(x, (y + 1) % T, 0.82);
    }
  },
  cloth: (px, rnd) => {
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) px(x, y, (x + y) % 2 === 0 ? 0.97 : 0.92 - rnd() * 0.02);
  },
};

let cached: CanvasTexture | null = null;

/** Lazily creates the shared atlas texture (browser only). */
export function getAtlasTexture(): CanvasTexture {
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS_CELL * ATLAS_COLUMNS;
  canvas.height = ATLAS_CELL * ATLAS_ROWS;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(canvas.width, canvas.height);

  (Object.keys(TEX) as TexName[]).forEach((name, n) => {
    const tile = new Float32Array(T * T).fill(1);
    const set = (x: number, y: number, v: number) => {
      tile[((y + T) % T) * T + ((x + T) % T)] = v;
    };
    PAINTERS[name](set, rng(1000 + n * 77));
    const idx = TEX[name];
    const cx = (idx % ATLAS_COLUMNS) * ATLAS_CELL;
    const cy = Math.floor(idx / ATLAS_COLUMNS) * ATLAS_CELL;
    const pad = (ATLAS_CELL - T) / 2;
    // fill the whole cell with the wrapped tile, so mip-mapping never bleeds a different pattern in
    for (let y = 0; y < ATLAS_CELL; y++) {
      for (let x = 0; x < ATLAS_CELL; x++) {
        const tx = (((x - pad) % T) + T) % T;
        const ty = (((y - pad) % T) + T) % T;
        const v = Math.max(0, Math.min(1, tile[ty * T + tx]));
        const o = ((cy + y) * canvas.width + cx + x) * 4;
        const c = Math.round(v * 255);
        img.data[o] = c;
        img.data[o + 1] = c;
        img.data[o + 2] = c;
        img.data[o + 3] = 255;
      }
    }
  });
  ctx.putImageData(img, 0, 0);

  const tex = new CanvasTexture(canvas);
  // grey-scale multipliers are linear data, not colors
  tex.magFilter = NearestFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.anisotropy = 8;
  cached = tex;
  return tex;
}
