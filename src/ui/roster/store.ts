"use client";

import { create } from "zustand";

import type { RosterAgent } from "@/app/actions/agents";

interface RosterState {
  agents: RosterAgent[];
  teams: Array<{ id: string; name: string; company: string; lead: string | null }>;
  problems: Array<{ path: string; message: string }>;
  loaded: boolean;
  set: (data: Omit<RosterState, "set" | "loaded" | "rename">) => void;
  rename: (id: string, name: string) => void;
}

export const useRoster = create<RosterState>()((set) => ({
  agents: [],
  teams: [],
  problems: [],
  loaded: false,
  set: (data) => set({ ...data, loaded: true }),
  rename: (id, name) => set((s) => ({ agents: s.agents.map((a) => (a.id === id ? { ...a, name } : a)) })),
}));
