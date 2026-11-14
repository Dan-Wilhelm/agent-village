"use client";

import { useEffect, useTransition } from "react";

import { renameAgentAction } from "@/app/actions/agents";
import { useConversations } from "@/ui/conversations/store";
import { useUi } from "@/ui/uiStore";
import { useVillage } from "@/world/store";

import { useRoster } from "./store";

const STATUS: Record<string, { label: string; color: string }> = {
  idle: { label: "idle", color: "#a9a9a9" },
  walking: { label: "on the way", color: "#6aa3e8" },
  working: { label: "working", color: "#f2a33a" },
  waiting: { label: "waiting for you", color: "#e8576a" },
  training: { label: "in training", color: "#9274bf" },
  error: { label: "problem", color: "#c0392b" },
};
const PRIO: Record<string, string> = { urgent: "⚡ urgent", high: "high", normal: "normal", low: "low" };

/** All agents per company and team, with live status and actions. */
export function RosterPanel() {
  const open = useUi((s) => s.rosterOpen);
  const close = useUi((s) => s.closeRoster);
  const { agents, teams, problems } = useRoster();
  const rename = useRoster((s) => s.rename);
  const live = useVillage((s) => s.agents);
  const openConversation = useConversations((s) => s.open);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;
  const companies = [...new Set(agents.map((a) => a.company))];

  return (
    <div
      className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-ink/35 p-3 sm:p-6"
      role="presentation"
      onClick={close}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="roster-title"
        className="cozy-card flex max-h-full w-full max-w-4xl flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-3 border-b-2 border-parchment px-5 py-3">
          <h2 id="roster-title" className="text-2xl font-black text-wood-dark">
            Agents
          </h2>
          <span className="text-xs text-ink/60">{agents.length} in your village</span>
          <span className="flex-1" />
          <button type="button" onClick={close} className="cozy-button bg-parchment px-3 py-1 text-sm">
            Close
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {problems.length > 0 && (
            <div className="mb-4 rounded-xl bg-berry/10 p-3 text-xs">
              <p className="font-black text-berry">Some agent notes in your vault need fixing:</p>
              <ul className="mt-1 list-disc pl-5">
                {problems.map((p) => (
                  <li key={p.path}>
                    <code>{p.path}</code>: {p.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {companies.map((company) => (
            <div key={company} className="mb-5">
              <h3 className="text-sm font-black uppercase tracking-wide text-ink/60">{company}</h3>
              {teams
                .filter((t) => t.company === company)
                .map((team) => (
                  <div key={team.id} className="mt-2">
                    <p className="text-xs font-bold text-wood">Team {team.name}</p>
                    <ul className="mt-1 grid gap-2 sm:grid-cols-2">
                      {agents
                        .filter((a) => a.company === company && a.team === team.name)
                        .map((a) => {
                          const st = STATUS[live[a.id]?.status ?? "idle"];
                          return (
                            <li key={a.id} className="rounded-2xl border-2 border-parchment bg-white p-3">
                              <div className="flex items-center gap-2">
                                <span className="inline-block h-6 w-6 rounded-md border-2 border-wood-dark" style={{ background: a.look.body }} aria-hidden />
                                <div className="min-w-0 flex-1">
                                  <p className="truncate font-black">{a.name}</p>
                                  <p className="truncate text-xs text-ink/60">{a.role}</p>
                                </div>
                                <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-black text-white" style={{ background: st.color }}>
                                  {st.label}
                                </span>
                              </div>
                              <p className="mt-2 text-xs text-ink/70">
                                <span className="font-bold">{PRIO[a.priority]}</span> · {a.kind} · {a.triggers.join(" · ")}
                                {!a.introduced && <span className="ml-1 font-bold text-berry">· not introduced yet</span>}
                              </p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    close();
                                    openConversation(a.id, a.name, { visitTitle: "You called" });
                                  }}
                                  className="cozy-button bg-leaf px-3 py-1 text-xs"
                                >
                                  Call
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    close();
                                    openConversation(a.id, a.name, { mode: "training", visitTitle: "Training" });
                                  }}
                                  className="cozy-button bg-parchment px-3 py-1 text-xs"
                                >
                                  Train
                                </button>
                                <button
                                  type="button"
                                  disabled={pending}
                                  onClick={() => {
                                    const name = window.prompt(`New name for ${a.name} (${a.role})`, a.name);
                                    if (!name || name.trim() === a.name) return;
                                    start(async () => {
                                      const r = await renameAgentAction(a.id, name);
                                      if (r.ok) {
                                        rename(a.id, r.name);
                                        useVillage.getState().patchAgent(a.id, { name: r.name });
                                      } else window.alert(r.message);
                                    });
                                  }}
                                  className="cozy-button bg-white px-3 py-1 text-xs"
                                >
                                  Rename
                                </button>
                              </div>
                            </li>
                          );
                        })}
                    </ul>
                  </div>
                ))}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
