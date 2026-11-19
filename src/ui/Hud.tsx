"use client";

import { useEffect } from "react";
import Link from "next/link";

import { ConversationDock } from "@/ui/conversations/ConversationDock";
import { useConversations } from "@/ui/conversations/store";
import { Dispatcher } from "@/ui/dispatch/Dispatcher";
import { ClickUpHqPanel } from "@/ui/hq/ClickUpHqPanel";
import { RosterPanel } from "@/ui/roster/RosterPanel";
import { ActivityPanel } from "@/ui/activity/ActivityPanel";
import { AgentWizard } from "@/ui/wizard/AgentWizard";
import { SignOutButton } from "@/ui/SignOutButton";
import { useUi } from "@/ui/uiStore";
import { sceneBridge } from "@/world/controls";
import { useVillage } from "@/world/store";

export function Hud({ ownerName }: { ownerName: string }) {
  const mode = useVillage((s) => s.mode);
  const queue = useVillage((s) => s.queue);
  const agents = useVillage((s) => s.agents);
  const nearbyAgentId = useVillage((s) => s.nearbyAgentId);
  const panelOpen = useVillage((s) => s.openInteractionId !== null);
  const openInteraction = useVillage((s) => s.openInteraction);
  const nearby = nearbyAgentId ? agents[nearbyAgentId] : undefined;
  const openHq = useUi((s) => s.openHq);
  const hqOpen = useUi((s) => s.hqOpen);
  const openRoster = useUi((s) => s.openRoster);
  const conversations = useConversations((s) => s.conversations);
  const focusConversation = useConversations((s) => s.focus);

  // Walking into ClickUp HQ opens the task overview.
  useEffect(() => {
    sceneBridge.onEnterBuilding((building) => {
      if (building !== "hq") return;
      sceneBridge.unlock();
      openHq();
    });
    return () => sceneBridge.onEnterBuilding(null);
  }, [openHq]);

  return (
    <div className="pointer-events-none absolute inset-0 select-none">
      {/* top-left: title + controls hint */}
      <div className="cozy-card pointer-events-auto absolute left-4 top-4 max-w-xs px-4 py-3">
        <p className="text-lg font-black leading-tight text-wood-dark">Agent Village</p>
        <p className="text-sm text-ink/75">Hi {ownerName}! 👋</p>
        <p className="mt-2 text-xs leading-snug text-ink/70">
          {mode === "walk"
            ? "WASD to walk · Shift to run · E to talk · Esc to free the mouse"
            : "Click the world to walk around · click a waiting agent to talk"}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              sceneBridge.unlock();
              openHq();
            }}
            className="cozy-button bg-[#d9c3f0] px-3 py-1 text-xs"
          >
            ClickUp HQ
          </button>
          <button
            type="button"
            onClick={() => {
              sceneBridge.unlock();
              openRoster();
            }}
            className="cozy-button bg-leaf px-3 py-1 text-xs"
          >
            Agents
          </button>
          <button
            type="button"
            onClick={() => sceneBridge.toDesk()}
            className="cozy-button bg-parchment px-3 py-1 text-xs"
          >
            Back to my desk
          </button>
          <Link href="/settings" className="cozy-button bg-parchment px-3 py-1 text-xs">
            Settings
          </Link>
        </div>
      </div>

      {/* top-right: who is waiting + account */}
      <div className="pointer-events-auto absolute right-4 top-4 flex flex-col items-end gap-3">
        <SignOutButton className="cozy-button bg-cream px-3 py-1 text-xs" />
        <div className="cozy-card w-64 px-4 py-3">
          <p className="text-sm font-black text-wood-dark">
            Waiting for you {queue.length > 0 && <span className="text-berry">({queue.length})</span>}
          </p>
          {queue.length === 0 ? (
            <p className="mt-1 text-xs text-ink/60">Nobody yet — enjoy the quiet. 🌿</p>
          ) : (
            <ul className="mt-2 flex max-h-28 flex-col gap-1.5 overflow-y-auto">
              {queue.map((q) => {
                const a = agents[q.agentId];
                return (
                  <li key={q.id}>
                    <button
                      type="button"
                      // Trigger visits always go through openInteraction (marks the visit as seen, reveals a prepared answer).
                      onClick={() => (q.visitId || !conversations[q.agentId] ? openInteraction(q.id) : focusConversation(q.agentId))}
                      className="flex w-full items-center gap-2 rounded-xl px-2 py-1 text-left hover:bg-parchment focus-visible:outline-2 focus-visible:outline-sky"
                    >
                      <span
                        className="inline-block h-4 w-4 shrink-0 rounded-sm border border-wood-dark"
                        style={{ background: a?.look.body }}
                        aria-hidden
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold">
                          {a?.name ?? "Agent"}
                          {a?.status === "walking" && (
                            <span className="ml-1 text-xs font-semibold text-ink/50">· on the way</span>
                          )}
                          {conversations[q.agentId]?.hidden && (
                            <span className={`ml-1 text-xs font-semibold ${conversations[q.agentId]?.streaming ? "text-ink/50" : "text-leaf"}`}>
                              {conversations[q.agentId]?.streaming ? "· preparing…" : "· ready ✓"}
                            </span>
                          )}
                        </span>
                        <span className="block truncate text-xs text-ink/70">
                          {q.priority === "urgent" && <span className="mr-1 font-black text-berry">⚡</span>}
                          {q.priority === "high" && <span className="mr-1 font-black text-wood">▲</span>}
                          {q.title}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* crosshair in walk mode */}
      {mode === "walk" && !panelOpen && !hqOpen && (
        <div className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cream/90 ring-2 ring-ink/40" />
      )}

      {/* talk prompt */}
      {nearby && !panelOpen && !conversations[nearby.id] && (
        <div className="cozy-card absolute bottom-32 left-1/2 -translate-x-1/2 px-4 py-2 text-sm font-extrabold">
          {mode === "walk" ? (
            <>
              Press <kbd className="rounded border border-wood px-1.5">E</kbd> to talk to {nearby.name}
            </>
          ) : (
            <>Click {nearby.name} to talk</>
          )}
        </div>
      )}

      <Dispatcher />
      <ConversationDock />

      <div className="pointer-events-auto">
        <ClickUpHqPanel />
        <RosterPanel />
        <ActivityPanel />
        <AgentWizard />
      </div>
    </div>
  );
}
