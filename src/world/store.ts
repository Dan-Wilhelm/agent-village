"use client";

import { create } from "zustand";

import type { BuildingId } from "./layout";

export type AgentStatus = "idle" | "walking" | "working" | "waiting" | "training" | "error";
export type HatStyle = "none" | "cap" | "beanie" | "bow" | "crown";

export interface AgentLook {
  body: string;
  accent: string;
  hat: HatStyle;
}

export interface AgentView {
  id: string;
  name: string;
  role: string;
  look: AgentLook;
  status: AgentStatus;
  home: BuildingId;
  /** Short text shown in the speech bubble above the head. */
  bubble?: string;
}

/** Something an agent brings to the owner. Phase 3 adds approvals, previews and feedback. */
export interface Interaction {
  id: string;
  agentId: string;
  title: string;
  body: string;
  createdAt: number;
}

export type PlayerMode = "desk" | "walk";

interface VillageState {
  agents: Record<string, AgentView>;
  /** Waiting queue, in arrival order (first = in front of the desk). */
  queue: Interaction[];
  openInteractionId: string | null;
  nearbyAgentId: string | null;
  mode: PlayerMode;

  upsertAgent: (agent: AgentView) => void;
  patchAgent: (id: string, patch: Partial<AgentView>) => void;
  enqueue: (interaction: Interaction) => void;
  resolve: (interactionId: string) => Interaction | undefined;
  openInteraction: (interactionId: string) => void;
  closePanel: () => void;
  setNearby: (agentId: string | null) => void;
  setMode: (mode: PlayerMode) => void;
}

export const useVillage = create<VillageState>()((set, get) => ({
  agents: {},
  queue: [],
  openInteractionId: null,
  nearbyAgentId: null,
  mode: "desk",

  upsertAgent: (agent) => set((s) => ({ agents: { ...s.agents, [agent.id]: agent } })),
  patchAgent: (id, patch) =>
    set((s) => (s.agents[id] ? { agents: { ...s.agents, [id]: { ...s.agents[id], ...patch } } } : s)),
  enqueue: (interaction) =>
    set((s) =>
      s.queue.some((q) => q.agentId === interaction.agentId) ? s : { queue: [...s.queue, interaction] },
    ),
  resolve: (interactionId) => {
    const found = get().queue.find((q) => q.id === interactionId);
    set((s) => ({
      queue: s.queue.filter((q) => q.id !== interactionId),
      openInteractionId: s.openInteractionId === interactionId ? null : s.openInteractionId,
    }));
    return found;
  },
  openInteraction: (interactionId) => set({ openInteractionId: interactionId }),
  closePanel: () => set({ openInteractionId: null }),
  setNearby: (agentId) => {
    if (get().nearbyAgentId !== agentId) set({ nearbyAgentId: agentId });
  },
  setMode: (mode) => {
    if (get().mode !== mode) set({ mode });
  },
}));

/** The interaction an agent is currently waiting with, if any. */
export function interactionOf(state: Pick<VillageState, "queue">, agentId: string) {
  return state.queue.find((q) => q.agentId === agentId);
}
