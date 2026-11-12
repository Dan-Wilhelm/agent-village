"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  InstancedMesh,
  MeshLambertMaterial,
  Object3D,
  type Points,
} from "three";

import { mulberry32 } from "./voxels/builders";
import { motionScale, worldTime } from "./voxels/materials";
import { FOUNTAIN, POND, isWater } from "./voxels/terrain";

/**
 * Small ambient life — all instanced, a handful of draw calls in total:
 * butterflies over the meadow, a few birds circling high up, warm motes of
 * pollen in the evening light, chimney smoke, blossom petals and the fountain.
 * Everything freezes gently when the user prefers reduced motion.
 */

const tmp = new Object3D();

function Butterflies({ count = 16 }: { count?: number }) {
  const left = useRef<InstancedMesh>(null);
  const right = useRef<InstancedMesh>(null);
  const flies = useMemo(() => {
    const rand = mulberry32(17);
    const colors = ["#ffd166", "#ff9fb8", "#ffffff", "#8fd3ff", "#ffb347", "#c38bff"];
    const out: Array<{ hx: number; hz: number; r: number; speed: number; phase: number; color: string }> = [];
    while (out.length < count) {
      const hx = (rand() - 0.5) * 56;
      const hz = (rand() - 0.5) * 56;
      const d = Math.hypot(hx, hz);
      if (d < 14 || d > 30 || isWater(hx, hz)) continue;
      out.push({ hx, hz, r: 1.2 + rand() * 2.2, speed: 0.25 + rand() * 0.3, phase: rand() * 100, color: colors[out.length % colors.length] });
    }
    return out;
  }, [count]);

  useLayoutEffect(() => {
    const c = new Color();
    flies.forEach((f, i) => {
      left.current?.setColorAt(i, c.set(f.color));
      right.current?.setColorAt(i, c.set(f.color));
    });
    if (left.current?.instanceColor) left.current.instanceColor.needsUpdate = true;
    if (right.current?.instanceColor) right.current.instanceColor.needsUpdate = true;
  }, [flies]);

  useFrame(() => {
    const t = worldTime.value;
    const L = left.current;
    const R = right.current;
    if (!L || !R) return;
    flies.forEach((f, i) => {
      const a = t * f.speed + f.phase;
      const x = f.hx + Math.sin(a) * f.r + Math.sin(a * 2.3) * 0.4;
      const z = f.hz + Math.cos(a * 0.8) * f.r;
      const y = 0.7 + Math.sin(a * 3.1) * 0.25 + Math.sin(a * 0.7) * 0.2;
      const heading = Math.atan2(Math.cos(a) * f.r, -Math.sin(a * 0.8) * f.r * 0.8);
      const flap = Math.sin(t * 18 + f.phase) * 0.9 * motionScale.value + 0.3;
      for (const [mesh, side] of [
        [L, -1],
        [R, 1],
      ] as const) {
        tmp.position.set(x, y, z);
        tmp.rotation.set(0, heading, side * flap, "YXZ");
        tmp.translateX(side * 0.055);
        tmp.updateMatrix();
        mesh.setMatrixAt(i, tmp.matrix);
      }
    });
    L.instanceMatrix.needsUpdate = true;
    R.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <instancedMesh ref={left} args={[undefined, undefined, flies.length]} frustumCulled={false}>
        <boxGeometry args={[0.11, 0.012, 0.09]} />
        <meshBasicMaterial />
      </instancedMesh>
      <instancedMesh ref={right} args={[undefined, undefined, flies.length]} frustumCulled={false}>
        <boxGeometry args={[0.11, 0.012, 0.09]} />
        <meshBasicMaterial />
      </instancedMesh>
    </>
  );
}

function Birds({ count = 6 }: { count?: number }) {
  const wings = useRef<InstancedMesh>(null);
  const birds = useMemo(() => {
    const rand = mulberry32(23);
    return Array.from({ length: count }, (_, i) => ({
      radius: 24 + rand() * 14,
      height: 22 + rand() * 6,
      speed: 0.08 + rand() * 0.03,
      phase: (i / count) * 0.9 + rand() * 0.2,
      flap: rand() * 10,
    }));
  }, [count]);

  useFrame(() => {
    const t = worldTime.value;
    const m = wings.current;
    if (!m) return;
    birds.forEach((b, i) => {
      const a = t * b.speed + b.phase;
      const x = Math.cos(a) * b.radius;
      const z = Math.sin(a) * b.radius - 4;
      const flap = Math.sin(t * 7 + b.flap) * 0.6 * motionScale.value;
      for (const side of [-1, 1]) {
        tmp.position.set(x, b.height + Math.sin(t + b.flap) * 0.6, z);
        tmp.rotation.set(0, -a, side * (0.25 + flap), "YXZ");
        tmp.translateX(side * 0.28);
        tmp.updateMatrix();
        m.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), tmp.matrix);
      }
    });
    m.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={wings} args={[undefined, undefined, count * 2]} frustumCulled={false}>
      <boxGeometry args={[0.55, 0.05, 0.22]} />
      <meshBasicMaterial color="#4a3b4f" />
    </instancedMesh>
  );
}

