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

export type Priority = "urgent" | "high" | "normal" | "low";
export const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

/** A visit: an agent wants (or was asked) to talk to the owner. Holds no ClickUp content. */
export interface Interaction {
  id: string;
  agentId: string;
  /** Short reason shown in the queue, e.g. "Daily plan" or "You called". */
  title: string;
  /** Opening line for the conversation (from the owner or the trigger). */
  body: string;
  priority: Priority;
  createdAt: number;
}

/** Queue order: priority first, then arrival. */
export function sortQueue(queue: Interaction[]): Interaction[] {
  return [...queue].sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.createdAt - b.createdAt);
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
      s.queue.some((q) => q.agentId === interaction.agentId) ? s : { queue: sortQueue([...s.queue, interaction]) },
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
