"use client";

import { useConversations } from "@/ui/conversations/store";
import { summonAgent } from "@/world/director";
import { useVillage, type Priority } from "@/world/store";

/**
 * Picks up visits created by triggers (every 30 s while the village is visible)
 * and sends the agents walking to the office. Visits carry no content: the
 * agent builds the briefing live once the owner opens the conversation.
 */
interface ServerVisit {
  id: string;
  agentId: string;
  reason: string;
  priority: Priority;
  dueAt: string;
}

const POLL_MS = 30_000;

function openingFor(v: ServerVisit) {
  const at = new Date(v.dueAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
  return `[Visit started by your trigger "${v.reason}" (due ${at}). Dan just opened the door — start with what he needs from you right now. Build everything live from the tools.]`;
}

export function startVisitPolling(): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = async () => {
    if (stopped) return;
    if (document.visibilityState === "visible") {
      try {
        const res = await fetch("/api/visits", { cache: "no-store" });
        if (res.ok) {
          const { visits } = (await res.json()) as { visits: ServerVisit[] };
          const queue = useVillage.getState().queue;
          for (const v of visits) {
            if (queue.some((q) => q.visitId === v.id)) continue;
            // If the agent is already at the desk for something else, the visit waits for the next round.
            if (queue.some((q) => q.agentId === v.agentId)) continue;
            const opening = openingFor(v);
            summonAgent(v.agentId, { title: v.reason, body: opening, priority: v.priority, visitId: v.id });
            // Option 1: the agent starts working while it walks over — ready when Dan opens the visit.
            const name = useVillage.getState().agents[v.agentId]?.name ?? "Agent";
            useConversations.getState().prepare(v.agentId, name, { opening, triggerLabel: `⏰ ${v.reason}`, visitId: v.id });
          }
        }
      } catch {
        /* offline — try again next round */
      }
    }
    if (!stopped) timer = setTimeout(tick, POLL_MS);
  };

  const onVisible = () => {
    if (document.visibilityState === "visible" && timer) {
      clearTimeout(timer);
      void tick();
    }
  };
  document.addEventListener("visibilitychange", onVisible);
  void tick();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