function glowSprite() {
  const c = document.createElement("canvas");
  c.width = 32;
  c.height = 32;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, "rgba(255,240,200,1)");
  g.addColorStop(0.35, "rgba(255,210,130,0.6)");
  g.addColorStop(1, "rgba(255,200,120,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  return new CanvasTexture(c);
}

/** Warm pollen motes / early fireflies drifting near the pond, the garden and the plaza. */
function Motes({ count = 64 }: { count?: number }) {
  const ref = useRef<Points>(null);
  const sprite = useMemo(() => glowSprite(), []);
  const base = useMemo(() => {
    const rand = mulberry32(31);
    const centers = [
      [POND.x, POND.z, 6],
      [-10, 22, 4],
      [FOUNTAIN.x, FOUNTAIN.z, 4],
      [9.5, 13.75, 4],
    ];
    const base = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      const [cx, cz, r] = centers[i % centers.length];
      base[i * 4] = cx + (rand() - 0.5) * r * 2;
      base[i * 4 + 1] = 0.4 + rand() * 2.2;
      base[i * 4 + 2] = cz + (rand() - 0.5) * r * 2;
      base[i * 4 + 3] = rand() * 100;
    }
    return base;
  }, [count]);
  const initial = useMemo(() => new Float32Array(count * 3), [count]);

  useFrame(() => {
    const t = worldTime.value;
    const p = ref.current;
    if (!p) return;
    const attr = p.geometry.attributes.position;
    const positions = attr.array as Float32Array;
    for (let i = 0; i < count; i++) {
      const ph = base[i * 4 + 3];
      positions[i * 3] = base[i * 4] + Math.sin(t * 0.3 + ph) * 0.6;
      positions[i * 3 + 1] = base[i * 4 + 1] + Math.sin(t * 0.5 + ph * 2) * 0.3;
      positions[i * 3 + 2] = base[i * 4 + 2] + Math.cos(t * 0.25 + ph) * 0.6;
    }
    attr.needsUpdate = true;
  });

  return (
    <points ref={ref} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[initial, 3]} />
      </bufferGeometry>
      <pointsMaterial
        map={sprite}
        size={0.09}
        sizeAttenuation
        transparent
        depthWrite={false}
        blending={AdditiveBlending}
        color={new Color(2.2, 1.8, 1.1)}
        toneMapped={false}
      />
    </points>
  );
}

const PUFFS = 7;
const smokeMaterial = new MeshLambertMaterial({ color: "#f4efe9", transparent: true, opacity: 0.75, depthWrite: false });

