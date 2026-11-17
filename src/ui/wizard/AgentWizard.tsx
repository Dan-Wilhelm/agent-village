"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";

import {
  createAgentAction,
  getAgentForEdit,
  getWizardOptions,
  suggestAgentAction,
  updateAgentAction,
} from "@/app/actions/authoring";
import type { AgentInput } from "@/agents/authoring-format";
import { useConversations } from "@/ui/conversations/store";
import { reloadRoster } from "@/ui/roster/reload";
import { useUi } from "@/ui/uiStore";
import { useVoiceInput } from "@/ui/voice";

/**
 * Agent wizard: create a new agent (or change an existing one). Asks for the
 * job, the character, what it may read and do (and what without asking), and
 * whether it comes on its own or only when called. Writes to the vault only.
 */

type Options = Awaited<ReturnType<typeof getWizardOptions>>;
type Day = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
type Hat = AgentInput["look"]["hat"];
type Permission = AgentInput["permissions"][number];
type AutoKind = AgentInput["auto_approve"][number];

interface Form {
  company: string;
  team: string; // existing team name, or "__new"
  newTeamName: string;
  newTeamMission: string;
  role: string;
  name: string;
  mission: string;
  routing: string;
  craft: string;
  toConfirm: string;
  kind: AgentInput["kind"];
  language: Array<"de" | "en">;
  priority: AgentInput["priority"];
  body: string;
  accent: string;
  hat: Hat;
  home: AgentInput["home"];
  permissions: Permission[];
  autoApprove: AutoKind[];
  comesAuto: boolean;
  scheduleOn: boolean;
  days: Day[];
  times: string;
  eventOn: boolean;
  eventMinutes: number;
  eventMatch: string;
}

const DAYS: Array<[Day, string]> = [
  ["mon", "Mo"],
  ["tue", "Tu"],
  ["wed", "We"],
  ["thu", "Th"],
  ["fri", "Fr"],
  ["sat", "Sa"],
  ["sun", "Su"],
];
const HATS: Hat[] = ["none", "cap", "beanie", "bow", "crown"];
const HOMES: Array<[AgentInput["home"], string]> = [
  ["workshop", "Workshop"],
  ["library", "Library"],
  ["hq", "ClickUp HQ"],
  ["training", "Training ground"],
  ["office", "Your office"],
];
const READ: Array<[Permission, string, string]> = [
  ["read_tasks", "Tasks", "statuses, due dates, fields, descriptions"],
  ["read_comments", "Comments", "what was last done on a task"],
  ["read_calendar", "Calendar", "your upcoming meetings"],
  ["read_meeting_notes", "Meeting notes & docs", "your saved notes and ClickUp docs"],
];
const ACT: Array<[Permission, AutoKind, string, string]> = [
  ["draft_task", "draft_task", "Create tasks", "as drafts in your private drafts list"],
  ["propose_comment", "comment", "Comment on tasks", "written as you"],
  ["propose_change", "task_change", "Change tasks", "status, due date, priority"],
  ["message_mission_control", "mission_control_message", "Message Mission Control", "DM as you"],
];

const emptyForm = (company: string): Form => ({
  company,
  team: "",
  newTeamName: "",
  newTeamMission: "",
  role: "",
  name: "",
  mission: "",
  routing: "",
  craft: "",
  toConfirm: "",
  kind: "intelligent",
  language: ["de", "en"],
  priority: "normal",
  body: "#9ad0a0",
  accent: "#4f7a52",
  hat: "cap",
  home: "workshop",
  permissions: ["read_tasks"],
  autoApprove: [],
  comesAuto: false,
  scheduleOn: true,
  days: ["mon", "tue", "wed", "thu", "fri"],
  times: "09:00",
  eventOn: false,
  eventMinutes: 10,
  eventMatch: "client meetings",
});

