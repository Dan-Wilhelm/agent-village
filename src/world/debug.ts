"use client";

/**
 * Development-only camera override used for automated screenshots: when
 * `free` is true the player controller stops moving the camera, so a script
 * can place it anywhere (e.g. an aerial overview). Never enabled in production.
 */
export const debugView = { free: false };
