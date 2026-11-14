"use client";

import { create } from "zustand";

/** 2D overlay state that is independent of the 3D world store. */
interface UiState {
  hqOpen: boolean;
  rosterOpen: boolean;
  openHq: () => void;
  closeHq: () => void;
  openRoster: () => void;
  closeRoster: () => void;
}

export const useUi = create<UiState>()((set) => ({
  hqOpen: false,
  rosterOpen: false,
  openHq: () => set({ hqOpen: true }),
  closeHq: () => set({ hqOpen: false }),
  openRoster: () => set({ rosterOpen: true }),
  closeRoster: () => set({ rosterOpen: false }),
}));
