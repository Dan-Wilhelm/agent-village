"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { KeyboardControls, PerformanceMonitor } from "@react-three/drei";
import { CuboidCollider, Physics, RigidBody } from "@react-three/rapier";
import { Bloom, BrightnessContrast, EffectComposer, HueSaturation, ToneMapping, Vignette } from "@react-three/postprocessing";

import { AgentCharacter } from "./AgentCharacter";
import { Ambient } from "./Ambient";
import { KEYMAP, sceneBridge } from "./controls";
import { BUILDINGS, DOOR_HEIGHT, PLAYER_SPAWN, type BuildingDef, type Facing } from "./layout";
import { stepMovers } from "./movement";
import { Player } from "./Player";
import { Sign } from "./Sign";
import { Clouds, FOG_COLOR, SkyDome, SUN_DIR } from "./Sky";
import { useVillage } from "./store";
import { Surfaces } from "./Surfaces";
import { Water } from "./Water";
import { debugView } from "./debug";
import { DETAIL, FINE } from "./voxels/builders";
import { motionScale, worldTime } from "./voxels/materials";
import { VoxelModel } from "./voxels/VoxelModel";
import { PLANT } from "./voxels/terrain";
import { buildVillage } from "./voxels/world";

const FACING_ROTATION: Record<Facing, number> = {
  south: 0,
  north: Math.PI,
  east: Math.PI / 2,
  west: -Math.PI / 2,
};

/** postprocessing's ToneMappingMode.NEUTRAL (Khronos PBR Neutral keeps the pastel palette true). */
const TONE_NEUTRAL = 8;

type Quality = "high" | "low";

export default function Scene() {
  const [quality, setQuality] = useState<Quality>("high");
  return (
    <KeyboardControls map={KEYMAP as unknown as { name: string; keys: string[] }[]}>
      <Canvas
        shadows="percentage"
        dpr={quality === "high" ? [1, 1.75] : 1}
        gl={{ antialias: false, powerPreference: "high-performance", stencil: false }}
        camera={{ fov: 70, near: 0.1, far: 260, position: [PLAYER_SPAWN.x, 1.6, PLAYER_SPAWN.z] }}
        onPointerMissed={() => sceneBridge.lock()}
        aria-label="Agent Village 3D world"
      >
        {/* drop to a lighter pipeline if the machine can't hold the frame rate */}
        <PerformanceMonitor bounds={() => [32, 240]} onDecline={() => setQuality("low")} flipflops={1} />
        <color attach="background" args={[FOG_COLOR]} />
        <fog attach="fog" args={[FOG_COLOR, 38, 105]} />
        <SkyDome />
        <Clouds />
        <Lights />

        <Physics gravity={[0, -20, 0]}>
          <World />
          <Player />
          {/* agents sit inside Physics so their labels can raycast against walls */}
          <Agents />
        </Physics>
        <AgentSystem />
        <Effects quality={quality} />
        {process.env.NODE_ENV === "development" && <DevStats />}
      </Canvas>
    </KeyboardControls>
  );
}

function Lights() {
  const sun = useMemo(() => SUN_DIR.clone().multiplyScalar(70), []);
  return (
    <>
      {/* sky-blue from above, warm earth bounce from below */}
      <hemisphereLight args={["#cfe2ff", "#e9c7a0", 1.15]} />
      <ambientLight intensity={0.25} color="#ffe6c8" />
      <directionalLight
        castShadow
        position={[sun.x, sun.y, sun.z + 4]}
        intensity={2.6}
        color="#ffd7a3"
        shadow-mapSize={[4096, 4096]}
        shadow-camera-left={-46}
        shadow-camera-right={46}
        shadow-camera-top={46}
        shadow-camera-bottom={-46}
        shadow-camera-near={1}
        shadow-camera-far={160}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
        shadow-radius={3}
      >
        <object3D attach="target" position={[0, 0, 4]} />
      </directionalLight>
      {/* cool rim light from the opposite side gives the blocks shape */}
      <directionalLight position={[40, 30, -50]} intensity={0.35} color="#b9d4ff" />
    </>
  );
}

function Effects({ quality }: { quality: Quality }) {
  return (
    // Ambient occlusion is baked into the voxel meshes (see mesher.ts), so no SSAO pass is needed.
    <EffectComposer multisampling={quality === "high" ? 4 : 0} enableNormalPass={false}>
      <Bloom mipmapBlur intensity={0.6} luminanceThreshold={0.95} luminanceSmoothing={0.25} radius={0.75} />
      <HueSaturation saturation={0.1} />
      <BrightnessContrast brightness={0.02} contrast={0.08} />
      <ToneMapping mode={TONE_NEUTRAL} />
      <Vignette offset={0.28} darkness={0.42} />
    </EffectComposer>
  );
}

