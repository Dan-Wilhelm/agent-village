"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import type { Group } from "three";

import { DESK } from "./layout";
import { isMoving, movers } from "./movement";
import { interactionOf, useVillage, type AgentStatus, type AgentView } from "./store";

const STATUS_ICON: Record<AgentStatus, string> = {
  idle: "💤",
  walking: "",
  working: "⚙️",
  waiting: "❗",
  training: "🎓",
  error: "⚠️",
};

const EYE = "#2b1d14";
const BLUSH = "#ff9aa8";
const SKIN = "#ffe2c6";

/** A small, blocky, original character. All parts are simple boxes. */
export function AgentCharacter({ agent }: { agent: AgentView }) {
  const root = useRef<Group>(null);
  const legL = useRef<Group>(null);
  const legR = useRef<Group>(null);
  const armL = useRef<Group>(null);
  const armR = useRef<Group>(null);
  const body = useRef<Group>(null);
  const mode = useVillage((s) => s.mode);
  const openInteraction = useVillage((s) => s.openInteraction);
  const waitingWith = useVillage((s) => interactionOf(s, agent.id));

  useFrame((state) => {
    const m = movers.get(agent.id);
    const g = root.current;
    if (!m || !g) return;
    g.position.set(m.x, 0, m.z);
    // Smoothly turn towards the walking direction (or face the owner's desk while waiting).
    const facingDesk = agent.status === "waiting" && !isMoving(agent.id);
    const targetHeading = facingDesk ? Math.atan2(DESK.x - m.x, DESK.z - m.z) : m.heading;
    let diff = targetHeading - g.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    g.rotation.y += diff * 0.15;

    const t = state.clock.elapsedTime;
    const walking = isMoving(agent.id);
    const swing = walking ? Math.sin(t * 10) * 0.6 : 0;
    if (legL.current) legL.current.rotation.x = swing;
    if (legR.current) legR.current.rotation.x = -swing;
    if (armL.current) armL.current.rotation.x = -swing * 0.8;
    if (armR.current) armR.current.rotation.x = agent.status === "waiting" ? -2.6 + Math.sin(t * 6) * 0.25 : swing * 0.8;
    if (body.current) body.current.position.y = walking ? Math.abs(Math.sin(t * 10)) * 0.05 : Math.sin(t * 2) * 0.015;
  });

  const icon = STATUS_ICON[agent.status];
  const showBubble = Boolean(agent.bubble) && (agent.status === "waiting" || agent.status === "working");

  return (
    <group
      ref={root}
      onClick={(e) => {
        e.stopPropagation();
        if (waitingWith && mode === "desk") openInteraction(waitingWith.id);
      }}
      onPointerOver={() => {
        if (waitingWith && mode === "desk") document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        document.body.style.cursor = "";
      }}
    >
      <group ref={body}>
        {/* legs (pivot at hip) */}
        <group ref={legL} position={[-0.11, 0.38, 0]}>
          <mesh position={[0, -0.19, 0]} castShadow>
            <boxGeometry args={[0.16, 0.38, 0.18]} />
            <meshLambertMaterial color={agent.look.accent} />
          </mesh>
        </group>
        <group ref={legR} position={[0.11, 0.38, 0]}>
          <mesh position={[0, -0.19, 0]} castShadow>
            <boxGeometry args={[0.16, 0.38, 0.18]} />
            <meshLambertMaterial color={agent.look.accent} />
          </mesh>
        </group>
        {/* torso */}
        <mesh position={[0, 0.64, 0]} castShadow>
          <boxGeometry args={[0.46, 0.52, 0.3]} />
          <meshLambertMaterial color={agent.look.body} />
        </mesh>
        {/* arms (pivot at shoulder) */}
        <group ref={armL} position={[-0.31, 0.86, 0]}>
          <mesh position={[0, -0.2, 0]} castShadow>
            <boxGeometry args={[0.14, 0.42, 0.16]} />
            <meshLambertMaterial color={agent.look.body} />
          </mesh>
        </group>
        <group ref={armR} position={[0.31, 0.86, 0]}>
          <mesh position={[0, -0.2, 0]} castShadow>
            <boxGeometry args={[0.14, 0.42, 0.16]} />
            <meshLambertMaterial color={agent.look.body} />
          </mesh>
        </group>
        {/* head */}
        <group position={[0, 1.17, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.56, 0.52, 0.5]} />
            <meshLambertMaterial color={SKIN} />
          </mesh>
          {/* face looks +z */}
          <mesh position={[-0.12, 0.03, 0.251]}>
            <boxGeometry args={[0.08, 0.11, 0.01]} />
            <meshBasicMaterial color={EYE} />
          </mesh>
          <mesh position={[0.12, 0.03, 0.251]}>
            <boxGeometry args={[0.08, 0.11, 0.01]} />
            <meshBasicMaterial color={EYE} />
          </mesh>
          <mesh position={[-0.2, -0.09, 0.251]}>
            <boxGeometry args={[0.09, 0.05, 0.01]} />
            <meshBasicMaterial color={BLUSH} />
          </mesh>
          <mesh position={[0.2, -0.09, 0.251]}>
            <boxGeometry args={[0.09, 0.05, 0.01]} />
            <meshBasicMaterial color={BLUSH} />
          </mesh>
          <Hat style={agent.look.hat} color={agent.look.accent} />
        </group>
      </group>

      {/* status icon + speech bubble */}
      <Html position={[0, 1.95, 0]} center distanceFactor={9} zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
        <div className="flex flex-col items-center gap-1 select-none">
          {showBubble && (
            <div className="whitespace-nowrap rounded-2xl border-2 border-wood bg-cream px-3 py-1.5 text-sm font-extrabold text-ink shadow-md">
              {agent.bubble}
            </div>
          )}
          <div className="whitespace-nowrap rounded-full bg-ink/70 px-2 py-0.5 text-xs font-bold text-cream">
            {icon ? `${icon} ` : ""}
            {agent.name}
          </div>
        </div>
      </Html>
    </group>
  );
}

