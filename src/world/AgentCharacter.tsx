"use client";

import { useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { useRapier } from "@react-three/rapier";
import { CanvasTexture, Vector3, type Group, type Mesh } from "three";

import { DESK } from "./layout";
import { isMoving, movers } from "./movement";
import { motionScale } from "./voxels/materials";
import { interactionOf, useVillage, type AgentStatus, type AgentView } from "./store";

const STATUS_ICON: Record<AgentStatus, string> = {
  idle: "💤",
  walking: "",
  working: "⚙️",
  waiting: "❗",
  training: "🎓",
  error: "⚠️",
};

const LABEL_MAX_DISTANCE = 28;
const HEAD_HEIGHT = 1.3;

const EYE = "#2b1d14";
const BLUSH = "#ff9aa8";
const SKIN = "#ffe2c6";
const MOUTH = "#c75b5b";

// Proportions: a big round-ish head on a small body reads as "cute" from any distance.
const LEG_H = 0.26;
const TORSO_H = 0.42;
const HIP_Y = LEG_H + 0.02;
const NECK_Y = HIP_Y + TORSO_H;
const HEAD = { w: 0.64, h: 0.56, d: 0.56 };
const HOP_TIME = 0.42;

let shadowTexture: CanvasTexture | null = null;
function blobShadow() {
  if (shadowTexture) return shadowTexture;
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 31);
  g.addColorStop(0, "rgba(60,40,30,0.45)");
  g.addColorStop(1, "rgba(60,40,30,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  shadowTexture = new CanvasTexture(c);
  return shadowTexture;
}

function hashString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

const toCamera = new Vector3();
const HAIR = ["#6b4630", "#3f2d24", "#b8642f", "#e3b76a", "#8a5a3c"];

/** A small, blocky, original character. All parts are simple boxes. */
export function AgentCharacter({ agent }: { agent: AgentView }) {
  const root = useRef<Group>(null);
  const hop = useRef<Group>(null);
  const legL = useRef<Group>(null);
  const legR = useRef<Group>(null);
  const armL = useRef<Group>(null);
  const armR = useRef<Group>(null);
  const body = useRef<Group>(null);
  const head = useRef<Group>(null);
  const eyes = useRef<Group>(null);
  const shadow = useRef<Mesh>(null);
  const mode = useVillage((s) => s.mode);
  const openInteraction = useVillage((s) => s.openInteraction);
  const waitingWith = useVillage((s) => interactionOf(s, agent.id));
  const { world, rapier } = useRapier();
  const [labelVisible, setLabelVisible] = useState(true);
  const visibilityTimer = useRef(0);
  const phase = useMemo(() => hashString(agent.id) * 100, [agent.id]);
  const anim = useRef({ wasMoving: false, hopT: -1, blinkAt: 2 + (phase % 3), walkPhase: 0 });
  const shadowMap = useMemo(() => blobShadow(), []);
  const hair = HAIR[Math.floor((phase * 7.31) % HAIR.length)];

  useFrame((state, delta) => {
    const m = movers.get(agent.id);
    const g = root.current;
    if (!m || !g) return;
    const dt = Math.min(delta, 0.1);
    const motion = motionScale.value;
    g.position.set(m.x, 0, m.z);

    // Hide labels when far away or when a wall is between the agent and the camera
    // (labels are HTML overlays, so they would otherwise shine through walls).
    visibilityTimer.current -= delta;
    if (visibilityTimer.current <= 0) {
      visibilityTimer.current = 0.2;
      const cam = state.camera.position;
      const dx = cam.x - m.x;
      const dy = cam.y - HEAD_HEIGHT;
      const dz = cam.z - m.z;
      const dist = Math.hypot(dx, dy, dz);
      let visible = dist < LABEL_MAX_DISTANCE;
      if (visible && dist > 0.8) {
        // Cast from the head towards the camera, stopping before the player's own capsule.
        const ray = new rapier.Ray({ x: m.x, y: HEAD_HEIGHT, z: m.z }, { x: dx / dist, y: dy / dist, z: dz / dist });
        const hit = world.castRay(ray, dist - 0.6, true);
        if (hit) visible = false;
      }
      if (visible !== labelVisible) setLabelVisible(visible);
    }

    const walking = isMoving(agent.id);
    const a = anim.current;
    // A little hop of joy when arriving somewhere.
    if (a.wasMoving && !walking && motion > 0) a.hopT = 0;
    a.wasMoving = walking;

    // Smoothly turn towards the walking direction (or face the owner's desk while waiting).
    const facingDesk = agent.status === "waiting" && !walking;
    const targetHeading = facingDesk ? Math.atan2(DESK.x - m.x, DESK.z - m.z) : m.heading;
    let diff = targetHeading - g.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    g.rotation.y += diff * (1 - Math.exp(-dt * 9));

    const t = state.clock.elapsedTime + phase;
    if (walking) a.walkPhase += dt * 11;
    const swing = walking ? Math.sin(a.walkPhase) * 0.7 : 0;
    const ease = 1 - Math.exp(-dt * 12);
    const lerp = (cur: number, target: number) => cur + (target - cur) * ease;

    if (legL.current) legL.current.rotation.x = lerp(legL.current.rotation.x, swing);
    if (legR.current) legR.current.rotation.x = lerp(legR.current.rotation.x, -swing);
    if (armL.current) {
      armL.current.rotation.x = lerp(armL.current.rotation.x, -swing * 0.8);
      armL.current.rotation.z = lerp(armL.current.rotation.z, walking ? -0.08 : -0.12);
    }
    if (armR.current) {
      // Waiting: wave in short bursts, then rest the hand — friendly, not frantic.
      const waveOn = facingDesk && Math.sin(t * 0.9) > 0.1;
      const waveX = waveOn ? -2.7 + Math.sin(t * 9) * 0.22 * Math.max(motion, 0.3) : facingDesk ? -0.25 : swing * 0.8;
      armR.current.rotation.x = lerp(armR.current.rotation.x, waveX);
      armR.current.rotation.z = lerp(armR.current.rotation.z, waveOn ? 0.25 : 0.12);
    }

    // Body: walking bob, idle breathing, landing squash.
    let hopY = 0;
    let squash = 1;
    if (a.hopT >= 0) {
      a.hopT += dt / HOP_TIME;
      const k = a.hopT;
      if (k >= 1.25) a.hopT = -1;
      else if (k <= 1) {
        hopY = 4 * 0.14 * k * (1 - k);
        squash = 1 + Math.sin(k * Math.PI) * 0.06;
      } else squash = 1 - Math.sin(((k - 1) / 0.25) * Math.PI) * 0.07;
    }
    const breathe = 1 + Math.sin(t * 2.1) * 0.018 * Math.max(motion, 0.4);
    if (body.current) {
      body.current.position.y = walking ? Math.abs(Math.sin(a.walkPhase)) * 0.06 : 0;
      body.current.rotation.x = lerp(body.current.rotation.x, walking ? 0.08 : 0);
      body.current.scale.set(1 / Math.sqrt(squash), squash * breathe, 1 / Math.sqrt(squash));
    }
    if (hop.current) hop.current.position.y = hopY;
    if (shadow.current) shadow.current.scale.setScalar(1 - hopY * 1.6);

    // Head: look around while idle, look at the camera while waiting.
    if (head.current) {
      let yaw = 0;
      let pitch = 0;
      if (facingDesk) {
        toCamera.set(state.camera.position.x - m.x, 0, state.camera.position.z - m.z);
        const toCam = Math.atan2(toCamera.x, toCamera.z);
        let rel = toCam - g.rotation.y;
        rel = Math.atan2(Math.sin(rel), Math.cos(rel));
        yaw = Math.max(-0.6, Math.min(0.6, rel));
        pitch = -0.08 + Math.sin(t * 1.3) * 0.03;
      } else if (!walking) {
        yaw = (Math.sin(t * 0.37) * 0.45 + Math.sin(t * 0.91) * 0.15) * motion;
        pitch = Math.sin(t * 0.53) * 0.08 * motion;
      }
      head.current.rotation.y = lerp(head.current.rotation.y, yaw);
      head.current.rotation.x = lerp(head.current.rotation.x, pitch);
      head.current.rotation.z = walking ? Math.sin(a.walkPhase) * 0.04 : Math.sin(t * 0.7) * 0.03 * motion;
    }

    // Blink every few seconds.
    if (eyes.current) {
      const now = state.clock.elapsedTime;
      if (now > a.blinkAt + 0.13) a.blinkAt = now + 2.2 + Math.random() * 3.5;
      eyes.current.scale.y = now > a.blinkAt ? 0.15 : 1;
    }
  });

  const icon = STATUS_ICON[agent.status];
  const showBubble = Boolean(agent.bubble) && (agent.status === "waiting" || agent.status === "working");
  const { body: bodyColor, accent } = agent.look;

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
      <mesh ref={shadow} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]} renderOrder={1}>
        <planeGeometry args={[0.95, 0.95]} />
        <meshBasicMaterial map={shadowMap} transparent depthWrite={false} />
      </mesh>
      <group ref={hop}>
        <group ref={body}>
          {/* legs (pivot at hip) with little shoes */}
          {[-0.11, 0.11].map((x, i) => (
            <group key={x} ref={i === 0 ? legL : legR} position={[x, HIP_Y, 0]}>
              <mesh position={[0, -LEG_H / 2 + 0.03, 0]} castShadow>
                <boxGeometry args={[0.16, LEG_H - 0.06, 0.17]} />
                <meshLambertMaterial color={accent} />
              </mesh>
              <mesh position={[0, -LEG_H + 0.04, 0.025]} castShadow>
                <boxGeometry args={[0.18, 0.08, 0.22]} />
                <meshLambertMaterial color="#5a4034" />
              </mesh>
            </group>
          ))}
          {/* torso with a soft belly patch and a collar in the accent color */}
          <mesh position={[0, HIP_Y + TORSO_H / 2, 0]} castShadow>
            <boxGeometry args={[0.46, TORSO_H, 0.32]} />
            <meshLambertMaterial color={bodyColor} />
          </mesh>
          <mesh position={[0, HIP_Y + TORSO_H * 0.42, 0.161]}>
            <boxGeometry args={[0.26, 0.2, 0.01]} />
            <meshLambertMaterial color="#fff6ea" transparent opacity={0.45} />
          </mesh>
          <mesh position={[0, NECK_Y - 0.03, 0]}>
            <boxGeometry args={[0.5, 0.07, 0.36]} />
            <meshLambertMaterial color={accent} />
          </mesh>
          {/* arms (pivot at shoulder) with hands */}
          {[-1, 1].map((s) => (
            <group key={s} ref={s < 0 ? armL : armR} position={[s * 0.3, NECK_Y - 0.06, 0]}>
              <mesh position={[0, -0.15, 0]} castShadow>
                <boxGeometry args={[0.13, 0.3, 0.15]} />
                <meshLambertMaterial color={bodyColor} />
              </mesh>
              <mesh position={[0, -0.33, 0]}>
                <boxGeometry args={[0.12, 0.08, 0.13]} />
                <meshLambertMaterial color={SKIN} />
              </mesh>
            </group>
          ))}
          {/* head (pivot at the neck); the face looks +z */}
          <group ref={head} position={[0, NECK_Y, 0]}>
            <group position={[0, HEAD.h / 2 + 0.02, 0]}>
              <mesh castShadow>
                <boxGeometry args={[HEAD.w, HEAD.h, HEAD.d]} />
                <meshLambertMaterial color={SKIN} />
              </mesh>
              {/* hair: a cap over the top and back, with a little fringe */}
              <mesh position={[0, HEAD.h / 2 - 0.04, -0.02]}>
                <boxGeometry args={[HEAD.w + 0.03, 0.12, HEAD.d - 0.02]} />
                <meshLambertMaterial color={hair} />
              </mesh>
              <mesh position={[0, 0.02, -HEAD.d / 2 - 0.005]}>
                <boxGeometry args={[HEAD.w + 0.03, HEAD.h - 0.12, 0.05]} />
                <meshLambertMaterial color={hair} />
              </mesh>
              {[-1, 1].map((s) => (
                <mesh key={s} position={[s * (HEAD.w / 2 + 0.005), 0.1, -0.06]}>
                  <boxGeometry args={[0.04, 0.3, HEAD.d - 0.12]} />
                  <meshLambertMaterial color={hair} />
                </mesh>
              ))}
              <mesh position={[-0.12, HEAD.h / 2 - 0.1, HEAD.d / 2 - 0.02]}>
                <boxGeometry args={[0.3, 0.08, 0.06]} />
                <meshLambertMaterial color={hair} />
              </mesh>
              <group ref={eyes} position={[0, 0.02, HEAD.d / 2 + 0.001]}>
                {[-0.13, 0.13].map((x) => (
                  <group key={x} position={[x, 0, 0]}>
                    <mesh>
                      <boxGeometry args={[0.09, 0.13, 0.01]} />
                      <meshBasicMaterial color={EYE} />
                    </mesh>
                    <mesh position={[0.02, 0.03, 0.006]}>
                      <boxGeometry args={[0.032, 0.032, 0.004]} />
                      <meshBasicMaterial color="#ffffff" />
                    </mesh>
                  </group>
                ))}
              </group>
              {[-0.22, 0.22].map((x) => (
                <mesh key={x} position={[x, -0.1, HEAD.d / 2 + 0.002]}>
                  <boxGeometry args={[0.1, 0.055, 0.01]} />
                  <meshBasicMaterial color={BLUSH} transparent opacity={0.85} />
                </mesh>
              ))}
              <mesh position={[0, -0.12, HEAD.d / 2 + 0.002]}>
                <boxGeometry args={[0.08, 0.025, 0.01]} />
                <meshBasicMaterial color={MOUTH} />
              </mesh>
              <Hat style={agent.look.hat} color={accent} />
            </group>
          </group>
        </group>
      </group>

      {/* status icon + speech bubble */}
      <Html position={[0, 1.78, 0]} center zIndexRange={[20, 0]} pointerEvents="none">
        <div className={`flex flex-col items-center gap-1 select-none transition-opacity duration-200 ${labelVisible ? "opacity-100" : "opacity-0"}`}>
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
  const top = HEAD.h / 2;
  switch (style) {
    case "cap":
      return (
        <group position={[0, top + 0.05, 0]}>
          <mesh castShadow>
            <boxGeometry args={[HEAD.w + 0.04, 0.12, HEAD.d + 0.04]} />
            <meshLambertMaterial color={color} />
          </mesh>
          <mesh position={[0, -0.04, HEAD.d / 2 + 0.1]}>
            <boxGeometry args={[0.5, 0.04, 0.22]} />
            <meshLambertMaterial color={color} />
          </mesh>
          <mesh position={[0, 0.07, 0]}>
            <boxGeometry args={[0.08, 0.04, 0.08]} />
            <meshLambertMaterial color="#fff6ea" />
          </mesh>
        </group>
      );
    case "beanie":
      return (
        <group position={[0, top + 0.06, 0]}>
          <mesh castShadow>
            <boxGeometry args={[HEAD.w + 0.04, 0.16, HEAD.d + 0.04]} />
            <meshLambertMaterial color={color} />
          </mesh>
          <mesh position={[0, -0.07, 0]}>
            <boxGeometry args={[HEAD.w + 0.06, 0.06, HEAD.d + 0.06]} />
            <meshLambertMaterial color="#fff6ea" />
          </mesh>
          <mesh position={[0, 0.15, 0]}>
            <boxGeometry args={[0.15, 0.13, 0.15]} />
            <meshLambertMaterial color="#ffffff" />
          </mesh>
        </group>
      );
    case "bow":
      return (
        <group position={[0.2, top + 0.04, 0.06]} rotation={[0, 0, -0.2]}>
          <mesh>
            <boxGeometry args={[0.1, 0.1, 0.1]} />
            <meshLambertMaterial color={color} />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.11, 0, 0]}>
              <boxGeometry args={[0.13, 0.17, 0.08]} />
              <meshLambertMaterial color={color} />
            </mesh>
          ))}
        </group>
      );
    case "crown":
      return (
        <group position={[0, top + 0.04, 0]}>
          <mesh>
            <boxGeometry args={[0.48, 0.1, 0.44]} />
            <meshLambertMaterial color="#ffd25a" emissive="#5a3a00" emissiveIntensity={0.3} />
          </mesh>
          {[-0.18, 0, 0.18].map((x) => (
            <mesh key={x} position={[x, 0.1, 0.19]}>
              <boxGeometry args={[0.08, 0.12, 0.06]} />
              <meshLambertMaterial color="#ffd25a" emissive="#5a3a00" emissiveIntensity={0.3} />
            </mesh>
          ))}
          <mesh position={[0, 0.06, 0.225]}>
            <boxGeometry args={[0.06, 0.06, 0.02]} />
            <meshBasicMaterial color="#e0475b" />
          </mesh>
        </group>
      );
    default:
      return null;
  }
}