/** Advances the shared clock (shaders, ambient life) and the agent movers. */
function AgentSystem() {
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      motionScale.value = mq.matches ? 0 : 1;
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  useFrame((_, delta) => {
    stepMovers(delta);
    // with reduced motion, ambient life slows to a gentle drift instead of stopping dead
    worldTime.value += Math.min(delta, 0.1) * (motionScale.value > 0 ? 1 : 0.2);
  });
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
  const village = useMemo(() => buildVillage(), []);
  const colliders = useMemo(
    () => [...village.wallColliders, ...village.propColliders, ...village.boundary],
    [village],
  );

  return (
    <>
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[90, 0.5, 90]} position={[0, -0.5, 0]} />
        {colliders.map((c, i) => (
          <CuboidCollider key={i} args={c.halfExtents} position={c.center} />
        ))}
      </RigidBody>

      {/* terrain */}
      <VoxelModel voxels={village.ground} castShadow={false} skipBottom jitter={0.035} ao={0.8} />
      <VoxelModel voxels={village.hills} size={1} castShadow={false} skipBottom jitter={0.05} />
      <Water />

      {/* nature */}
      <VoxelModel voxels={village.trees} sway={0.012} jitter={0.05} />
      <VoxelModel voxels={village.hillTrees} sway={0.01} castShadow={false} jitter={0.05} />
      <VoxelModel voxels={village.bushes} size={DETAIL} sway={0.025} jitter={0.06} />
      <VoxelModel voxels={village.rocks} size={DETAIL} jitter={0.06} />
      <VoxelModel voxels={village.plants} size={PLANT} sway={0.18} castShadow={false} jitter={0.08} ao={0.4} />

      {/* buildings, facade details, props, furniture */}
      <VoxelModel voxels={village.houses} jitter={0.03} />
      <VoxelModel voxels={village.detail} size={DETAIL} jitter={0.035} />
      <VoxelModel voxels={village.fine} size={FINE} jitter={0.02} ao={0.6} />
      <Surfaces surfaces={village.interiors.surfaces} />
      {village.interiors.lights.map((l, i) => (
        <pointLight key={i} position={l.position} color={l.color} intensity={l.intensity} distance={l.distance} decay={1.6} />
      ))}
      {Object.values(BUILDINGS).map((def) => (
        <BuildingSign key={def.id} def={def} />
      ))}

      <Ambient chimneys={village.chimneys} blossoms={village.blossoms} />
    </>
  );
}

function BuildingSign({ def }: { def: BuildingDef }) {
  const hx = def.size.x / 2;
  const hz = def.size.z / 2;
  const out = 0.3;
  const y = def.kind === "field" ? 2.6 : DOOR_HEIGHT + (def.id === "hq" ? 1.55 : 1.0);
  const pos: Record<Facing, [number, number, number]> = {
    north: [def.center.x, y, def.center.z - hz - out],
    south: [def.center.x, y, def.center.z + hz + out + (def.id === "hq" ? 0.75 : 0)],
    west: [def.center.x - hx - out, y, def.center.z],
    east: [def.center.x + hx + out, y, def.center.z],
  };
  // the training sign hangs from the gate arch
  if (def.kind === "field") pos.west = [def.center.x - hx - 0.05, y - 0.55, def.center.z];
  return (
    <Sign
      title={def.name}
      subtitle={def.subtitle}
      position={pos[def.door]}
      rotationY={FACING_ROTATION[def.door]}
      width={def.id === "hq" ? 3.2 : def.kind === "field" ? 2.0 : 2.6}
    />
  );
}

/** Dev-only: draw calls / triangles / fps for performance checks (window.__agentVillageStats()). */
function DevStats() {
  const stats = useRef({ calls: 0, triangles: 0, fps: 0, frames: 0, since: 0, exposed: false });
  // Runs first in every frame: read the totals of the previous frame (all passes), then reset.
  useFrame((state) => {
    const s = stats.current;
    const { gl } = state;
    if (!s.exposed) {
      s.exposed = true;
      gl.info.autoReset = false;
      s.since = performance.now();
      const w = window as unknown as { __agentVillageStats?: () => object; __agentVillageDebug?: object };
      w.__agentVillageStats = () => ({ calls: s.calls, triangles: s.triangles, fps: s.fps });
      w.__agentVillageDebug = { camera: state.camera, view: debugView };
    }
    s.calls = gl.info.render.calls;
    s.triangles = gl.info.render.triangles;
    gl.info.reset();
    s.frames++;
    const now = performance.now();
    if (now - s.since > 1000) {
      s.fps = Math.round((s.frames * 1000) / (now - s.since));
      s.frames = 0;
      s.since = now;
    }
  }, -1000);
  return null;
}
