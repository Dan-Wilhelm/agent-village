"use client";

import { useMemo } from "react";
import { Color, MeshLambertMaterial } from "three";

import { worldTime } from "./voxels/materials";
import { FOUNTAIN, POND } from "./voxels/terrain";

/** Lambert water with drifting ripples and sun glints (lit, fogged and shadowed like everything else). */
function useWaterMaterial(color: string, scale: number) {
  return useMemo(() => {
    const m = new MeshLambertMaterial({ color, transparent: true, opacity: 0.86 });
    m.emissive = new Color("#2a5f6a");
    m.emissiveIntensity = 0.15;
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = worldTime;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vWPos;")
        .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uTime;\nvarying vec3 vWPos;")
        .replace(
          "#include <emissivemap_fragment>",
          `#include <emissivemap_fragment>
          vec2 q = vWPos.xz * ${scale.toFixed(2)};
          float w1 = sin(q.x * 2.3 + uTime * 1.1) * sin(q.y * 1.9 - uTime * 0.9);
          float w2 = sin((q.x + q.y) * 3.1 - uTime * 1.6);
          float ripple = w1 * 0.6 + w2 * 0.4;
          diffuseColor.rgb *= 0.92 + ripple * 0.08;
          float glint = smoothstep(0.82, 0.97, ripple);
          totalEmissiveRadiance += vec3(1.0, 0.92, 0.75) * glint * 0.55;`,
        );
    };
    m.customProgramCacheKey = () => `water-${scale}`;
    return m;
  }, [color, scale]);
}

export function Water() {
  const pond = useWaterMaterial("#5fb2c4", 1);
  const fountain = useWaterMaterial("#7fd0e6", 2.5);
  return (
    <>
      {/* one plane under the whole pond + stream area: the grass voxels hide it everywhere else */}
      <mesh material={pond} rotation={[-Math.PI / 2, 0, 0]} position={[POND.x - 4, -0.16, POND.z - 9]} receiveShadow>
        <planeGeometry args={[26, 36]} />
      </mesh>
      <mesh material={fountain} rotation={[-Math.PI / 2, 0, 0]} position={[FOUNTAIN.x, 0.55, FOUNTAIN.z]} receiveShadow>
        <circleGeometry args={[1.72, 32]} />
      </mesh>
    </>
  );
}
