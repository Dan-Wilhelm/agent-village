"use client";

import { useEffect, useRef } from "react";

import { useVillage } from "@/world/store";

/** The 2D panel that opens when you talk to an agent. Phase 3 adds approvals, previews and feedback. */
export function InteractionPanel() {
  const openId = useVillage((s) => s.openInteractionId);
  const interaction = useVillage((s) => s.queue.find((q) => q.id === s.openInteractionId));
  const agent = useVillage((s) => (interaction ? s.agents[interaction.agentId] : undefined));
  const resolve = useVillage((s) => s.resolve);
  const closePanel = useVillage((s) => s.closePanel);
  const primary = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!openId) return;
    primary.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePanel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId, closePanel]);

  if (!interaction || !agent) return null;

  return (
    <div
      className="absolute inset-0 flex items-center justify-center bg-ink/30 p-4"
      onClick={closePanel}
      role="presentation"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="interaction-title"
        className="cozy-card w-full max-w-lg p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-3">
          <span
            className="inline-block h-10 w-10 shrink-0 rounded-lg border-2 border-wood-dark"
            style={{ background: agent.look.body }}
            aria-hidden
          />
          <div>
            <p className="text-sm font-bold text-ink/60">
              {agent.name} · {agent.role}
            </p>
            <h2 id="interaction-title" className="text-xl font-black text-wood-dark">
              {interaction.title}
            </h2>
          </div>
        </header>
        <p className="mt-4 leading-relaxed text-ink/90">{interaction.body}</p>
        <footer className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={closePanel} className="cozy-button bg-parchment px-4 py-2">
            Later
          </button>
          <button
            ref={primary}
            type="button"
            onClick={() => resolve(interaction.id)}
            className="cozy-button bg-leaf px-4 py-2 text-ink"
          >
            Got it
          </button>
        </footer>
      </section>
    </div>
  );
}
