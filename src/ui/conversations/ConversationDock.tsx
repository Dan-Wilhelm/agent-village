"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { saveFeedbackForLater } from "@/app/actions/agents";
import { getHqTaskDetail, type HqTaskDetail } from "@/app/actions/hq";
import { useVoiceInput } from "@/ui/voice";
import { useVillage } from "@/world/store";

import { tokenize } from "./rich-text";
import { toolLabel, useConversations, type Conversation, type ProposalView } from "./store";
import { safeColor } from "@/ui/safe-color";
import { VoiceStatus } from "@/ui/VoiceStatus";

/** Right-hand dock with all open conversations (several can stay open in parallel). */
export function ConversationDock() {
  const order = useConversations((s) => s.order);
  const active = useConversations((s) => s.active);
  const conversations = useConversations((s) => s.conversations);
  const focus = useConversations((s) => s.focus);
  const open = useConversations((s) => s.open);
  const agents = useVillage((s) => s.agents);
  const collapsed = useConversations((s) => s.dockCollapsed);
  const setCollapsed = useConversations((s) => s.setDockCollapsed);

  // Clicking an agent in the world / pressing E opens its conversation.
  useEffect(
    () =>
      useVillage.subscribe((state, prev) => {
        const id = state.openInteractionId;
        if (!id || id === prev.openInteractionId) return;
        const visit = state.queue.find((q) => q.id === id);
        state.closePanel();
        if (!visit) return;
        const agent = state.agents[visit.agentId];
        if (visit.visitId) {
          // A trigger visit: the agent starts on its own; the visit is marked as seen.
          void fetch("/api/visits", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: visit.visitId }) });
          const prepared = useConversations.getState().conversations[visit.agentId];
          if (prepared?.preparedFor === visit.visitId) useConversations.getState().focus(visit.agentId); // already (being) prepared
          else open(visit.agentId, agent?.name ?? "Agent", { opening: visit.body, triggerLabel: `⏰ ${visit.title}` });
        } else {
          open(visit.agentId, agent?.name ?? "Agent", visit.body ? { opening: visit.body } : undefined);
        }
        setCollapsed(false);
      }),
    [open, setCollapsed],
  );

  // Conversations prepared in the background stay out of sight until Dan opens them.
  const visibleOrder = order.filter((id) => !conversations[id]?.hidden);
  if (visibleOrder.length === 0) return null;
  const current = active ? conversations[active] : null;

  return (
    <aside
      aria-label="Conversations"
      className="pointer-events-auto absolute bottom-4 right-4 top-[15.5rem] z-20 flex w-[min(440px,calc(100vw-2rem))] flex-col"
      onKeyDown={(e) => e.stopPropagation()}
      onKeyUp={(e) => e.stopPropagation()}
    >
      <div className="flex items-end gap-1 overflow-x-auto px-1">
        {visibleOrder.map((id) => {
          const c = conversations[id];
          const a = agents[id];
          return (
            <button
              key={id}
              type="button"
              onClick={() => {
                focus(id);
                setCollapsed(false);
              }}
              className={`flex shrink-0 items-center gap-1.5 rounded-t-xl border-2 border-b-0 border-wood px-3 py-1 text-xs font-black ${
                id === active ? "bg-cream text-ink" : "bg-parchment/90 text-ink/70"
              }`}
            >
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: a?.look.body ?? "#ccc" }} aria-hidden />
              {c.agentName}
              {c.streaming && <span className="animate-pulse motion-reduce:animate-none">…</span>}
              {c.unread ? (
                <span
                  className="min-w-[1.1rem] rounded-full bg-berry px-1 text-center text-[10px] font-black leading-[1.1rem] text-cream"
                  aria-label={`${c.unread} new ${c.unread === 1 ? "answer" : "answers"}`}
                >
                  {c.unread}
                </span>
              ) : (
                Object.values(c.proposals).some((p) => p.state === "pending") && (
                  <span className="text-berry" aria-label="waiting for your decision">●</span>
                )
              )}
            </button>
          );
        })}
        <span className="flex-1" />
        <button type="button" onClick={() => setCollapsed(!collapsed)} className="rounded-t-xl bg-ink/70 px-2 py-1 text-xs font-bold text-cream">
          {collapsed ? "Show" : "Hide"}
          {collapsed && visibleOrder.some((id) => conversations[id]?.unread) && <span className="ml-1 text-berry">●</span>}
        </button>
      </div>
      {!collapsed && current && <ConversationView key={current.agentId} conversation={current} />}
    </aside>
  );
}

