"use client";

/**
 * PHASE 1 PLACEHOLDER — demo director.
 *
 * Drives five demo agents so the world can be tried before the real agent
 * engine exists. Phase 3 replaces this with live events from the server
 * (same store actions, same movement API). Nothing here talks to any service.
 */
import { placeAgent, sendToBuilding, sendToSlot } from "./movement";
import { useVillage, type AgentView } from "./store";

interface DemoAgent extends AgentView {
  visit: { title: string; body: string; bubble: string };
  spread: { x: number; z: number };
}

const DEMO_AGENTS: DemoAgent[] = [
  {
    id: "demo-briefing",
    name: "Kai",
    role: "Daily Team Briefing",
    look: { body: "#ffb86b", accent: "#7a4f30", hat: "cap" },
    status: "idle",
    home: "library",
    spread: { x: 0.6, z: -1.2 },
    visit: {
      bubble: "Good morning! ☀️",
      title: "Good morning!",
      body: "I'm Kai, your Daily Team Briefing agent. From Phase 4 on I'll come to you every working day with a briefing from ClickUp: what's due today, what's overdue, and what's blocked.",
    },
  },
  {
    id: "demo-review",
    name: "Rita",
    role: "Internal Review Reminder",
    look: { body: "#ff9fb5", accent: "#c95f53", hat: "bow" },
    status: "idle",
    home: "workshop",
    spread: { x: 0.8, z: 1.2 },
    visit: {
      bubble: "Review time! 🎬",
      title: "Time for an internal review",
      body: "I'm Rita. Three times a day I'll ask you to review newly created videos and images. When I introduce myself properly, you'll tell me the times and which status means 'ready for internal review'.",
    },
  },
  {
    id: "demo-client",
    name: "Otto",
    role: "Client Review Tracker",
    look: { body: "#8fd1ff", accent: "#5f87c2", hat: "beanie" },
    status: "idle",
    home: "hq",
    spread: { x: -1.6, z: -1 },
    visit: {
      bubble: "3 briefs at the client 📋",
      title: "Briefs still with the client",
      body: "I'm Otto. Once a day I'll list the ad briefs that are still with the client for review. We'll define the exact criteria together first.",
    },
  },
  {
    id: "demo-meeting",
    name: "Mila",
    role: "Meeting Prep",
    look: { body: "#c7a8f0", accent: "#9274bf", hat: "crown" },
    status: "idle",
    home: "library",
    spread: { x: 0.6, z: 1.2 },
    visit: {
      bubble: "Notes ready? 📝",
      title: "Meeting prep",
      body: "I'm Mila. Hand me your meeting notes when they're ready, and before your next customer meeting I'll prepare you — in German or English.",
    },
  },
  {
    id: "demo-tasks",
    name: "Tess",
    role: "Task Builder",
    look: { body: "#9be08a", accent: "#5ea67d", hat: "none" },
    status: "idle",
    home: "workshop",
    spread: { x: 0.8, z: -1.2 },
    visit: {
      bubble: "Need a new task? ✨",
      title: "Need a new task?",
      body: "I'm Tess. Brief me by voice and I'll draft landing page, static ad brief and video tasks in ClickUp — always for your approval first.",
    },
  },
];

export function startDemo(): () => void {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let stopped = false;
  const later = (ms: number, fn: () => void) => {
    const t = setTimeout(() => {
      timers.delete(t);
      if (!stopped) fn();
    }, ms);
    timers.add(t);
  };
  const store = useVillage.getState;

  const goHome = (a: DemoAgent) => {
    store().patchAgent(a.id, { status: "walking", bubble: undefined });
    sendToBuilding(a.id, a.home, () => {
      store().patchAgent(a.id, { status: "idle" });
      later(20000 + Math.random() * 25000, () => cycle(a));
    });
  };

  const visitOwner = (a: DemoAgent) => {
    const interaction = {
      id: `${a.id}-${Date.now()}`,
      agentId: a.id,
      title: a.visit.title,
      body: a.visit.body,
      createdAt: Date.now(),
    };
    store().patchAgent(a.id, { status: "walking", bubble: undefined });
    store().enqueue(interaction);
    const index = store().queue.findIndex((q) => q.id === interaction.id);
    if (index < 0) {
      goHome(a); // already waiting with something else
      return;
    }
    sendToSlot(a.id, index, () => store().patchAgent(a.id, { status: "waiting", bubble: a.visit.bubble }));
  };

  const cycle = (a: DemoAgent) => {
    // Go read ClickUp at HQ, "work" a moment, then come to the owner.
    store().patchAgent(a.id, { status: "walking", bubble: undefined });
    sendToBuilding(a.id, "hq", () => {
      store().patchAgent(a.id, { status: "working", bubble: "Reading ClickUp…" });
      later(3500, () => visitOwner(a));
    });
  };

  // Spawn everyone at home, stagger the first visits.
  DEMO_AGENTS.forEach((a, i) => {
    const view: AgentView = { id: a.id, name: a.name, role: a.role, look: a.look, status: "idle", home: a.home };
    useVillage.getState().upsertAgent(view);
    placeAgent(a.id, a.home, a.spread);
    later(2500 + i * 6000, () => cycle(a));
  });

  // When the queue changes, everyone still waiting moves up.
  let previous = useVillage.getState().queue;
  const unsubscribe = useVillage.subscribe((state) => {
    if (state.queue === previous) return;
    const before = previous;
    previous = state.queue;
    // Agents whose interaction was resolved walk home.
    for (const gone of before) {
      if (!state.queue.some((q) => q.id === gone.id)) {
        const agent = DEMO_AGENTS.find((d) => d.id === gone.agentId);
        if (agent) goHome(agent);
      }
    }
    state.queue.forEach((q, idx) => {
      const prevIdx = before.findIndex((b) => b.id === q.id);
      if (prevIdx !== -1 && prevIdx !== idx) {
        sendToSlot(q.agentId, idx, () => {
          const a = DEMO_AGENTS.find((d) => d.id === q.agentId);
          if (a) store().patchAgent(a.id, { status: "waiting", bubble: a.visit.bubble });
        });
      }
    });
  });

  return () => {
    stopped = true;
    unsubscribe();
    timers.forEach(clearTimeout);
    timers.clear();
  };
}
