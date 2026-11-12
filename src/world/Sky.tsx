"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { BackSide, Color, Group, ShaderMaterial, Vector3 } from "three";

import { meshVoxels, type MeshVoxel } from "./voxels/mesher";
import { mulberry32 } from "./voxels/builders";
import { cloudMaterial, motionScale } from "./voxels/materials";

/** Direction towards the sun: low in the west-south-west, warm golden hour. */
export const SUN_DIR = new Vector3(-0.72, 0.46, 0.52).normalize();
export const SKY_TOP = "#7fb6ea";
export const SKY_HORIZON = "#ffd9b0";
export const FOG_COLOR = "#f6d6b4";

/** Gradient sky dome with a soft sun glow. Rendered behind everything, ignores fog. */
export function SkyDome() {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        side: BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uTop: { value: new Color(SKY_TOP) },
          uHorizon: { value: new Color(SKY_HORIZON) },
          uBottom: { value: new Color(FOG_COLOR) },
          uSun: { value: SUN_DIR.clone() },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_Position = p.xyww;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uTop;
          uniform vec3 uHorizon;
          uniform vec3 uBottom;
          uniform vec3 uSun;
          varying vec3 vDir;
          void main() {
            float h = vDir.y;
            vec3 col = mix(uHorizon, uTop, smoothstep(0.0, 0.55, h));
            col = mix(col, uBottom, smoothstep(0.02, -0.12, h));
            float s = max(dot(normalize(vDir), uSun), 0.0);
            col += vec3(1.0, 0.78, 0.5) * pow(s, 12.0) * 0.3;   // wide warm halo
            col += vec3(1.0, 0.9, 0.7) * smoothstep(0.9988, 0.9994, s) * 1.2; // sun disc
            gl_FragColor = vec4(col, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    [],
  );
  return (
    <mesh material={material} renderOrder={-10} frustumCulled={false}>
      <sphereGeometry args={[240, 32, 16]} />
    </mesh>
  );
}

/** Puffy voxel clouds that drift slowly across the sky and wrap around. */
export function Clouds() {
  const clouds = useMemo(() => {
    const rand = mulberry32(5);
    return Array.from({ length: 14 }, (_, i) => {
      const vox: MeshVoxel[] = [];
      const size = 1.5;
      const blobs = 4 + Math.floor(rand() * 4);
      const len = 10 + rand() * 12;
      for (let b = 0; b < blobs; b++) {
        const bx = (b / (blobs - 1) - 0.5) * len;
        const r = 2.6 + rand() * 2.6 - Math.abs(bx) * 0.12;
        const bz = (rand() - 0.5) * 3;
        for (let x = -r; x <= r; x += size) {
          for (let y = 0; y <= r; y += size) {
            for (let z = -r; z <= r; z += size) {
              if (Math.hypot(x, y * 2.0, z * 0.85) > r) continue;
              const px = Math.round((bx + x) / size) * size;
              const py = Math.round(y / size) * size;
              const pz = Math.round((z + bz) / size) * size;
              vox.push({ x: px, y: py, z: pz, color: py > 0 ? "#ffffff" : "#f1eef6", tex: "plain" });
            }
          }
        }
      }
      const unique = new Map(vox.map((v) => [`${v.x}|${v.y}|${v.z}`, v]));
      const geo = meshVoxels([...unique.values()], { size, jitter: 0.015, ao: 0.35 }).solid!;
      const angle = (i / 14) * Math.PI * 2 + rand() * 0.3;
      const dist = 75 + rand() * 80;
      return {
        geo,
        x: Math.cos(angle) * dist,
        z: Math.sin(angle) * dist,
        y: 55 + rand() * 16,
        speed: 0.6 + rand() * 0.5,
      };
    });
  }, []);
  const refs = useRef<Array<Group | null>>([]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1) * motionScale.value;
    clouds.forEach((c, i) => {
      c.x += c.speed * dt;
      if (c.x > 130) c.x -= 260;
      const g = refs.current[i];
      if (g) g.position.set(c.x, c.y, c.z);
    });
  });

  return (
    <>
      {clouds.map((c, i) => (
        <group
          key={i}
          ref={(g) => {
            refs.current[i] = g;
          }}
          position={[c.x, c.y, c.z]}
        >
          <mesh geometry={c.geo} material={cloudMaterial()} />
        </group>
      ))}
    </>
  );
}