function ConversationView({ conversation: c }: { conversation: Conversation }) {
  const send = useConversations((s) => s.send);
  const setMode = useConversations((s) => s.setMode);
  const clearFinishRequest = useConversations((s) => s.clearFinishRequest);
  const agent = useVillage((s) => s.agents[c.agentId]);
  const [draft, setDraft] = useState("");
  const [finishing, setFinishing] = useState(false);
  const [peek, setPeek] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const atBottom = useRef(true);
  const [hasNew, setHasNew] = useState(false);
  const voice = useVoiceInput((text) => setDraft((d) => (d ? `${d} ${text}` : text)));

  const lastItem = c.items.at(-1);
  const scrollToEnd = () => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
    atBottom.current = true;
    setHasNew(false);
  };
  // Only follow new text while Dan is already at the bottom; otherwise leave the view where he reads.
  useEffect(() => {
    if (atBottom.current || lastItem?.kind === "user") {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
      atBottom.current = true;
    } else {
      setHasNew(true);
    }
  }, [c.items.length, lastItem]);

  // The agent understood Dan is done → the finish dialog opens once the answer is complete.
  const showFinish = finishing || Boolean(c.finishRequested && !c.streaming);

  // The input grows with the text (up to half the screen); it can also be dragged bigger.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    if (!draft) {
      el.style.height = "";
      return;
    }
    const max = window.innerHeight * 0.5;
    if (el.scrollHeight > el.clientHeight) el.style.height = `${Math.min(el.scrollHeight + 4, max)}px`;
  }, [draft]);

  const submit = () => {
    if (!draft.trim() || c.streaming) return;
    void send(c.agentId, draft.trim());
    setDraft("");
  };

  return (
    <section className="cozy-card flex min-h-0 flex-1 flex-col rounded-tl-none">
      <header className="flex items-center gap-2 border-b-2 border-parchment px-4 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-black text-wood-dark">{c.agentName}</p>
          <p className="truncate text-xs text-ink/60">{agent?.role}</p>
        </div>
        <div role="radiogroup" aria-label="Mode" className="flex overflow-hidden rounded-full border-2 border-parchment text-xs font-bold">
          {(["work", "training"] as const).map((m) => (
            <button
              key={m}
              role="radio"
              aria-checked={c.mode === m}
              type="button"
              onClick={() => c.mode !== m && setMode(c.agentId, m)}
              className={`px-2.5 py-0.5 ${c.mode === m ? "bg-wood text-cream" : "bg-white text-ink/70"}`}
            >
              {m === "work" ? "Work" : "Training"}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setFinishing(true)} className="cozy-button bg-parchment px-2.5 py-1 text-xs">
          Finish
        </button>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
          if (atBottom.current && hasNew) setHasNew(false);
        }}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3 text-sm"
      >
        {c.items.length === 0 && (
          <p className="text-ink/60">
            {c.agentName} is on the way. Say or type what you need{c.mode === "training" ? " — you're in training mode" : ""}.
          </p>
        )}
        {c.items.map((item, i) => {
          switch (item.kind) {
            case "user":
              return (
                <p key={i} className="ml-8 whitespace-pre-wrap rounded-2xl rounded-br-sm bg-sky/50 px-3 py-2 [overflow-wrap:anywhere]">
                  {item.text}
                </p>
              );
            case "agent":
              return (
                <div key={i} className="mr-6 whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-parchment/70 px-3 py-2 leading-relaxed [overflow-wrap:anywhere]">
                  <RichText text={item.text} onTask={setPeek} />
                </div>
              );
            case "tool":
              return item.status === "running" ? (
                <p key={i} className="text-xs italic text-ink/50">
                  {c.agentName} is {toolLabel(item.name)}…
                </p>
              ) : null;
            case "proposal":
              return <ProposalCard key={i} conversationId={c.agentId} proposal={c.proposals[item.id]} />;
            case "note":
              return (
                <p key={i} className="text-center text-xs font-bold text-ink/50">
                  {item.text}
                </p>
              );
            case "error":
              return (
                <p key={i} role="alert" className="text-xs font-bold text-berry">
                  {item.text}
                </p>
              );
          }
        })}
        {c.streaming && c.items.at(-1)?.kind !== "agent" && (
          <p className="text-xs text-ink/50">
            <span className="animate-pulse motion-reduce:animate-none">{c.agentName} is thinking…</span>
          </p>
        )}
      </div>
      {hasNew && (
        <button
          type="button"
          onClick={scrollToEnd}
          className="cozy-button absolute bottom-2 left-1/2 -translate-x-1/2 bg-wood px-3 py-1 text-xs text-cream shadow-md"
        >
          ↓ New message
        </button>
      )}
      </div>

      <form
        className="flex items-end gap-2 border-t-2 border-parchment px-3 py-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={2}
          placeholder={c.mode === "training" ? "Teach me something…" : `Message ${c.agentName}…`}
          aria-label={`Message ${c.agentName}`}
          title="Drag the corner to make the field bigger"
          className="max-h-[50vh] min-h-[2.75rem] flex-1 resize-y rounded-xl border-2 border-parchment bg-white px-3 py-1.5 text-sm"
        />
        {voice.supported && (
          <div className="flex flex-col items-center gap-1">
            <button
              type="button"
              aria-pressed={voice.listening}
              aria-label={voice.listening ? "Stop listening" : "Speak"}
              onClick={() => (voice.listening ? voice.stop() : voice.start())}
              className={`cozy-button h-9 w-9 text-base ${voice.listening ? "bg-berry text-cream" : "bg-parchment"}`}
            >
              🎙
            </button>
            <button
              type="button"
              onClick={() => voice.setLang(voice.lang === "de-DE" ? "en-US" : "de-DE")}
              className="text-[10px] font-black text-ink/60"
              aria-label="Speech language"
            >
              {voice.lang === "de-DE" ? "DE" : "EN"}
            </button>
          </div>
        )}
        <button type="submit" disabled={c.streaming || !draft.trim()} className="cozy-button h-9 bg-leaf px-3 text-sm disabled:opacity-50">
          Send
        </button>
      </form>
      <VoiceStatus listening={voice.listening} interim={voice.interim} error={voice.error} className="px-3 pb-2" />

      {showFinish && (
        <FinishDialog
          conversation={c}
          onCancel={() => {
            setFinishing(false);
            clearFinishRequest(c.agentId);
          }}
        />
      )}
      {peek && <TaskPeek taskId={peek} onClose={() => setPeek(null)} />}
    </section>
  );
}

