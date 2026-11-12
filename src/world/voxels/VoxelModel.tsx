"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { Color, InstancedMesh, Object3D } from "three";

import { VOXEL, type Voxel } from "./builders";

interface VoxelModelProps {
  voxels: Voxel[];
  /** Per-axis scale of each cube relative to VOXEL (e.g. flat tiles). */
  scale?: [number, number, number];
  /** Vertical offset added to every voxel. */
  yOffset?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
}

const UNIT_SCALE: [number, number, number] = [1, 1, 1];

/** Renders many colored cubes in ONE draw call via an InstancedMesh. */
export function VoxelModel({
  voxels,
  scale = UNIT_SCALE,
  yOffset = 0,
  castShadow = true,
  receiveShadow = true,
}: VoxelModelProps) {
  const ref = useRef<InstancedMesh>(null);
  const count = voxels.length;
  const tmp = useMemo(() => new Object3D(), []);
  const color = useMemo(() => new Color(), []);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    voxels.forEach((v, i) => {
      tmp.position.set(v.x, v.y + yOffset, v.z);
      tmp.scale.set(scale[0], scale[1], scale[2]);
      tmp.updateMatrix();
      mesh.setMatrixAt(i, tmp.matrix);
      mesh.setColorAt(i, color.set(v.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [voxels, scale, yOffset, tmp, color]);

  if (count === 0) return null;
  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, count]}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
    >
      <boxGeometry args={[VOXEL, VOXEL, VOXEL]} />
      <meshLambertMaterial />
    </instancedMesh>
  );
}
