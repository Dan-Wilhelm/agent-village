"use client";

import { create } from "zustand";

/** 2D overlay state that is independent of the 3D world store. */
interface UiState {
  hqOpen: boolean;
  openHq: () => void;
  closeHq: () => void;
}

export const useUi = create<UiState>()((set) => ({
  hqOpen: false,
  openHq: () => set({ hqOpen: true }),
  closeHq: () => set({ hqOpen: false }),
}));
