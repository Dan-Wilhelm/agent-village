"use client";

import { useEffect, useState, useTransition } from "react";

import { renameAgentAction } from "@/app/actions/agents";
import { archiveAgentAction, copyTeamAction, createCompanyAction, getWizardOptions } from "@/app/actions/authoring";
import { useConversations } from "@/ui/conversations/store";
import { useUi } from "@/ui/uiStore";
import { useVillage } from "@/world/store";

import { reloadRoster } from "./reload";
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
  const openWizard = useUi((s) => s.openWizard);
  const openActivity = useUi((s) => s.openActivity);
  const [pending, start] = useTransition();
  const [copying, setCopying] = useState<{ id: string; name: string; company: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
          <button type="button" onClick={() => openActivity()} className="cozy-button bg-white px-3 py-1 text-sm">
            Activity
          </button>
          <button type="button" onClick={() => openWizard({ mode: "create" })} className="cozy-button bg-leaf px-3 py-1 text-sm">
            + New agent
          </button>
          <button type="button" onClick={close} className="cozy-button bg-parchment px-3 py-1 text-sm">
            Close
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {notice && (
            <p role="status" className="mb-3 rounded-xl bg-leaf/15 px-3 py-2 text-xs font-bold text-ink">
              {notice}
            </p>
          )}
          {copying && (
            <CopyTeamDialog
              team={copying}
              onCancel={() => setCopying(null)}
              onDone={(msg) => {
                setCopying(null);
                setNotice(msg);
              }}
            />
          )}
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
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-bold text-wood">
                        Team {team.name}
                        {team.lead && <span className="ml-1 text-ink/50">· lead: {agents.find((a) => a.id === team.lead)?.name ?? "?"}</span>}
                      </p>
                      <button type="button" onClick={() => setCopying({ id: team.id, name: team.name, company })} className="text-[11px] font-bold text-ink/60 underline">
                        Copy team…
                      </button>
                    </div>
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
                                <button type="button" onClick={() => openWizard({ mode: "edit", agentId: a.id })} className="cozy-button bg-white px-3 py-1 text-xs">
                                  Settings
                                </button>
                                <button
                                  type="button"
                                  disabled={pending}
                                  onClick={() => {
                                    if (!window.confirm(`Archive ${a.name} (${a.role})? The agent leaves the village; its notes move to the Archive folder in your vault.`)) return;
                                    start(async () => {
                                      const r = await archiveAgentAction(a.id);
                                      if (!r.ok) return window.alert(r.message);
                                      useConversations.getState().close(a.id);
                                      await reloadRoster().catch(() => null);
                                      setNotice(`${a.name} was archived (${r.archivedTo}).`);
                                    });
                                  }}
                                  className="cozy-button bg-white px-3 py-1 text-xs text-berry"
                                >
                                  Archive
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

/** Copy a team (its structure + each agent's craft) into another company. */
function CopyTeamDialog({ team, onCancel, onDone }: { team: { id: string; name: string; company: string }; onCancel: () => void; onDone: (msg: string) => void }) {
  const [companies, setCompanies] = useState<Array<{ id: string; name: string; connected: boolean }> | null>(null);
  const [target, setTarget] = useState("");
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    getWizardOptions()
      .then((o) => {
        const others = o.companies.filter((c) => c.name !== team.company);
        setCompanies(others);
        setTarget(others[0]?.id ?? "__new");
      })
      .catch(() => setError("Could not load companies."));
  }, [team.company]);

  const copy = () =>
    start(async () => {
      setError(null);
      let companyId = target;
      let companyName = companies?.find((c) => c.id === target)?.name ?? "";
      if (target === "__new") {
        const c = await createCompanyAction(newName);
        if (!c.ok) return setError(c.message);
        companyId = c.companyId;
        companyName = c.name;
      }
      const r = await copyTeamAction(team.id, companyId);
      if (!r.ok) return setError(r.message);
      await reloadRoster().catch(() => null);
      onDone(`Team ${team.name} was copied to ${companyName} (${r.copied.length} agents). They bring their craft, learn ${companyName} from scratch and introduce themselves there.`);
    });

  return (
    <div className="mb-4 rounded-2xl border-2 border-wood bg-cream p-4 text-sm">
      <p className="font-black text-wood-dark">Copy team {team.name} to another company</p>
      <p className="mt-1 text-xs text-ink/70">
        The agents take their craft (how the job is done) with them. Company context, approvals “without asking” and introductions start fresh.
      </p>
      {!companies ? (
        <p className="mt-2 text-xs text-ink/60">{error ?? "Loading…"}</p>
      ) : (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="mb-1 block text-xs font-black text-ink/70">Target company</span>
            <select className="wiz-input" value={target} onChange={(e) => setTarget(e.target.value)}>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.connected ? "" : " (not connected)"}
                </option>
              ))}
              <option value="__new">+ New company…</option>
            </select>
          </label>
          {target === "__new" && (
            <label className="block">
              <span className="mb-1 block text-xs font-black text-ink/70">Company name</span>
              <input className="wiz-input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Medawi" />
            </label>
          )}
          <button type="button" disabled={pending || (target === "__new" && newName.trim().length < 2)} onClick={copy} className="cozy-button bg-leaf px-3 py-1.5 text-xs disabled:opacity-50">
            {pending ? "Copying…" : "Copy team"}
          </button>
          <button type="button" disabled={pending} onClick={onCancel} className="cozy-button bg-parchment px-3 py-1.5 text-xs">
            Cancel
          </button>
        </div>
      )}
      {error && companies && <p className="mt-2 text-xs font-bold text-berry">{error}</p>}
    </div>
  );
}
