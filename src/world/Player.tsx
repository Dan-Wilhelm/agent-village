"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { PointerLockControls, useKeyboardControls } from "@react-three/drei";
import { CapsuleCollider, RigidBody, type RapierRigidBody } from "@react-three/rapier";
import { Euler, Vector3 } from "three";
import type { PointerLockControls as PointerLockControlsImpl } from "three-stdlib";

import { sceneBridge, type ControlName } from "./controls";
import { PLAYER_SPAWN } from "./layout";
import { movers } from "./movement";
import { interactionOf, useVillage } from "./store";

const WALK = 4.2;
const RUN = 7;
const EYE_OFFSET = 0.75; // capsule center → eyes (~1.6 m above ground)
const TALK_DISTANCE = 3.5;
const UP = new Vector3(0, 1, 0);

export function Player() {
  const body = useRef<RapierRigidBody>(null);
  const controls = useRef<PointerLockControlsImpl>(null);
  const camera = useThree((s) => s.camera);
  const [subscribe, getKeys] = useKeyboardControls<ControlName>();
  const setMode = useVillage((s) => s.setMode);
  const panelOpen = useVillage((s) => s.openInteractionId !== null);

  const direction = useRef(new Vector3());
  const euler = useRef(new Euler(0, 0, 0, "YXZ"));

  // Expose lock/unlock and "back to desk" to the HUD.
  useEffect(() => {
    sceneBridge.registerPointerLock({
      lock: () => {
        if (useVillage.getState().openInteractionId === null) controls.current?.lock();
      },
      unlock: () => controls.current?.unlock(),
    });
    sceneBridge.registerPlayer({
      toDesk: () => {
        body.current?.setTranslation({ x: PLAYER_SPAWN.x, y: 1, z: PLAYER_SPAWN.z }, true);
        body.current?.setLinvel({ x: 0, y: 0, z: 0 }, true);
        camera.rotation.set(0, 0, 0, "YXZ");
      },
    });
    return () => {
      sceneBridge.registerPointerLock(null);
      sceneBridge.registerPlayer(null);
    };
  }, [camera]);

  // Opening a panel frees the mouse.
  useEffect(() => {
    if (panelOpen) controls.current?.unlock();
  }, [panelOpen]);

  // E = talk to the nearest waiting agent.
  useEffect(
    () =>
      subscribe(
        (s) => s.interact,
        (pressed) => {
          if (!pressed) return;
          const state = useVillage.getState();
          if (!state.nearbyAgentId) return;
          const interaction = interactionOf(state, state.nearbyAgentId);
          if (interaction) state.openInteraction(interaction.id);
        },
      ),
    [subscribe],
  );

  useFrame(() => {
    const rb = body.current;
    if (!rb) return;
    const pos = rb.translation();
    camera.position.set(pos.x, pos.y + EYE_OFFSET, pos.z);

    const { forward, backward, left, right, run } = getKeys();
    const state = useVillage.getState();
    const canWalk = state.mode === "walk" && state.openInteractionId === null;
    const v = rb.linvel();

    if (canWalk) {
      euler.current.setFromQuaternion(camera.quaternion, "YXZ");
      direction.current
        .set(Number(right) - Number(left), 0, Number(backward) - Number(forward))
        .normalize()
        .multiplyScalar(run ? RUN : WALK)
        .applyAxisAngle(UP, euler.current.y);
      rb.setLinvel({ x: direction.current.x, y: v.y, z: direction.current.z }, true);
    } else {
      rb.setLinvel({ x: 0, y: v.y, z: 0 }, true);
    }

    // Find the nearest agent that is waiting for me.
    let nearest: string | null = null;
    let best = TALK_DISTANCE;
    for (const q of state.queue) {
      const m = movers.get(q.agentId);
      if (!m || m.path.length > 0) continue;
      const d = Math.hypot(m.x - pos.x, m.z - pos.z);
      if (d < best) {
        best = d;
        nearest = q.agentId;
      }
    }
    state.setNearby(nearest);
  });

  return (
    <>
      {/* selector points at nothing: locking is triggered from Scene (clicks on empty world). */}
      <PointerLockControls
        ref={controls}
        selector="#av-no-auto-lock"
        onLock={() => setMode("walk")}
        onUnlock={() => setMode("desk")}
      />
      <RigidBody
        ref={body}
        colliders={false}
        mass={1}
        type="dynamic"
        position={[PLAYER_SPAWN.x, 1, PLAYER_SPAWN.z]}
        enabledRotations={[false, false, false]}
        canSleep={false}
        linearDamping={0.5}
      >
        <CapsuleCollider args={[0.5, 0.35]} />
      </RigidBody>
    </>
  );
}
