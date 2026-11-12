/**
 * Shared materials for all voxel meshes. One material per look keeps the
 * shader count tiny; everything reads color from vertex colors and surface
 * detail from the procedural atlas.
 */
import { Color, MeshBasicMaterial, MeshLambertMaterial, type Material } from "three";

import { getAtlasTexture } from "./atlas";

/** Global animation clock, advanced once per frame by the scene. */
export const worldTime = { value: 0 };
/** 0 when the user prefers reduced motion (ambient swaying stops), 1 otherwise. */
export const motionScale = { value: 1 };

const cache = new Map<string, Material>();

function memo<T extends Material>(key: string, make: () => T): T {
  let m = cache.get(key) as T | undefined;
  if (!m) {
    m = make();
    cache.set(key, m);
  }
  return m;
}

/** Opaque voxel surface. `sway` > 0 makes vertices wave gently with height (leaves, grass). */
export function voxelMaterial(sway = 0): MeshLambertMaterial {
  return memo(`solid:${sway}`, () => {
    const m = new MeshLambertMaterial({ vertexColors: true, map: getAtlasTexture() });
    if (sway > 0) {
      m.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = worldTime;
        shader.uniforms.uMotion = motionScale;
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nuniform float uTime;\nuniform float uMotion;")
          .replace(
            "#include <begin_vertex>",
            `#include <begin_vertex>
            float swayH = max(position.y, 0.0);
            float ph = position.x * 0.45 + position.z * 0.35;
            transformed.x += sin(uTime * 1.7 + ph) * ${sway.toFixed(4)} * swayH * uMotion;
            transformed.z += cos(uTime * 1.3 + ph * 1.3) * ${(sway * 0.7).toFixed(4)} * swayH * uMotion;`,
          );
      };
      m.customProgramCacheKey = () => `voxel-sway-${sway}`;
    }
    return m;
  });
}

/** Self-lit voxels (lantern glass, lamp shades, glowing windows). Values > 1 feed the bloom. */
export function glowMaterial(intensity = 2.4): MeshBasicMaterial {
  return memo(`glow:${intensity}`, () => {
    const m = new MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    m.color = new Color(intensity, intensity, intensity);
    return m;
  });
}

/** See-through window glass: lets sunlight and the view through, with a faint tint. */
export function glassMaterial(): MeshLambertMaterial {
  return memo("glass", () => {
    const m = new MeshLambertMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    });
    m.emissive = new Color("#ffe2b0");
    m.emissiveIntensity = 0.08;
    return m;
  });
}

/** Clouds: lit like the voxels, but not swallowed by the distance fog. */
export function cloudMaterial(): MeshLambertMaterial {
  return memo("cloud", () => {
    const m = new MeshLambertMaterial({ vertexColors: true, fog: false, transparent: true, opacity: 0.94 });
    m.emissive = new Color("#fff4ec");
    m.emissiveIntensity = 0.6;
    return m;
  });
}
