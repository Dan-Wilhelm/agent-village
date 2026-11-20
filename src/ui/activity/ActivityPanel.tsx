"use client";

import { useEffect, useState } from "react";

import { getActivity } from "@/app/actions/authoring";
import { useRoster } from "@/ui/roster/store";
import { useUi } from "@/ui/uiStore";

type Entry = Awaited<ReturnType<typeof getActivity>>[number];

const LABEL: Record<string, string> = {
  "clickup.comment_posted": "posted a comment in ClickUp",
  "clickup.task_changed": "changed a task in ClickUp",
  "clickup.task_created": "created a task in ClickUp",
  "clickup.mission_control_message": "messaged Mission Control",
  "vault.rule_learned": "learned a playbook rule",
  "vault.rule_changed": "changed a playbook rule",
  "vault.rule_removed": "removed a playbook rule",
  "vault.meeting_notes_saved": "saved meeting notes",
  "visits.created": "scheduled visits",
  "agent.created": "created an agent",
  "agent.updated": "changed agent settings",
  "agent.archived": "archived an agent",
  "agent.renamed": "renamed an agent",
  "team.created": "created a team",
  "team.copied": "copied a team",
  "company.created": "created a company",
  "push.subscribed": "turned on notifications",
  "figma.connected": "connected Figma",
  "figma.disconnected": "disconnected Figma",
  "figma.comment_posted": "commented in Figma",
  "push.unsubscribed": "turned off notifications",
};

function describe(action: string) {
  if (LABEL[action]) return LABEL[action];
  if (action.startsWith("proposal.rejected.")) return `rejected a proposal (${action.split(".").at(-1)})`;
  return action;
}

/** Every agent action (and every settings change) — newest first. Content is never logged. */
export function ActivityPanel() {
  const open = useUi((s) => s.activityOpen);
  const close = useUi((s) => s.closeActivity);
  const agents = useRoster((s) => s.agents);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getActivity(150)
      .then((r) => {
        if (!cancelled) setEntries(r);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load the activity log.");
      });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => {
      cancelled = true;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  if (!open) return null;
  const who = (actor: string) => {
    if (actor === "owner") return "You";
    if (actor === "system") return "Village";
    const id = actor.replace(/^agent:/, "");
    const a = agents.find((x) => x.id === id);
    return a ? `${a.name} (${a.role})` : id;
  };

  return (
    <div className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-ink/35 p-3 sm:p-6" role="presentation" onClick={close} onKeyDown={(e) => e.stopPropagation()}>
      <section role="dialog" aria-modal="true" aria-labelledby="activity-title" className="cozy-card flex max-h-full w-full max-w-2xl flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center gap-3 border-b-2 border-parchment px-5 py-3">
          <h2 id="activity-title" className="text-xl font-black text-wood-dark">
            Activity
          </h2>
          <span className="text-xs text-ink/60">what happened, without content</span>
          <span className="flex-1" />
          <button type="button" onClick={close} className="cozy-button bg-parchment px-3 py-1 text-sm">
            Close
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {error && <p className="text-sm font-bold text-berry">{error}</p>}
          {!entries && !error && <p className="text-sm text-ink/60">Loading…</p>}
          {entries?.length === 0 && <p className="text-sm text-ink/60">Nothing yet.</p>}
          <ul className="divide-y divide-parchment">
            {entries?.map((e) => {
              const details = Object.entries(e.details ?? {})
                .filter(([, v]) => v !== null && v !== undefined && v !== "")
                .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") || "–" : typeof v === "object" ? JSON.stringify(v) : String(v)}`)
                .join(" · ");
              return (
                <li key={e.id} className="flex gap-3 py-2 text-sm">
                  <time className="w-28 shrink-0 text-xs text-ink/60" dateTime={e.at}>
                    {new Date(e.at).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </time>
                  <div className="min-w-0">
                    <p>
                      <span className="font-bold">{who(e.actor)}</span> {describe(e.action)}
                    </p>
                    {details && <p className="truncate text-xs text-ink/50">{details}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </section>
    </div>
  );
}