function fromInput(input: AgentInput): Form {
  const schedule = input.triggers.find((t) => t.type === "schedule");
  const event = input.triggers.find((t) => t.type === "before_event");
  const f = emptyForm(input.company);
  return {
    ...f,
    team: "existing" in input.team ? input.team.existing : "__new",
    role: input.role,
    name: input.name,
    mission: input.mission,
    routing: input.routing,
    kind: input.kind,
    language: input.language,
    priority: input.priority,
    body: input.look.body,
    accent: input.look.accent,
    hat: input.look.hat,
    home: input.home,
    permissions: input.permissions,
    autoApprove: input.auto_approve,
    comesAuto: Boolean(schedule || event),
    scheduleOn: Boolean(schedule) || !event,
    days: schedule?.type === "schedule" ? (schedule.days as Day[]) : f.days,
    times: schedule?.type === "schedule" ? [schedule.time].flat().join(", ") : f.times,
    eventOn: Boolean(event),
    eventMinutes: event?.type === "before_event" ? event.minutes : f.eventMinutes,
    eventMatch: event?.type === "before_event" ? event.match : f.eventMatch,
  };
}

const parseTimes = (text: string) =>
  text
    .split(/[,\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => (/^\d:\d\d$/.test(t) ? `0${t}` : t));
const validTime = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

function toInput(f: Form): AgentInput {
  const triggers: AgentInput["triggers"] = [];
  if (f.comesAuto && f.scheduleOn) {
    const times = parseTimes(f.times);
    triggers.push({ type: "schedule", days: f.days, time: times.length === 1 ? times[0] : times });
  }
  if (f.comesAuto && f.eventOn) triggers.push({ type: "before_event", minutes: f.eventMinutes, match: f.eventMatch.trim() || "meetings" });
  triggers.push({ type: "on_call" });
  return {
    company: f.company,
    team: f.team === "__new" ? { create: { name: f.newTeamName.trim(), mission: f.newTeamMission.trim() } } : { existing: f.team },
    role: f.role.trim(),
    name: f.name.trim(),
    mission: f.mission.trim(),
    routing: f.routing.trim(),
    craft: f.craft.trim(),
    context: "",
    to_confirm: f.toConfirm
      .split("\n")
      .map((l) => l.replace(/^[-*•\d.)\s]+/, "").trim())
      .filter((l) => l.length >= 3)
      .slice(0, 12),
    kind: f.kind,
    language: f.language,
    priority: f.priority,
    look: { body: f.body, accent: f.accent, hat: f.hat },
    home: f.home,
    triggers,
    permissions: f.permissions,
    auto_approve: f.autoApprove.filter((k) => ACT.some(([p, kind]) => kind === k && f.permissions.includes(p))),
  };
}

