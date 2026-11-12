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
};