/** Gentle smoke puffs rising from every chimney. */
function Smoke({ sources }: { sources: Array<[number, number, number]> }) {
  const ref = useRef<InstancedMesh>(null);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const t = worldTime.value * 0.35;
    sources.forEach(([x, y, z], s) => {
      for (let k = 0; k < PUFFS; k++) {
        const life = (t + k / PUFFS + s * 0.37) % 1;
        const size = 0.25 + Math.sin(life * Math.PI) * 0.45;
        tmp.position.set(x + Math.sin(life * 5 + k) * 0.25 + life * 1.2, y + life * 4, z + Math.cos(life * 4 + k) * 0.2);
        tmp.rotation.set(life * 2, life * 3 + k, 0);
        tmp.scale.setScalar(size * (life > 0.85 ? (1 - life) / 0.15 : 1));
        tmp.updateMatrix();
        m.setMatrixAt(s * PUFFS + k, tmp.matrix);
      }
    });
    m.instanceMatrix.needsUpdate = true;
    tmp.scale.setScalar(1);
  });
  if (sources.length === 0) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, smokeMaterial, sources.length * PUFFS]} frustumCulled={false}>
      <boxGeometry args={[0.5, 0.5, 0.5]} />
    </instancedMesh>
  );
}

/** Blossom petals drifting down around the pink trees. */
function Petals({ trees }: { trees: Array<{ x: number; z: number; top: number }> }) {
  const ref = useRef<InstancedMesh>(null);
  const per = 10;
  const seeds = useMemo(() => {
    const rand = mulberry32(41);
    return trees.flatMap(() => Array.from({ length: per }, () => [rand(), rand(), rand(), rand()]));
  }, [trees]);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const t = worldTime.value;
    trees.forEach((tr, ti) => {
      for (let k = 0; k < per; k++) {
        const [a, b, c, ph] = seeds[ti * per + k];
        const life = (t * (0.06 + a * 0.04) + ph) % 1;
        const r = 1 + b * 2.4;
        const ang = c * Math.PI * 2 + life * 2;
        tmp.position.set(tr.x + Math.cos(ang) * r + life * 1.5, tr.top * (1 - life), tr.z + Math.sin(ang) * r);
        tmp.rotation.set(t * 2 + ph * 10, t * 1.3 + a * 10, t + b * 5);
        tmp.updateMatrix();
        m.setMatrixAt(ti * per + k, tmp.matrix);
      }
    });
    m.instanceMatrix.needsUpdate = true;
  });
  if (trees.length === 0) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, trees.length * per]} frustumCulled={false}>
      <boxGeometry args={[0.08, 0.01, 0.08]} />
      <meshBasicMaterial color="#ffc6d6" />
    </instancedMesh>
  );
}

/** Water droplets arcing out of the fountain's top bowl. */
function FountainSpray() {
  const ref = useRef<InstancedMesh>(null);
  const n = 24;
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const t = worldTime.value;
    for (let k = 0; k < n; k++) {
      const life = (t * 0.7 + k / n) % 1;
      const ang = (k / n) * Math.PI * 2 * 3;
      const r = 0.2 + life * 0.75;
      const y = 2.85 + life * 0.5 - life * life * 2.4;
      tmp.position.set(FOUNTAIN.x - 0.125 + Math.cos(ang) * r, Math.max(y, 0.4), FOUNTAIN.z - 0.125 + Math.sin(ang) * r);
      tmp.rotation.set(0, 0, 0);
      tmp.updateMatrix();
      m.setMatrixAt(k, tmp.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, n]} frustumCulled={false}>
      <boxGeometry args={[0.07, 0.07, 0.07]} />
      <meshBasicMaterial color="#e6f7ff" transparent opacity={0.85} />
    </instancedMesh>
  );
}

export function Ambient({
  chimneys,
  blossoms,
}: {
  chimneys: Array<[number, number, number]>;
  blossoms: Array<{ x: number; z: number; top: number }>;
}) {
  return (
    <>
      <Butterflies />
      <Birds />
      <Motes />
      <Smoke sources={chimneys} />
      <Petals trees={blossoms} />
      <FountainSpray />
    </>
  );
}