/** Problems that block the given step (empty = ok). */
function problemsFor(step: string, f: Form): string[] {
  const p: string[] = [];
  if (step === "job") {
    if (!f.team) p.push("Pick a team.");
    if (f.team === "__new" && f.newTeamName.trim().length < 2) p.push("Name the new team.");
    if (f.role.trim().length < 2) p.push("Give the role a title.");
    if (/[/\\:*?"<>|#^[\]{}]/.test(f.role)) p.push("The role can't contain / \\ : * ? \" < > | # ^ [ ].");
    if (f.mission.trim().length < 10) p.push("Describe the mission in a sentence or two.");
    if (f.language.length === 0) p.push("Pick at least one language.");
  }
  if (step === "character" && !f.name.trim()) p.push("Give the character a name.");
  if (step === "visits" && f.comesAuto) {
    if (!f.scheduleOn && !f.eventOn) p.push("Pick a schedule or calendar events — or choose “only when I call”.");
    if (f.scheduleOn && f.days.length === 0) p.push("Pick at least one day.");
    if (f.scheduleOn && (parseTimes(f.times).length === 0 || !parseTimes(f.times).every(validTime))) p.push("Times as HH:MM, e.g. 08:00, 13:00.");
  }
  return p;
}

export function AgentWizard() {
  const wizard = useUi((s) => s.wizard);
  const close = useUi((s) => s.closeWizard);
  if (!wizard) return null;
  return <WizardDialog key={wizard.mode === "edit" ? wizard.agentId : "new"} wizard={wizard} onClose={close} />;
}

function WizardDialog({ wizard, onClose }: { wizard: { mode: "create" } | { mode: "edit"; agentId: string }; onClose: () => void }) {
  const editing = wizard.mode === "edit";
  const steps = editing ? ["job", "character", "abilities", "visits", "check"] : ["describe", "job", "character", "abilities", "visits", "check"];
  const [step, setStep] = useState(0);
  const [options, setOptions] = useState<Options | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ agentId: string; name: string } | null>(null);
  const [pending, start] = useTransition();
  const openConversation = useConversations((s) => s.open);
  const onVoice = useCallback((t: string) => setDescription((d) => (d ? `${d} ${t}` : t)), []);
  const voice = useVoiceInput(onVoice);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const opts = await getWizardOptions();
      if (cancelled) return;
      setOptions(opts);
      if (wizard.mode === "edit") {
        const r = await getAgentForEdit(wizard.agentId);
        if (cancelled) return;
        if (r.ok) setForm(fromInput(r.input));
        else setError(r.message);
      } else {
        const first = opts.companies.find((c) => c.connected) ?? opts.companies[0];
        const f = emptyForm(first?.id ?? "");
        const firstTeam = opts.teams.find((t) => t.company === first?.name);
        setForm({ ...f, team: firstTeam?.name ?? "__new" });
      }
    })().catch(() => setError("Could not load the wizard."));
    return () => {
      cancelled = true;
    };
  }, [wizard]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !pending && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));
  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

  const company = options?.companies.find((c) => c.id === form?.company);
  const teams = useMemo(() => options?.teams.filter((t) => t.company === company?.name) ?? [], [options, company]);
  const current = steps[step];
  const blockers = form ? problemsFor(current, form) : [];

  const suggest = () =>
    start(async () => {
      if (!form) return;
      setError(null);
      const r = await suggestAgentAction(description, form.company);
      if (!r.ok) return setError(r.message);
      const s = r.suggestion;
      setForm({
        ...form,
        role: s.role,
        name: s.name,
        mission: s.mission,
        routing: s.routing,
        craft: s.craft,
        toConfirm: s.to_confirm.join("\n"),
        kind: s.kind,
        language: s.language.length ? s.language : form.language,
        priority: s.priority,
        hat: s.hat,
        home: s.home,
        permissions: s.permissions.length ? s.permissions : ["read_tasks"],
        autoApprove: s.auto_approve,
        comesAuto: s.comes_automatically,
        scheduleOn: s.schedule_days.length > 0 && s.schedule_times.length > 0,
        days: s.schedule_days.length ? s.schedule_days : form.days,
        times: s.schedule_times.length ? s.schedule_times.join(", ") : form.times,
        eventOn: s.before_meetings_minutes > 0,
        eventMinutes: s.before_meetings_minutes > 0 ? Math.min(240, s.before_meetings_minutes) : form.eventMinutes,
        eventMatch: s.meeting_match || form.eventMatch,
      });
      setStep(1);
    });

  const save = () =>
    start(async () => {
      if (!form) return;
      setError(null);
      const input = toInput(form);
      const r = editing ? await updateAgentAction(wizard.agentId, input) : await createAgentAction(input);
      if (!r.ok) return setError(r.message);
      await reloadRoster().catch(() => null);
      setDone({ agentId: r.agentId, name: input.name });
    });

  return (
    <div className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center bg-ink/40 p-3 sm:p-6" onKeyDown={(e) => e.stopPropagation()} onKeyUp={(e) => e.stopPropagation()}>
      <section role="dialog" aria-modal="true" aria-labelledby="wizard-title" className="cozy-card flex max-h-full w-full max-w-2xl flex-col overflow-hidden">
        <header className="flex items-center gap-3 border-b-2 border-parchment px-5 py-3">
          <h2 id="wizard-title" className="text-xl font-black text-wood-dark">
            {editing ? `Settings${form ? ` — ${form.name}` : ""}` : "New agent"}
          </h2>
          <span className="flex-1" />
          <button type="button" onClick={onClose} disabled={pending} className="cozy-button bg-parchment px-3 py-1 text-sm">
            Close
          </button>
        </header>

        {!done && (
          <ol className="flex gap-1 overflow-x-auto px-5 pt-3 text-[11px] font-black uppercase tracking-wide" aria-label="Steps">
            {steps.map((s, i) => (
              <li key={s} aria-current={i === step ? "step" : undefined} className={`rounded-full px-2 py-0.5 ${i === step ? "bg-wood text-cream" : i < step ? "bg-leaf/30 text-ink" : "bg-ink/5 text-ink/50"}`}>
                {i + 1}. {STEP_LABEL[s]}
              </li>
            ))}
          </ol>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-sm">
          {!form || !options ? (
            <p className="text-ink/60">{error ?? "Loading…"}</p>
          ) : done ? (
            <div className="space-y-3 py-4 text-center">
              <p className="text-3xl" aria-hidden>
                🏡
              </p>
              <p className="text-lg font-black text-wood-dark">{editing ? `${done.name} is updated.` : `${done.name} is moving in!`}</p>
              <p className="text-ink/70">
                {editing
                  ? "The new settings apply from the next conversation."
                  : `${done.name} lives in the ${HOMES.find(([h]) => h === form.home)?.[1] ?? "village"} now. On the first visit ${done.name} introduces themself and asks the open questions.`}
              </p>
              <div className="flex justify-center gap-2">
                {!editing && (
                  <button
                    type="button"
                    className="cozy-button bg-leaf px-4 py-2"
                    onClick={() => {
                      onClose();
                      openConversation(done.agentId, done.name, { visitTitle: "Introduction" });
                    }}
                  >
                    Introduce now
                  </button>
                )}
                <button type="button" className="cozy-button bg-parchment px-4 py-2" onClick={onClose}>
                  Done
                </button>
              </div>
            </div>
          ) : (
            <>
              {current === "describe" && (
                <div className="space-y-3">
                  <p className="text-ink/80">Describe the new agent in a sentence or two — what should it do for you, and when? Claude fills in the form; you can change everything afterwards.</p>
                  <Field label="Company">
                    <select className="wiz-input" value={form.company} onChange={(e) => {
                      const c = options.companies.find((x) => x.id === e.target.value);
                      setForm({ ...form, company: e.target.value, team: options.teams.find((t) => t.company === c?.name)?.name ?? "__new" });
                    }}>
                      {options.companies.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                          {c.connected ? "" : " (not connected)"}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div className="relative">
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={5}
                      aria-label="Describe the agent"
                      placeholder="e.g. A process consultant who looks at our recurring tasks once a week and tells me where we waste time, with concrete improvement ideas."
                      className="wiz-input w-full resize-y"
                    />
                    {voice.supported && (
                      <button
                        type="button"
                        aria-pressed={voice.listening}
                        aria-label={voice.listening ? "Stop listening" : "Speak"}
                        onClick={() => (voice.listening ? voice.stop() : voice.start())}
                        className={`cozy-button absolute bottom-3 right-2 h-8 w-8 ${voice.listening ? "bg-berry text-cream" : "bg-parchment"}`}
                      >
                        🎙
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={pending || description.trim().length < 10} onClick={suggest} className="cozy-button bg-leaf px-4 py-2 disabled:opacity-50">
                      {pending ? "Claude is drafting…" : "✨ Fill in for me"}
                    </button>
                    <button type="button" disabled={pending} onClick={() => setStep(1)} className="cozy-button bg-parchment px-4 py-2">
                      I&apos;ll fill it in myself
                    </button>
                  </div>
                </div>
              )}

              {current === "job" && (
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Company">
                      <select className="wiz-input" disabled={editing} value={form.company} onChange={(e) => {
                        const c = options.companies.find((x) => x.id === e.target.value);
                        setForm({ ...form, company: e.target.value, team: options.teams.find((t) => t.company === c?.name)?.name ?? "__new" });
                      }}>
                        {options.companies.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Team">
                      <select className="wiz-input" disabled={editing} value={form.team} onChange={(e) => set("team", e.target.value)}>
                        {teams.map((t) => (
                          <option key={t.id} value={t.name}>
                            {t.name}
                          </option>
                        ))}
                        {!editing && <option value="__new">+ New team…</option>}
                      </select>
                    </Field>
                  </div>
                  {form.team === "__new" && !editing && (
                    <div className="grid gap-3 rounded-xl bg-parchment/50 p-3 sm:grid-cols-2">
                      <Field label="New team name">
                        <input className="wiz-input" value={form.newTeamName} onChange={(e) => set("newTeamName", e.target.value)} placeholder="e.g. Continuous Improvement" />
                      </Field>
                      <Field label="Team mission (optional)">
                        <input className="wiz-input" value={form.newTeamMission} onChange={(e) => set("newTeamMission", e.target.value)} />
                      </Field>
                    </div>
                  )}
                  {company && !company.connected && (
                    <p className="rounded-xl bg-berry/10 px-3 py-2 text-xs font-bold text-berry">
                      {company.name} has no connected work environment yet — its agents can talk and learn, but can&apos;t read or change anything in ClickUp.
                    </p>
                  )}
                  <Field label="Role (also the folder name in your vault)">
                    <input className="wiz-input" disabled={editing} value={form.role} onChange={(e) => set("role", e.target.value)} placeholder="e.g. Process Consultant" />
                  </Field>
                  <Field label="Mission — what it does for you">
                    <textarea className="wiz-input" rows={3} value={form.mission} onChange={(e) => set("mission", e.target.value)} />
                  </Field>
                  <Field label="When should requests go to it? (keywords for “I want to …”)">
                    <input className="wiz-input" value={form.routing} onChange={(e) => set("routing", e.target.value)} />
                  </Field>
                  {!editing && (
                    <>
                      <Field label="Starting playbook — how the job is done (optional)">
                        <textarea className="wiz-input font-mono text-xs" rows={6} value={form.craft} onChange={(e) => set("craft", e.target.value)} />
                      </Field>
                      <Field label="Questions it asks you when it introduces itself (one per line)">
                        <textarea className="wiz-input" rows={3} value={form.toConfirm} onChange={(e) => set("toConfirm", e.target.value)} />
                      </Field>
                    </>
                  )}
                  <Field label="Kind" group>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {(
                        [
                          ["simple", "Simple", "Routine lists and reminders. Fast and cheap."],
                          ["intelligent", "Intelligent", "Judgement, writing, consulting. Learns from feedback."],
                          ["lead", "Team lead", "Orchestrates the team: hands work to members and combines it."],
                        ] as const
                      ).map(([k, label, hint]) => (
                        <label key={k} className={`cursor-pointer rounded-xl border-2 p-2 ${form.kind === k ? "border-wood bg-parchment" : "border-parchment"}`}>
                          <input type="radio" name="kind" className="sr-only" checked={form.kind === k} onChange={() => set("kind", k)} />
                          <span className="block font-black">{label}</span>
                          <span className="block text-xs text-ink/70">{hint}</span>
                        </label>
                      ))}
                    </div>
                  </Field>
                  <Field label="Languages" group>
                    <div className="flex gap-3">
                      {(["de", "en"] as const).map((l) => (
                        <label key={l} className="flex items-center gap-1">
                          <input type="checkbox" checked={form.language.includes(l)} onChange={() => set("language", toggle(form.language, l))} />
                          {l === "de" ? "German" : "English"}
                        </label>
                      ))}
                    </div>
                  </Field>
                </div>
              )}

              {current === "character" && (
                <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
                  <div className="space-y-3">
                    <Field label="Name (you can rename it any time)">
                      <input className="wiz-input" value={form.name} onChange={(e) => set("name", e.target.value)} />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Clothes">
                        <input type="color" className="h-9 w-full cursor-pointer rounded-lg" value={form.body} onChange={(e) => set("body", e.target.value)} />
                      </Field>
                      <Field label="Accent">
                        <input type="color" className="h-9 w-full cursor-pointer rounded-lg" value={form.accent} onChange={(e) => set("accent", e.target.value)} />
                      </Field>
                    </div>
                    <Field label="Hat" group>
                      <div className="flex flex-wrap gap-1">
                        {HATS.map((h) => (
                          <button key={h} type="button" aria-pressed={form.hat === h} onClick={() => set("hat", h)} className={`rounded-full px-3 py-1 text-xs font-bold ${form.hat === h ? "bg-wood text-cream" : "bg-ink/5"}`}>
                            {h}
                          </button>
                        ))}
                      </div>
                    </Field>
                    <Field label="Lives in">
                      <select className="wiz-input" value={form.home} onChange={(e) => set("home", e.target.value as Form["home"])}>
                        {HOMES.map(([h, label]) => (
                          <option key={h} value={h}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <VoxelPreview body={form.body} accent={form.accent} hat={form.hat} name={form.name} />
                </div>
              )}

              {current === "abilities" && (
                <div className="space-y-4">
                  <div>
                    <p className="font-black text-wood-dark">What may it read?</p>
                    <p className="text-xs text-ink/60">Always live, never copied.</p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {READ.map(([p, label, hint]) => (
                        <label key={p} className="flex items-start gap-2 rounded-xl bg-ink/5 p-2">
                          <input type="checkbox" className="mt-1" checked={form.permissions.includes(p)} onChange={() => set("permissions", toggle(form.permissions, p))} />
                          <span>
                            <span className="block font-bold">{label}</span>
                            <span className="block text-xs text-ink/60">{hint}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="font-black text-wood-dark">What may it do?</p>
                    <p className="text-xs text-ink/60">Normally it proposes and you approve. Only tick “without asking” for things you truly trust it with — it&apos;s still checked and logged.</p>
                    <div className="mt-2 space-y-2">
                      {ACT.filter(([p]) => p !== "message_mission_control" || company?.hasMissionControl).map(([p, kind, label, hint]) => {
                        const allowed = form.permissions.includes(p);
                        const auto = form.autoApprove.includes(kind);
                        return (
                          <div key={p} className="flex flex-wrap items-center gap-2 rounded-xl bg-ink/5 p-2">
                            <label className="flex flex-1 items-start gap-2">
                              <input type="checkbox" className="mt-1" checked={allowed} onChange={() => {
                                setForm({ ...form, permissions: toggle(form.permissions, p), autoApprove: allowed ? form.autoApprove.filter((k) => k !== kind) : form.autoApprove });
                              }} />
                              <span>
                                <span className="block font-bold">{label}</span>
                                <span className="block text-xs text-ink/60">{hint}</span>
                              </span>
                            </label>
                            <label className={`flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold ${auto ? "bg-berry/15 text-berry" : "text-ink/60"} ${allowed ? "" : "opacity-40"}`}>
                              <input type="checkbox" disabled={!allowed} checked={auto} onChange={() => set("autoApprove", toggle(form.autoApprove, kind))} />
                              without asking
                            </label>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {current === "visits" && (
                <div className="space-y-4">
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(
                      [
                        [false, "Only when I call", "It waits at home until you call it or the dispatcher sends it."],
                        [true, "Comes on its own", "On a schedule and/or before calendar events — with a notification."],
                      ] as const
                    ).map(([v, label, hint]) => (
                      <label key={label} className={`cursor-pointer rounded-xl border-2 p-3 ${form.comesAuto === v ? "border-wood bg-parchment" : "border-parchment"}`}>
                        <input type="radio" name="comes" className="sr-only" checked={form.comesAuto === v} onChange={() => set("comesAuto", v)} />
                        <span className="block font-black">{label}</span>
                        <span className="block text-xs text-ink/70">{hint}</span>
                      </label>
                    ))}
                  </div>
                  {form.comesAuto && (
                    <div className="space-y-3 rounded-xl bg-parchment/50 p-3">
                      <label className="flex items-center gap-2 font-bold">
                        <input type="checkbox" checked={form.scheduleOn} onChange={() => set("scheduleOn", !form.scheduleOn)} />
                        On a schedule
                      </label>
                      {form.scheduleOn && (
                        <div className="ml-6 space-y-2">
                          <div className="flex flex-wrap gap-1">
                            {DAYS.map(([d, label]) => (
                              <button key={d} type="button" aria-pressed={form.days.includes(d)} onClick={() => set("days", toggle(form.days, d))} className={`h-8 w-9 rounded-lg text-xs font-black ${form.days.includes(d) ? "bg-wood text-cream" : "bg-white"}`}>
                                {label}
                              </button>
                            ))}
                          </div>
                          <Field label="Times (Berlin), comma-separated">
                            <input className="wiz-input" value={form.times} onChange={(e) => set("times", e.target.value)} placeholder="08:00, 13:00" />
                          </Field>
                        </div>
                      )}
                      <label className="flex items-center gap-2 font-bold">
                        <input type="checkbox" checked={form.eventOn} onChange={() => set("eventOn", !form.eventOn)} />
                        Before calendar events
                      </label>
                      {form.eventOn && (
                        <div className="ml-6 grid gap-2 sm:grid-cols-[8rem_1fr]">
                          <Field label="Minutes before">
                            <input type="number" min={1} max={240} className="wiz-input" value={form.eventMinutes} onChange={(e) => set("eventMinutes", Math.max(1, Math.min(240, Number(e.target.value) || 10)))} />
                          </Field>
                          <Field label="Which events">
                            <input className="wiz-input" value={form.eventMatch} onChange={(e) => set("eventMatch", e.target.value)} placeholder="client meetings" />
                          </Field>
                        </div>
                      )}
                    </div>
                  )}
                  <Field label="Priority when several agents wait for you">
                    <select className="wiz-input" value={form.priority} onChange={(e) => set("priority", e.target.value as Form["priority"])}>
                      <option value="urgent">⚡ Urgent — always first</option>
                      <option value="high">High</option>
                      <option value="normal">Normal</option>
                      <option value="low">Low</option>
                    </select>
                  </Field>
                </div>
              )}

              {current === "check" && <Summary form={form} companyName={company?.name ?? form.company} />}

              {blockers.length > 0 && current !== "describe" && current !== "check" && (
                <ul className="mt-3 list-disc pl-5 text-xs font-bold text-berry">
                  {blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              )}
              {error && (
                <p role="alert" className="mt-3 rounded-xl bg-berry/10 px-3 py-2 text-xs font-bold text-berry">
                  {error}
                </p>
              )}
            </>
          )}
        </div>

        {form && options && !done && current !== "describe" && (
          <footer className="flex items-center gap-2 border-t-2 border-parchment px-5 py-3">
            <button type="button" disabled={step === 0 || pending} onClick={() => setStep(step - 1)} className="cozy-button bg-parchment px-4 py-1.5 text-sm disabled:opacity-40">
              Back
            </button>
            <span className="flex-1" />
            {current === "check" ? (
              <button type="button" disabled={pending} onClick={save} className="cozy-button bg-leaf px-4 py-1.5 text-sm disabled:opacity-50">
                {pending ? "Saving…" : editing ? "Save" : `Create ${form.name || "agent"}`}
              </button>
            ) : (
              <button type="button" disabled={blockers.length > 0} onClick={() => setStep(step + 1)} className="cozy-button bg-leaf px-4 py-1.5 text-sm disabled:opacity-40">
                Next
              </button>
            )}
          </footer>
        )}
      </section>
    </div>
  );
}

const STEP_LABEL: Record<string, string> = {
  describe: "Describe",
  job: "Job",
  character: "Character",
  abilities: "Abilities",
  visits: "Visits",
  check: "Check",
};

/** A labelled input; `group` for sets of buttons/checkboxes (no nested <label>s). */
function Field({ label, children, group = false }: { label: string; children: React.ReactNode; group?: boolean }) {
  if (group) {
    return (
      <div role="group" aria-label={label}>
        <span className="mb-1 block text-xs font-black text-ink/70">{label}</span>
        {children}
      </div>
    );
  }
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-black text-ink/70">{label}</span>
      {children}
    </label>
  );
}

function Summary({ form, companyName }: { form: Form; companyName: string }) {
  const input = toInput(form);
  const schedule = input.triggers.filter((t) => t.type !== "on_call");
  const dayNames = Object.fromEntries(DAYS);
  const rows: Array<[string, string]> = [
    ["Who", `${input.name} — ${input.role}`],
    ["Where", `${companyName} · team ${"existing" in input.team ? input.team.existing : `${input.team.create.name} (new)`}`],
    ["Kind", `${input.kind === "lead" ? "Team lead" : input.kind === "simple" ? "Simple" : "Intelligent"} · ${input.language.map((l) => (l === "de" ? "German" : "English")).join(" + ")}`],
    ["Reads", READ.filter(([p]) => input.permissions.includes(p)).map(([, l]) => l).join(", ") || "nothing"],
    ["Does", ACT.filter(([p]) => input.permissions.includes(p)).map(([, k, l]) => `${l}${input.auto_approve.includes(k) ? " (without asking)" : " (asks first)"}`).join(", ") || "only talks and proposes rules"],
    [
      "Comes",
      schedule.length
        ? schedule
            .map((t) => (t.type === "schedule" ? `${t.days.map((d) => dayNames[d]).join(" ")} at ${[t.time].flat().join(", ")}` : t.type === "before_event" ? `${t.minutes} min before ${t.match}` : ""))
            .join(" · ") + " — and when you call"
        : "only when you call",
    ],
    ["Priority", input.priority],
  ];
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-2">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-xs font-black uppercase tracking-wide text-ink/50">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="rounded-xl bg-parchment/50 p-3">
        <p className="text-xs font-black uppercase tracking-wide text-ink/50">Mission</p>
        <p className="mt-1 whitespace-pre-wrap">{input.mission}</p>
      </div>
      {input.to_confirm.length > 0 && (
        <div className="rounded-xl bg-parchment/50 p-3">
          <p className="text-xs font-black uppercase tracking-wide text-ink/50">Asks you when introducing itself</p>
          <ul className="mt-1 list-disc pl-5">
            {input.to_confirm.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </div>
      )}
      {input.auto_approve.length > 0 && (
        <p className="rounded-xl bg-berry/10 px-3 py-2 text-xs font-bold text-berry">
          This agent will act without asking for: {input.auto_approve.join(", ")}. Every action is still checked (allowed spaces, discretion) and appears in the activity log.
        </p>
      )}
      <p className="text-xs text-ink/60">Saved as notes in your vault (Agent Village → {companyName} → Agents → {input.role}).</p>
    </div>
  );
}

/** A tiny front view of the voxel character (2D, matches the 3D colours). */
function VoxelPreview({ body, accent, hat, name }: { body: string; accent: string; hat: Hat; name: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-sky/40 px-6 py-4" aria-hidden>
      <svg width="96" height="140" viewBox="0 0 24 35" shapeRendering="crispEdges">
        {hat === "cap" && <><rect x="7" y="2" width="10" height="3" fill={accent} /><rect x="5" y="4" width="6" height="1" fill={accent} /></>}
        {hat === "beanie" && <><rect x="7" y="1" width="10" height="4" fill={accent} /><rect x="11" y="0" width="2" height="1" fill={body} /></>}
        {hat === "bow" && <><rect x="14" y="2" width="2" height="2" fill={accent} /><rect x="17" y="2" width="2" height="2" fill={accent} /><rect x="16" y="2.5" width="1" height="1" fill={body} /></>}
        {hat === "crown" && <><rect x="7" y="3" width="10" height="2" fill="#f2c94c" /><rect x="7" y="1" width="2" height="2" fill="#f2c94c" /><rect x="11" y="1" width="2" height="2" fill="#f2c94c" /><rect x="15" y="1" width="2" height="2" fill="#f2c94c" /></>}
        <rect x="7" y="5" width="10" height="9" fill="#f4c8a0" />
        <rect x="9" y="9" width="2" height="2" fill="#3b2a1e" />
        <rect x="13" y="9" width="2" height="2" fill="#3b2a1e" />
        <rect x="6" y="14" width="12" height="11" fill={body} />
        <rect x="3" y="15" width="3" height="8" fill={body} />
        <rect x="18" y="15" width="3" height="8" fill={body} />
        <rect x="6" y="21" width="12" height="2" fill={accent} />
        <rect x="7" y="25" width="4" height="8" fill={accent} />
        <rect x="13" y="25" width="4" height="8" fill={accent} />
      </svg>
      <span className="max-w-[8rem] truncate text-xs font-black text-wood-dark">{name || "…"}</span>
    </div>
  );
}