function Hat({ style, color }: { style: AgentView["look"]["hat"]; color: string }) {
  switch (style) {
    case "cap":
      return (
        <group position={[0, 0.3, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.6, 0.12, 0.54]} />
            <meshLambertMaterial color={color} />
          </mesh>
          <mesh position={[0, -0.03, 0.34]}>
            <boxGeometry args={[0.5, 0.05, 0.22]} />
            <meshLambertMaterial color={color} />
          </mesh>
        </group>
      );
    case "beanie":
      return (
        <group position={[0, 0.3, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.6, 0.16, 0.54]} />
            <meshLambertMaterial color={color} />
          </mesh>
          <mesh position={[0, 0.14, 0]}>
            <boxGeometry args={[0.14, 0.12, 0.14]} />
            <meshLambertMaterial color="#ffffff" />
          </mesh>
        </group>
      );
    case "bow":
      return (
        <group position={[0.2, 0.3, 0.05]}>
          <mesh>
            <boxGeometry args={[0.12, 0.1, 0.1]} />
            <meshLambertMaterial color={color} />
          </mesh>
          <mesh position={[-0.11, 0, 0]}>
            <boxGeometry args={[0.12, 0.16, 0.08]} />
            <meshLambertMaterial color={color} />
          </mesh>
          <mesh position={[0.11, 0, 0]}>
            <boxGeometry args={[0.12, 0.16, 0.08]} />
            <meshLambertMaterial color={color} />
          </mesh>
        </group>
      );
    case "crown":
      return (
        <group position={[0, 0.32, 0]}>
          <mesh>
            <boxGeometry args={[0.46, 0.1, 0.42]} />
            <meshLambertMaterial color="#ffd25a" />
          </mesh>
          {[-0.17, 0, 0.17].map((x) => (
            <mesh key={x} position={[x, 0.1, 0.18]}>
              <boxGeometry args={[0.08, 0.12, 0.06]} />
              <meshLambertMaterial color="#ffd25a" />
            </mesh>
          ))}
        </group>
      );
    default:
      return null;
  }
}