/** Plain text with **bold** and clickable [task:ID] chips (content loaded live on click). */
function RichText({ text, onTask }: { text: string; onTask: (id: string) => void }) {
  return (
    <>
      {tokenize(text).map((t, i) => {
        if (t.kind === "task")
          return (
            <button
              key={i}
              type="button"
              onClick={() => onTask(t.id)}
              title={`Open task ${t.id} (loaded live from ClickUp)`}
              aria-label={`Open task ${t.id}`}
              className="mx-0.5 inline-flex rounded-md bg-wood/15 px-1.5 text-xs font-black text-wood-dark hover:bg-wood/25"
            >
              open ↗
            </button>
          );
        if (t.kind === "bold") return <strong key={i}>{t.text}</strong>;
        if (t.kind === "link")
          return (
            <a
              key={i}
              href={t.href}
              target="_blank"
              rel="noopener noreferrer"
              title={t.href}
              className="mx-0.5 inline-flex rounded-md bg-sky/40 px-1.5 text-xs font-black text-ink underline decoration-dotted hover:bg-sky/60"
            >
              {t.label} ↗
            </a>
          );
        return <span key={i}>{t.text}</span>;
      })}
    </>
  );
}

function ProposalCard({ conversationId, proposal: p }: { conversationId: string; proposal: ProposalView | undefined }) {
  const decide = useConversations((s) => s.decide);
  const from = useVillage((s) => (p && p.agentId !== conversationId ? s.agents[p.agentId]?.name : undefined));
  if (!p) return null;
  const preview =
    p.kind === "comment" || p.kind === "mission_control_message"
      ? String(p.args.text ?? "")
      : p.kind === "playbook_rule"
        ? `${String(p.args.rule ?? "")}\nTest: ${String(p.args.test_case ?? "")}${p.args.replaces ? `\nReplaces the open question: ${String(p.args.replaces)}` : ""}`
        : p.kind === "meeting_notes"
          ? String(p.args.summary ?? String(p.args.notes ?? "").slice(0, 400))
          : p.kind === "draft_task" && (p.args.fields || p.args.status)
            ? [
                ...Object.entries((p.args.fields ?? {}) as Record<string, string>).map(([k, v]) => `${k}: ${v}`),
                ...(p.args.status ? [`Status: ${String(p.args.status)}`] : []),
              ].join("\n")
            : "";
  const label = {
    comment: "Comment (posted as you)",
    task_change: "Task change",
    draft_task: "New task (draft in your drafts list)",
    mission_control_message: "DM to Mission Control (as you)",
    playbook_rule: "Learn a rule",
    meeting_notes: "Save meeting notes (your vault)",
  }[p.kind];
  return (
    <div className="rounded-2xl border-2 border-wood bg-white px-3 py-2">
      <p className="text-xs font-black uppercase tracking-wide text-wood">
        {p.auto ? (p.auto.ok ? "Done without asking · " : "Tried without asking · ") : ""}
        {label}
        {from && <span className="ml-1 normal-case text-ink/60">· from {from}</span>}
      </p>
      <p className="mt-0.5 font-bold">{p.summary}</p>
      {preview && <p className="mt-1 whitespace-pre-wrap rounded-lg bg-parchment/50 px-2 py-1 text-xs">{preview}</p>}
      {p.state === "pending" && (
        <div className="mt-2 flex gap-2">
          <button type="button" onClick={() => void decide(conversationId, p.id, "approve")} className="cozy-button bg-leaf px-3 py-1 text-xs">
            Approve
          </button>
          <button type="button" onClick={() => void decide(conversationId, p.id, "reject")} className="cozy-button bg-parchment px-3 py-1 text-xs">
            Reject
          </button>
        </div>
      )}
      {p.state === "working" && <p className="mt-1 text-xs text-ink/60">Working…</p>}
      {(p.state === "approved" || p.state === "rejected") && (
        <p className="mt-1 text-xs font-bold text-leaf">{p.state === "approved" ? "✓ " : "✕ "}{p.result}</p>
      )}
      {p.state === "failed" && <p className="mt-1 text-xs font-bold text-berry">{p.result}</p>}
    </div>
  );
}

