"use client";

/** Bridges between React DOM (HUD) and the 3D scene, without prop drilling. */

export const KEYMAP = [
  { name: "forward", keys: ["ArrowUp", "KeyW"] },
  { name: "backward", keys: ["ArrowDown", "KeyS"] },
  { name: "left", keys: ["ArrowLeft", "KeyA"] },
  { name: "right", keys: ["ArrowRight", "KeyD"] },
  { name: "run", keys: ["ShiftLeft", "ShiftRight"] },
  { name: "interact", keys: ["KeyE"] },
] as const;

export type ControlName = (typeof KEYMAP)[number]["name"];

interface PointerLockApi {
  lock: () => void;
  unlock: () => void;
}
interface PlayerApi {
  toDesk: () => void;
  /** Moves the player; yaw in radians (0 = looking north). */
  teleport: (x: number, z: number, yaw: number) => void;
}

let pointerLock: PointerLockApi | null = null;
let player: PlayerApi | null = null;

export const sceneBridge = {
  registerPointerLock(api: PointerLockApi | null) {
    pointerLock = api;
  },
  registerPlayer(api: PlayerApi | null) {
    player = api;
  },
  lock() {
    pointerLock?.lock();
  },
  unlock() {
    pointerLock?.unlock();
  },
  toDesk() {
    player?.toDesk();
  },
  teleport(x: number, z: number, yaw = 0) {
    player?.teleport(x, z, yaw);
  },
};

// Development-only debug handle (used for automated screenshots). Never shipped to production.
if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
  (window as unknown as { __agentVillage?: typeof sceneBridge }).__agentVillage = sceneBridge;
}
