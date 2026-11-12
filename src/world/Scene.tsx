"use client";

import { useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { KeyboardControls, Sky } from "@react-three/drei";
import { CuboidCollider, Physics, RigidBody } from "@react-three/rapier";

import { AgentCharacter } from "./AgentCharacter";
import { KEYMAP, sceneBridge } from "./controls";
import { BUILDINGS, DESK, DOOR_HEIGHT, PLAYER_SPAWN, type BuildingDef, type Facing } from "./layout";
import { stepMovers } from "./movement";
import { PALETTE } from "./palette";
import { Player } from "./Player";
import { Sign } from "./Sign";
import { useVillage } from "./store";
import {
  buildDecorations,
  buildDesk,
  buildField,
  buildHouse,
  buildingColliders,
  buildPathTiles,
  type BoxCollider,
} from "./voxels/builders";
import { VoxelModel } from "./voxels/VoxelModel";

const FACING_ROTATION: Record<Facing, number> = {
  south: 0,
  north: Math.PI,
  east: Math.PI / 2,
  west: -Math.PI / 2,
};

const PATH_SCALE: [number, number, number] = [1, 0.12, 1];
const FLOWER_SCALE: [number, number, number] = [0.35, 0.5, 0.35];

export default function Scene() {
  return (
    <KeyboardControls map={KEYMAP as unknown as { name: string; keys: string[] }[]}>
      <Canvas
        shadows
        dpr={[1, 1.75]}
        camera={{ fov: 70, near: 0.1, far: 260, position: [PLAYER_SPAWN.x, 1.6, PLAYER_SPAWN.z] }}
        onPointerMissed={() => sceneBridge.lock()}
        aria-label="Agent Village 3D world"
      >
        <color attach="background" args={["#cfe9ff"]} />
        <fog attach="fog" args={["#cfe9ff", 45, 120]} />
        <Sky sunPosition={[100, 60, 40]} turbidity={3} rayleigh={1.1} mieCoefficient={0.004} />
        <hemisphereLight args={["#dff1ff", "#8fd17a", 1.1]} />
        <directionalLight
          castShadow
          position={[25, 40, 18]}
          intensity={1.7}
          color="#fff4e0"
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-45}
          shadow-camera-right={45}
          shadow-camera-top={45}
          shadow-camera-bottom={-45}
          shadow-camera-far={120}
          shadow-bias={-0.0006}
        />
        {/* warm desk lamp glow in the office */}
        <pointLight position={[DESK.x + 1, 2.2, DESK.z]} intensity={6} distance={9} color="#ffcf8a" />

        <Physics gravity={[0, -20, 0]}>
          <World />
          <Player />
        </Physics>
        <Agents />
        <AgentSystem />
      </Canvas>
    </KeyboardControls>
  );
}

function AgentSystem() {
  useFrame((_, delta) => stepMovers(delta));
  return null;
}

function Agents() {
  const agents = useVillage((s) => s.agents);
  return (
    <>
      {Object.values(agents).map((a) => (
        <AgentCharacter key={a.id} agent={a} />
      ))}
    </>
  );
}

function World() {
  const { houses, field, desk, paths, decorations, colliders } = useMemo(() => {
    const defs = Object.values(BUILDINGS);
    const houses = defs.filter((b) => b.kind === "house").map((b) => ({ def: b, voxels: buildHouse(b) }));
    const fieldDef = defs.find((b) => b.kind === "field")!;
    const desk = buildDesk();
    const decorations = buildDecorations();
    const colliders: BoxCollider[] = [
      ...defs.flatMap(buildingColliders),
      desk.collider,
      ...decorations.treeColliders,
    ];
    return {
      houses,
      field: { def: fieldDef, voxels: buildField(fieldDef) },
      desk,
      paths: buildPathTiles(),
      decorations,
      colliders,
    };
  }, []);

  return (
    <>
      {/* ground */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[80, 0.5, 80]} position={[0, -0.5, 0]} />
        {colliders.map((c, i) => (
          <CuboidCollider key={i} args={c.halfExtents} position={c.center} />
        ))}
      </RigidBody>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[160, 160]} />
        <meshLambertMaterial color={PALETTE.grass} />
      </mesh>

      <VoxelModel voxels={paths} scale={PATH_SCALE} yOffset={0.03} castShadow={false} />
      <VoxelModel voxels={decorations.flowers} scale={FLOWER_SCALE} yOffset={0.125} castShadow={false} />
      <VoxelModel voxels={decorations.trees} />

      {houses.map(({ def, voxels }) => (
        <group key={def.id}>
          <VoxelModel voxels={voxels} />
          <Floor def={def} />
          <BuildingSign def={def} />
        </group>
      ))}
      <VoxelModel voxels={field.voxels} />
      <BuildingSign def={field.def} />
      <VoxelModel voxels={desk.voxels} />
    </>
  );
}

function Floor({ def }: { def: BuildingDef }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[def.center.x, 0.02, def.center.z]} receiveShadow>
      <planeGeometry args={[def.size.x - 0.5, def.size.z - 0.5]} />
      <meshLambertMaterial color={def.id === "hq" ? "#d9c3f0" : PALETTE.woodLight} />
    </mesh>
  );
}

function BuildingSign({ def }: { def: BuildingDef }) {
  const hx = def.size.x / 2;
  const hz = def.size.z / 2;
  const out = 0.3;
  const y = def.kind === "field" ? 1.9 : DOOR_HEIGHT + 1.0;
  const along = def.kind === "field" ? 2.2 : 0; // field: sign beside the gate
  const pos: Record<Facing, [number, number, number]> = {
    north: [def.center.x + along, y, def.center.z - hz - out],
    south: [def.center.x + along, y, def.center.z + hz + out],
    west: [def.center.x - hx - out, y, def.center.z + along],
    east: [def.center.x + hx + out, y, def.center.z + along],
  };
  return <Sign title={def.name} subtitle={def.subtitle} position={pos[def.door]} rotationY={FACING_ROTATION[def.door]} />;
}