function FinishDialog({ conversation: c, onCancel }: { conversation: Conversation; onCancel: () => void }) {
  const send = useConversations((s) => s.send);
  const close = useConversations((s) => s.close);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const hasFeedback = c.ownerNotes.length > 0;
  const pendingProposals = Object.values(c.proposals).some((p) => p.state === "pending");

  return (
    <div className="absolute inset-0 z-10 flex items-end bg-ink/30 p-3" role="dialog" aria-modal="true" aria-label="Finish conversation">
      <div className="cozy-card w-full p-4">
        <p className="font-black text-wood-dark">Finish the conversation with {c.agentName}</p>
        <p className="mt-1 text-xs text-ink/70">Should {c.agentName} learn from what you said?</p>
        {pendingProposals && <p className="mt-2 text-xs font-bold text-berry">There are still proposals waiting for your decision.</p>}
        <div className="mt-3 flex flex-col gap-2">
          <button
            type="button"
            disabled={!hasFeedback || pending || c.streaming}
            onClick={() => {
              onCancel();
              void send(
                c.agentId,
                "Please turn the feedback and corrections I gave in this conversation into playbook rules with test cases (propose_playbook_rule). Only propose rules I actually gave; general form, no ClickUp content.",
              );
            }}
            className="cozy-button bg-leaf px-3 py-2 text-left text-sm disabled:opacity-50"
          >
            🎓 Learn from this <span className="block text-xs font-semibold">{c.agentName} proposes rules — you approve each one</span>
          </button>
          <button
            type="button"
            disabled={!hasFeedback || pending}
            onClick={() =>
              start(async () => {
                const r = await saveFeedbackForLater(c.agentId, c.ownerNotes);
                setMessage(r.message);
                if (r.ok) setTimeout(() => close(c.agentId), 900);
              })
            }
            className="cozy-button bg-parchment px-3 py-2 text-left text-sm disabled:opacity-50"
          >
            🗂 Decide later <span className="block text-xs font-semibold">Your words go to the inbox in your vault</span>
          </button>
          <button type="button" disabled={pending} onClick={() => close(c.agentId)} className="cozy-button bg-white px-3 py-2 text-left text-sm">
            👋 Not feedback <span className="block text-xs font-semibold">Close without learning</span>
          </button>
          <button type="button" onClick={onCancel} className="text-xs font-bold text-ink/60 underline">
            Back to the conversation
          </button>
        </div>
        {message && <p role="status" className="mt-2 text-xs font-bold text-leaf">{message}</p>}
      </div>
    </div>
  );
}

