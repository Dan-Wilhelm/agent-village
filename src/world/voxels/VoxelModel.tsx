"use client";

import { useEffect, useMemo } from "react";

import { meshVoxels, type MeshVoxel } from "./mesher";
import { glassMaterial, glowMaterial, voxelMaterial } from "./materials";
import { VOXEL } from "./builders";

interface VoxelModelProps {
  voxels: MeshVoxel[];
  /** Edge length of the cubes in this model (default: the 0.5 m world voxel). */
  size?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
  /** Gentle wind sway amount (leaves ≈ 0.02, grass ≈ 0.12). */
  sway?: number;
  jitter?: number;
  ao?: number;
  skipBottom?: boolean;
  glow?: number;
}

/**
 * Renders a voxel list as merged, face-culled geometry with baked ambient
 * occlusion: one draw call per material (solid / glow / glass).
 */
export function VoxelModel({
  voxels,
  size = VOXEL,
  castShadow = true,
  receiveShadow = true,
  sway = 0,
  jitter,
  ao,
  skipBottom,
  glow = 2.4,
}: VoxelModelProps) {
  const geo = useMemo(
    () => meshVoxels(voxels, { size, jitter, ao, skipBottom }),
    [voxels, size, jitter, ao, skipBottom],
  );
  useEffect(
    () => () => {
      geo.solid?.dispose();
      geo.glow?.dispose();
      geo.glass?.dispose();
    },
    [geo],
  );

  return (
    <>
      {geo.solid && (
        <mesh
          geometry={geo.solid}
          material={voxelMaterial(sway)}
          castShadow={castShadow}
          receiveShadow={receiveShadow}
        />
      )}
      {geo.glow && <mesh geometry={geo.glow} material={glowMaterial(glow)} />}
      {geo.glass && <mesh geometry={geo.glass} material={glassMaterial()} renderOrder={2} />}
    </>
  );
}
