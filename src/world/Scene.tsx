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
const FLOWER_SCALE: [number, number, number] = [0.22, 0.3, 0.22];

export default function Scene() {
  return (
    <KeyboardControls map={KEYMAP as unknown as { name: string; keys: string[] }[]}>
      <Canvas
        shadows="percentage"
        dpr={[1, 1.75]}
        camera={{ fov: 70, near: 0.1, far: 260, position: [PLAYER_SPAWN.x, 1.6, PLAYER_SPAWN.z] }}
        onPointerMissed={() => sceneBridge.lock()}
        aria-label="Agent Village 3D world"
      >
        <color attach="background" args={["#cfe9ff"]} />
        <fog attach="fog" args={["#cfe9ff", 45, 120]} />
        <Sky sunPosition={[100, 60, 40]} turbidity={3} rayleigh={1.1} mieCoefficient={0.004} />
        {/* warm bounce light (a green ground color made interiors look dull) */}
        <hemisphereLight args={["#e6f4ff", "#f1d9b5", 1.15]} />
        <ambientLight intensity={0.35} color="#fff1dc" />
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
          {/* agents sit inside Physics so their labels can raycast against walls */}
          <Agents />
        </Physics>
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
      <VoxelModel voxels={decorations.flowers} scale={FLOWER_SCALE} yOffset={0.075} castShadow={false} />
      <VoxelModel voxels={decorations.trees} />

      {houses.map(({ def, voxels }) => (
        <group key={def.id}>
          <VoxelModel voxels={voxels} />
          <Floor def={def} />
          <Ceiling def={def} />
          <BuildingSign def={def} />
        </group>
      ))}
      <VoxelModel voxels={field.voxels} />
      <BuildingSign def={field.def} />
      <VoxelModel voxels={desk.voxels} />
      <DeskProps />
    </>
  );
}

/** Flat ceiling at wall height so the inside feels like a cozy room, not an attic. */
function Ceiling({ def }: { def: BuildingDef }) {
  return (
    <mesh rotation={[Math.PI / 2, 0, 0]} position={[def.center.x, def.wallHeight - 0.01, def.center.z]}>
      <planeGeometry args={[def.size.x - 0.5, def.size.z - 0.5]} />
      <meshLambertMaterial color={PALETTE.plasterWarm} />
    </mesh>
  );
}

/** Small plant and lamp at the desk's back corners (below eye level). */
function DeskProps() {
  const top = DESK.height + 0.1;
  return (
    <group>
      <group position={[DESK.x - DESK.width / 2 + 0.25, top, DESK.z - 0.3]}>
        <mesh position={[0, 0.09, 0]} castShadow>
          <boxGeometry args={[0.2, 0.18, 0.2]} />
          <meshLambertMaterial color={PALETTE.trunk} />
        </mesh>
        <mesh position={[0, 0.3, 0]} castShadow>
          <boxGeometry args={[0.3, 0.26, 0.3]} />
          <meshLambertMaterial color={PALETTE.leafLight} />
        </mesh>
      </group>
      <group position={[DESK.x + DESK.width / 2 - 0.25, top, DESK.z - 0.3]}>
        <mesh position={[0, 0.03, 0]}>
          <boxGeometry args={[0.22, 0.06, 0.22]} />
          <meshLambertMaterial color={PALETTE.woodDark} />
        </mesh>
        <mesh position={[0, 0.22, 0]}>
          <boxGeometry args={[0.05, 0.34, 0.05]} />
          <meshLambertMaterial color={PALETTE.woodDark} />
        </mesh>
        <mesh position={[0, 0.42, 0]}>
          <boxGeometry args={[0.26, 0.16, 0.26]} />
          <meshBasicMaterial color={PALETTE.lantern} />
        </mesh>
      </group>
    </group>
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
  const [x, , z] = pos[def.door];
  return (
    <group>
      <Sign title={def.name} subtitle={def.subtitle} position={pos[def.door]} rotationY={FACING_ROTATION[def.door]} />
      {def.kind === "field" &&
        [-1, 1].map((side) => {
          // two posts under the free-standing field sign, offset along the sign's width
          const alongX = def.door === "north" || def.door === "south";
          const px = alongX ? x + side * 1.1 : x + 0.05;
          const pz = alongX ? z + 0.05 : z + side * 1.1;
          return (
            <mesh key={side} position={[px, (y - 0.4) / 2, pz]} castShadow>
              <boxGeometry args={[0.12, y - 0.4, 0.12]} />
              <meshLambertMaterial color={PALETTE.woodDark} />
            </mesh>
          );
        })}
    </group>
  );
}