/** Live task details for a [task:ID] chip — read from ClickUp on click, never stored. */
function TaskPeek({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<HqTaskDetail | null | "missing">(null);
  useEffect(() => {
    let cancelled = false;
    getHqTaskDetail(taskId).then((d) => !cancelled && setDetail(d ?? "missing"));
    return () => {
      cancelled = true;
    };
  }, [taskId]);
  return (
    <div className="absolute inset-0 z-10 flex items-center bg-ink/30 p-3" role="dialog" aria-modal="true" aria-label="Task" onClick={onClose}>
      <div className="cozy-card max-h-full w-full overflow-y-auto p-4" onClick={(e) => e.stopPropagation()}>
        {detail === null && <p className="text-sm text-ink/60">Loading live from ClickUp…</p>}
        {detail === "missing" && <p className="text-sm text-berry">This task is not available (outside your allowed spaces?).</p>}
        {detail && detail !== "missing" && (
          <>
            <div className="flex items-start gap-2">
              <p className="flex-1 font-black leading-snug">{detail.name}</p>
              <button type="button" onClick={onClose} aria-label="Close" className="text-sm font-bold text-ink/60">
                ✕
              </button>
            </div>
            <p className="mt-1 text-xs">
              <span className="rounded px-1.5 py-0.5 font-black uppercase text-white" style={{ background: safeColor(detail.statusColor, "#999") }}>
                {detail.status}
              </span>
              {detail.dueAt && <span className="ml-2 font-bold">due {new Date(detail.dueAt).toLocaleDateString()}</span>}
            </p>
            {detail.url && (
              <a href={detail.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs font-bold text-wood underline">
                Open in ClickUp ↗
              </a>
            )}
            <p className="mt-3 whitespace-pre-wrap break-words text-sm">{detail.description?.trim() || "No description."}</p>
            {detail.comments.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {detail.comments.slice(0, 4).map((cm) => (
                  <li key={cm.id} className="rounded-lg bg-parchment/60 p-2 text-xs">
                    <span className="font-bold">{cm.author}</span>: <span className="whitespace-pre-wrap">{cm.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
