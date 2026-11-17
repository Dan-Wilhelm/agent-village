"use client";

import { create } from "zustand";

/** 2D overlay state that is independent of the 3D world store. */
interface UiState {
  hqOpen: boolean;
  rosterOpen: boolean;
  /** Agent wizard: null = closed; agentId = edit that agent. */
  wizard: { mode: "create" } | { mode: "edit"; agentId: string } | null;
  activityOpen: boolean;
  openWizard: (w: { mode: "create" } | { mode: "edit"; agentId: string }) => void;
  closeWizard: () => void;
  openActivity: () => void;
  closeActivity: () => void;
  openHq: () => void;
  closeHq: () => void;
  openRoster: () => void;
  closeRoster: () => void;
}

export const useUi = create<UiState>()((set) => ({
  hqOpen: false,
  rosterOpen: false,
  wizard: null,
  activityOpen: false,
  openWizard: (w) => set({ wizard: w, rosterOpen: false }),
  closeWizard: () => set({ wizard: null }),
  openActivity: () => set({ activityOpen: true, rosterOpen: false }),
  closeActivity: () => set({ activityOpen: false }),
  openHq: () => set({ hqOpen: true }),
  closeHq: () => set({ hqOpen: false }),
  openRoster: () => set({ rosterOpen: true }),
  closeRoster: () => set({ rosterOpen: false }),
}));
