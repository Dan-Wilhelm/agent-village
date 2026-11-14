"use client";

/**
 * Director: brings the REAL agents (from the vault roster) into the world.
 * Agents live in their home building and only walk when something really
 * happens (they are called, or — later — a trigger fires). No fake activity:
 * what you see is what the agent is actually doing.
 */
import type { BuildingId } from "./layout";
import { placeAgent, sendToBuilding, sendToSlot } from "./movement";
import { useVillage, type AgentView, type Priority } from "./store";

export interface DirectorAgent {
  id: string;
  name: string;
  role: string;
  look: AgentView["look"];
  home: BuildingId;
  priority: Priority;
}

const SPREAD: Array<{ x: number; z: number }> = [
  { x: 0.6, z: -1.2 },
  { x: 0.8, z: 1.2 },
  { x: -1.4, z: -0.8 },
  { x: -1.2, z: 1.3 },
  { x: 1.6, z: 0 },
  { x: -0.2, z: 2 },
  { x: -0.4, z: -2 },
];

let started = false;
let unsubscribe: (() => void) | null = null;
const known = new Map<string, DirectorAgent>();

/** Places all agents at home (idempotent: new agents are added, existing ones keep their state). */
export function syncAgents(agents: DirectorAgent[]) {
  const perHome = new Map<string, number>();
  for (const a of agents) {
    const n = perHome.get(a.home) ?? 0;
    perHome.set(a.home, n + 1);
    const existing = useVillage.getState().agents[a.id];
    useVillage.getState().upsertAgent({
      id: a.id,
      name: a.name,
      role: a.role,
      look: a.look,
      home: a.home,
      status: existing?.status ?? "idle",
      bubble: existing?.bubble,
    });
    if (!known.has(a.id)) placeAgent(a.id, a.home, SPREAD[n % SPREAD.length]);
    known.set(a.id, a);
  }
  if (!started) startQueueFollower();
}

/** When the queue changes, everyone still waiting moves to their (new) spot. */
function startQueueFollower() {
  started = true;
  let previous = useVillage.getState().queue;
  unsubscribe = useVillage.subscribe((state) => {
    if (state.queue === previous) return;
    const before = previous;
    previous = state.queue;
    state.queue.forEach((q, idx) => {
      const prevIdx = before.findIndex((b) => b.id === q.id);
      if (prevIdx !== -1 && prevIdx !== idx) sendToSlot(q.agentId, idx);
    });
  });
}

/** An agent comes to the owner's desk (called by the owner, the dispatcher or a trigger). */
export function summonAgent(agentId: string, visit: { title: string; body: string; priority?: Priority }) {
  const agent = known.get(agentId);
  const store = useVillage.getState();
  if (!agent) return null;
  const existing = store.queue.find((q) => q.agentId === agentId);
  if (existing) return existing;
  const interaction = {
    id: `${agentId}-${Date.now()}`,
    agentId,
    title: visit.title,
    body: visit.body,
    priority: visit.priority ?? agent.priority,
    createdAt: Date.now(),
  };
  store.enqueue(interaction);
  const index = useVillage.getState().queue.findIndex((q) => q.id === interaction.id);
  store.patchAgent(agentId, { status: "walking", bubble: undefined });
  sendToSlot(agentId, Math.max(0, index), () => {
    const s = useVillage.getState();
    if (s.agents[agentId]?.status === "walking") s.patchAgent(agentId, { status: "waiting" });
  });
  return interaction;
}

/** Conversation finished: the agent leaves the queue and walks home. */
export function releaseAgent(agentId: string) {
  const store = useVillage.getState();
  const q = store.queue.find((x) => x.agentId === agentId);
  if (q) store.resolve(q.id);
  const agent = known.get(agentId);
  store.patchAgent(agentId, { status: "walking", bubble: undefined });
  if (agent) {
    sendToBuilding(agentId, agent.home, () => useVillage.getState().patchAgent(agentId, { status: "idle" }));
  }
}

/** Reflects what the agent is really doing (thinking/working, waiting for Dan, training). */
export function setAgentActivity(agentId: string, status: AgentView["status"], bubble?: string) {
  const current = useVillage.getState().agents[agentId];
  if (!current || current.status === "walking") return; // walking state ends on arrival
  useVillage.getState().patchAgent(agentId, { status, bubble });
}

export function stopDirector() {
  unsubscribe?.();
  unsubscribe = null;
  started = false;
}
