"use client";

import { useEffect, useMemo } from "react";
import { CanvasTexture, SRGBColorSpace } from "three";

import type { Surface, SurfaceKind } from "./voxels/interiors";

/**
 * Flat, painted things inside the buildings (rug, pinboard, paintings, clock,
 * task boards). Each is drawn once into a small canvas — original art, no
 * downloads. The HQ boards are decorative placeholders; real ClickUp data
 * arrives later through the 2D overlay.
 */

const FONT = "ui-rounded, 'SF Pro Rounded', 'Arial Rounded MT Bold', system-ui, sans-serif";
type Painter = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

function seeded(seed: number) {
  let a = seed;
  return () => {
    a = (a * 16807) % 2147483647;
    return (a - 1) / 2147483646;
  };
}

const woodFrame = (ctx: CanvasRenderingContext2D, w: number, h: number, t: number, color = "#7a4a2b") => {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, t);
  ctx.fillRect(0, h - t, w, t);
  ctx.fillRect(0, 0, t, h);
  ctx.fillRect(w - t, 0, t, h);
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillRect(0, 0, w, t / 3);
};

const PAINTERS: Record<SurfaceKind, { w: number; h: number; draw: Painter; transparent?: boolean }> = {
  rug: {
    w: 256,
    h: 256,
    draw: (ctx, w, h) => {
      // warm woven rug with a border, diamonds and a fringe
      ctx.fillStyle = "#c95f53";
      ctx.fillRect(0, 0, w, h);
      rr(ctx, 14, 14, w - 28, h - 28, 6, "#f3e1c7");
      rr(ctx, 24, 24, w - 48, h - 48, 4, "#e9a074");
      rr(ctx, 34, 34, w - 68, h - 68, 4, "#f6e7cf");
      ctx.fillStyle = "#c95f53";
      for (let y = 54; y < h - 40; y += 36) {
        for (let x = 54 + ((y / 36) % 2) * 18; x < w - 40; x += 36) {
          ctx.beginPath();
          ctx.moveTo(x, y - 10);
          ctx.lineTo(x + 10, y);
          ctx.lineTo(x, y + 10);
          ctx.lineTo(x - 10, y);
          ctx.fill();
        }
      }
      ctx.fillStyle = "#4f8f6b";
      ctx.beginPath();
      ctx.moveTo(w / 2, h / 2 - 34);
      ctx.lineTo(w / 2 + 34, h / 2);
      ctx.lineTo(w / 2, h / 2 + 34);
      ctx.lineTo(w / 2 - 34, h / 2);
      ctx.fill();
      ctx.fillStyle = "#ffd166";
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, 12, 0, Math.PI * 2);
      ctx.fill();
      // subtle weave lines
      ctx.fillStyle = "rgba(0,0,0,0.04)";
      for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1);
    },
  },
  runner: {
    w: 128,
    h: 320,
    draw: (ctx, w, h) => {
      ctx.fillStyle = "#7b5ad0";
      ctx.fillRect(0, 0, w, h);
      rr(ctx, 10, 10, w - 20, h - 20, 4, "#9a7be0");
      ctx.fillStyle = "#ffd166";
      for (let y = 30; y < h - 20; y += 34) {
        ctx.beginPath();
        ctx.moveTo(w / 2, y - 9);
        ctx.lineTo(w / 2 + 9, y);
        ctx.lineTo(w / 2, y + 9);
        ctx.lineTo(w / 2 - 9, y);
        ctx.fill();
      }
      ctx.fillStyle = "#efe2fb";
      ctx.fillRect(18, 10, 4, h - 20);
      ctx.fillRect(w - 22, 10, 4, h - 20);
    },
  },
  pinboard: {
    w: 300,
    h: 210,
    draw: (ctx, w, h) => {
      ctx.fillStyle = "#d9a066";
      ctx.fillRect(0, 0, w, h);
      const rnd = seeded(7);
      for (let i = 0; i < 500; i++) {
        ctx.fillStyle = rnd() > 0.5 ? "rgba(122,74,43,0.18)" : "rgba(255,255,255,0.15)";
        ctx.fillRect(rnd() * w, rnd() * h, 2, 2);
      }
      woodFrame(ctx, w, h, 12);
      const notes: Array<[number, number, string, number]> = [
        [30, 30, "#fff3a8", -0.06],
        [110, 26, "#bfe6ff", 0.05],
        [196, 34, "#ffd1dc", -0.03],
        [44, 112, "#d6f5c4", 0.04],
        [132, 116, "#fffaf2", -0.05],
        [212, 118, "#fff3a8", 0.07],
      ];
      for (const [x, y, c, rot] of notes) {
        ctx.save();
        ctx.translate(x + 34, y + 30);
        ctx.rotate(rot);
        ctx.fillStyle = "rgba(0,0,0,0.12)";
        ctx.fillRect(-32, -26, 68, 60);
        ctx.fillStyle = c;
        ctx.fillRect(-34, -30, 68, 60);
        ctx.fillStyle = "rgba(59,42,30,0.45)";
        for (let l = 0; l < 4; l++) ctx.fillRect(-26, -14 + l * 11, 40 + ((l * 13) % 14), 3);
        ctx.fillStyle = ["#e0475b", "#6f97cf", "#ffd166"][Math.abs(Math.round(x)) % 3];
        ctx.beginPath();
        ctx.arc(0, -24, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      // a string connecting two notes
      ctx.strokeStyle = "#e0475b";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(64, 36);
      ctx.quadraticCurveTo(150, 90, 246, 124);
      ctx.stroke();
    },
  },
  "painting-hills": {
    w: 240,
    h: 180,
    draw: (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, "#ffd6a5");
      g.addColorStop(0.6, "#ffeccc");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#ffb86b";
      ctx.beginPath();
      ctx.arc(w * 0.7, h * 0.42, 22, 0, Math.PI * 2);
      ctx.fill();
      const hill = (y: number, amp: number, color: string, phase: number) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let x = 0; x <= w; x += 8) ctx.lineTo(x, y + Math.sin(x / 40 + phase) * amp);
        ctx.lineTo(w, h);
        ctx.fill();
      };
      hill(h * 0.58, 12, "#9bd36a", 0.5);
      hill(h * 0.7, 10, "#6cbf5b", 2);
      hill(h * 0.84, 8, "#4c9444", 4);
      ctx.fillStyle = "#fff3dd";
      ctx.fillRect(w * 0.25, h * 0.6, 22, 16);
      ctx.fillStyle = "#e0715d";
      ctx.beginPath();
      ctx.moveTo(w * 0.25 - 4, h * 0.6);
      ctx.lineTo(w * 0.25 + 11, h * 0.6 - 12);
      ctx.lineTo(w * 0.25 + 26, h * 0.6);
      ctx.fill();
      woodFrame(ctx, w, h, 12, "#c99566");
    },
  },
  "painting-sea": {
    w: 240,
    h: 150,
    draw: (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, "#bfe3ff");
      g.addColorStop(0.55, "#fff3dd");
      g.addColorStop(0.56, "#6fb7d8");
      g.addColorStop(1, "#3f8fb8");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      for (let i = 0; i < 6; i++) ctx.fillRect(30 + i * 34, h * 0.68 + (i % 2) * 14, 18, 3);
      ctx.fillStyle = "#fffaf2";
      ctx.beginPath();
      ctx.moveTo(w * 0.55, h * 0.55);
      ctx.lineTo(w * 0.55, h * 0.22);
      ctx.lineTo(w * 0.68, h * 0.55);
      ctx.fill();
      ctx.fillStyle = "#a8683f";
      ctx.fillRect(w * 0.47, h * 0.55, 60, 8);
      woodFrame(ctx, w, h, 12, "#7a4a2b");
    },
  },
  clock: {
    w: 128,
    h: 128,
    transparent: true,
    draw: (ctx, w, h) => {
      ctx.fillStyle = "#7a4a2b";
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, 62, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff8ee";
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, 52, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#3b2a1e";
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const r = i % 3 === 0 ? 7 : 4;
        ctx.fillRect(w / 2 + Math.cos(a) * 42 - r / 2, h / 2 + Math.sin(a) * 42 - r / 2, r, r);
      }
      ctx.strokeStyle = "#3b2a1e";
      ctx.lineCap = "round";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(w / 2, h / 2);
      ctx.lineTo(w / 2 + 20, h / 2 - 16);
      ctx.stroke();
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(w / 2, h / 2);
      ctx.lineTo(w / 2 - 6, h / 2 - 38);
      ctx.stroke();
      ctx.fillStyle = "#e0475b";
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, 5, 0, Math.PI * 2);
      ctx.fill();
    },
  },
  taskboard: {
    w: 768,
    h: 400,
    draw: (ctx, w, h) => {
      rr(ctx, 0, 0, w, h, 20, "#5b3fa8");
      rr(ctx, 12, 12, w - 24, h - 24, 14, "#fbf6ff");
      ctx.fillStyle = "#3b2a1e";
      ctx.font = `900 34px ${FONT}`;
      ctx.textAlign = "left";
      ctx.fillText("Team board", 34, 58);
      ctx.fillStyle = "#9a86c4";
      ctx.font = `700 18px ${FONT}`;
      ctx.fillText("live tasks arrive soon", 230, 56);
      const cols: Array<[string, string, number]> = [
        ["To do", "#a8a2b8", 4],
        ["In progress", "#6f97cf", 3],
        ["Review", "#ffb347", 3],
        ["Done", "#6dbb8d", 4],
      ];
      const cw = (w - 60 - 3 * 14) / 4;
      cols.forEach(([title, color, n], i) => {
        const x = 30 + i * (cw + 14);
        rr(ctx, x, 80, cw, h - 104, 12, "#f1eafb");
        rr(ctx, x + 10, 92, 12, 12, 6, color);
        ctx.fillStyle = "#3b2a1e";
        ctx.font = `800 20px ${FONT}`;
        ctx.fillText(title, x + 30, 104);
        for (let k = 0; k < n; k++) {
          const y = 120 + k * 62;
          if (y + 52 > h - 30) break;
          rr(ctx, x + 10, y, cw - 20, 52, 9, "#ffffff");
          rr(ctx, x + 10, y, 6, 52, 3, color);
          ctx.fillStyle = "#cfc6de";
          ctx.fillRect(x + 26, y + 14, cw - 70 - ((k * 23 + i * 11) % 40), 7);
          ctx.fillRect(x + 26, y + 30, (cw - 70) * 0.55, 6);
          ctx.fillStyle = ["#ffb3c8", "#bfe6ff", "#d6f5c4", "#fff3a8"][(k + i) % 4];
          ctx.beginPath();
          ctx.arc(x + cw - 30, y + 26, 10, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    },
  },
  "board-overdue": {
    w: 320,
    h: 250,
    draw: (ctx, w, h) => {
      rr(ctx, 0, 0, w, h, 16, "#c95f53");
      rr(ctx, 10, 10, w - 20, h - 20, 10, "#fff6f2");
      ctx.fillStyle = "#c95f53";
      ctx.font = `900 30px ${FONT}`;
      ctx.textAlign = "left";
      ctx.fillText("Overdue", 26, 52);
      for (let k = 0; k < 4; k++) {
        rr(ctx, 26, 72 + k * 40, w - 52, 30, 8, "#ffe1dc");
        ctx.fillStyle = "#e7a59c";
        ctx.fillRect(40, 84 + k * 40, 120 + ((k * 37) % 70), 7);
      }
    },
  },
  "board-today": {
    w: 320,
    h: 250,
    draw: (ctx, w, h) => {
      rr(ctx, 0, 0, w, h, 16, "#4f8f6b");
      rr(ctx, 10, 10, w - 20, h - 20, 10, "#f4fbf3");
      ctx.fillStyle = "#4f8f6b";
      ctx.font = `900 30px ${FONT}`;
      ctx.textAlign = "left";
      ctx.fillText("Due today", 26, 52);
      for (let k = 0; k < 4; k++) {
        rr(ctx, 26, 72 + k * 40, w - 52, 30, 8, "#dcf1d6");
        ctx.fillStyle = "#9fcf98";
        ctx.fillRect(40, 84 + k * 40, 110 + ((k * 41) % 80), 7);
      }
    },
  },
  chalkboard: {
    w: 256,
    h: 160,
    draw: (ctx, w, h) => {
      ctx.fillStyle = "#3f5a4a";
      ctx.fillRect(0, 0, w, h);
      woodFrame(ctx, w, h, 10, "#a8683f");
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(70, 80, 26, 0, Math.PI * 2);
      ctx.moveTo(110, 80);
      ctx.lineTo(170, 80);
      ctx.lineTo(160, 70);
      ctx.moveTo(170, 80);
      ctx.lineTo(160, 90);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.font = `800 26px ${FONT}`;
      ctx.fillText("★", 186, 92);
    },
  },
  deskmat: {
    w: 256,
    h: 132,
    draw: (ctx, w, h) => {
      rr(ctx, 0, 0, w, h, 14, "#3f6f58");
      rr(ctx, 6, 6, w - 12, h - 12, 10, "#4f8f6b");
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = "rgba(255,246,232,0.55)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(12, 12, w - 24, h - 24, 8);
      ctx.stroke();
    },
    transparent: true,
  },
  notebook: {
    w: 240,
    h: 164,
    draw: (ctx, w, h) => {
      rr(ctx, 0, 0, w, h, 8, "#c95f53");
      for (const x0 of [8, w / 2 + 2]) {
        rr(ctx, x0, 8, w / 2 - 10, h - 16, 4, "#fffaf2");
        ctx.fillStyle = "#bfd8f0";
        for (let y = 30; y < h - 16; y += 14) ctx.fillRect(x0 + 8, y, w / 2 - 26, 1.5);
      }
      ctx.fillStyle = "rgba(59,42,30,0.55)";
      for (let l = 0; l < 6; l++) ctx.fillRect(20, 26 + l * 14, 60 + ((l * 29) % 34), 3);
      // a tiny doodle of the village on the right page
      ctx.fillStyle = "#e0715d";
      ctx.beginPath();
      ctx.moveTo(150, 90);
      ctx.lineTo(172, 70);
      ctx.lineTo(194, 90);
      ctx.fill();
      ctx.fillStyle = "#ffd166";
      ctx.fillRect(156, 90, 32, 26);
      ctx.fillStyle = "#6dbb8d";
      ctx.beginPath();
      ctx.arc(210, 100, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,0.12)";
      ctx.fillRect(w / 2 - 2, 8, 4, h - 16);
    },
  },
  pegboard: {
    w: 360,
    h: 130,
    draw: (ctx, w, h) => {
      ctx.fillStyle = "#d9b48a";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "rgba(90,60,30,0.35)";
      for (let y = 10; y < h; y += 16) for (let x = 10; x < w; x += 16) ctx.fillRect(x, y, 3, 3);
      woodFrame(ctx, w, h, 8, "#8a5a36");
      const tool = (x: number, color: string, len: number, head: number) => {
        rr(ctx, x, 22, 8, len, 3, "#8a5a36");
        rr(ctx, x - head / 2 + 4, 18, head, 14, 3, color);
      };
      tool(40, "#9aa3ad", 70, 30);
      tool(90, "#e0715d", 60, 14);
      tool(130, "#9aa3ad", 80, 18);
      tool(180, "#ffd166", 55, 26);
      ctx.strokeStyle = "#6f97cf";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(250, 60, 22, 0, Math.PI * 2);
      ctx.stroke();
      rr(ctx, 300, 24, 30, 76, 4, "#e9c99a");
    },
  },
};

function makeTexture(kind: SurfaceKind) {
  const p = PAINTERS[kind];
  const canvas = document.createElement("canvas");
  canvas.width = p.w;
  canvas.height = p.h;
  const ctx = canvas.getContext("2d")!;
  p.draw(ctx, p.w, p.h);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function SurfaceMesh({ surface }: { surface: Surface }) {
  const texture = useMemo(() => makeTexture(surface.kind), [surface.kind]);
  useEffect(() => () => texture.dispose(), [texture]);
  const transparent = PAINTERS[surface.kind].transparent ?? false;
  return (
    <mesh
      position={surface.position}
      rotation={surface.flat ? [-Math.PI / 2, 0, 0] : [0, surface.rotationY, 0]}
      receiveShadow
    >
      <planeGeometry args={surface.size} />
      <meshLambertMaterial map={texture} transparent={transparent} alphaTest={transparent ? 0.5 : 0} />
    </mesh>
  );
}

export function Surfaces({ surfaces }: { surfaces: Surface[] }) {
  return (
    <>
      {surfaces.map((s, i) => (
        <SurfaceMesh key={`${s.kind}-${i}`} surface={s} />
      ))}
    </>
  );
}
