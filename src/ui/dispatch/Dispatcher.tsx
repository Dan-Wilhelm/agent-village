"use client";

import { useState, useTransition } from "react";

import { dispatchRequest } from "@/app/actions/agents";
import { useConversations } from "@/ui/conversations/store";
import { useRoster } from "@/ui/roster/store";
import { useVoiceInput } from "@/ui/voice";
import { VoiceStatus } from "@/ui/VoiceStatus";

type Candidate = { agentId: string; confidence: number; reason: string };

/** "I want to …" — type or speak; the right agent comes with the task. */
export function Dispatcher() {
  const [text, setText] = useState("");
  const [choices, setChoices] = useState<Candidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const agents = useRoster((s) => s.agents);
  const open = useConversations((s) => s.open);
  const voice = useVoiceInput((t) => setText((d) => (d ? `${d} ${t}` : t)));

  const go = (agentId: string, request: string) => {
    const a = agents.find((x) => x.id === agentId);
    open(agentId, a?.name ?? "Agent", { opening: request, visitTitle: "Your request" });
    setText("");
    setChoices(null);
  };

  const submit = () => {
    const request = text.trim();
    if (!request || pending) return;
    setError(null);
    start(async () => {
      const r = await dispatchRequest(request);
      if (!r.ok) return setError(r.message ?? "Please try again.");
      const [first, second] = r.candidates;
      if (!first) return setError("No agent fits this yet — you could create one later in the agent wizard.");
      if (first.confidence >= 0.7 && (!second || first.confidence - second.confidence >= 0.2)) go(first.agentId, request);
      else setChoices(r.candidates.slice(0, 3));
    });
  };

  return (
    <div
      className="pointer-events-auto absolute bottom-14 left-1/2 z-10 w-[min(560px,calc(100vw-2rem))] -translate-x-1/2"
      onKeyDown={(e) => e.stopPropagation()}
      onKeyUp={(e) => e.stopPropagation()}
    >
      {choices && (
        <div className="cozy-card mb-2 p-3">
          <p className="text-xs font-black text-wood-dark">Who should take this?</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {choices.map((c) => {
              const a = agents.find((x) => x.id === c.agentId);
              return (
                <li key={c.agentId}>
                  <button
                    type="button"
                    onClick={() => go(c.agentId, text.trim())}
                    className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left hover:bg-parchment"
                  >
                    <span className="inline-block h-4 w-4 rounded-sm border border-wood-dark" style={{ background: a?.look.body }} aria-hidden />
                    <span className="text-sm font-bold">{a?.name}</span>
                    <span className="truncate text-xs text-ink/60">{a?.role} — {c.reason}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <button type="button" onClick={() => setChoices(null)} className="mt-1 text-xs font-bold text-ink/60 underline">
            Cancel
          </button>
        </div>
      )}
      <form
        className="cozy-card flex items-center gap-2 px-3 py-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <span aria-hidden>✨</span>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="I want to …"
          aria-label="What do you want to do?"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
        {voice.supported && (
          <button
            type="button"
            aria-pressed={voice.listening}
            aria-label={voice.listening ? "Stop listening" : "Speak"}
            onClick={() => (voice.listening ? voice.stop() : voice.start())}
            className={`cozy-button h-8 w-8 ${voice.listening ? "bg-berry text-cream" : "bg-parchment"}`}
          >
            🎙
          </button>
        )}
        <button type="submit" disabled={pending || !text.trim()} className="cozy-button bg-leaf px-3 py-1 text-xs disabled:opacity-50">
          {pending ? "Finding…" : "Go"}
        </button>
      </form>
      {error && <p className="mt-1 text-center text-xs font-bold text-berry">{error}</p>}
      <VoiceStatus listening={voice.listening} interim={voice.interim} error={voice.error} className="mt-1 rounded-lg bg-cream/90 px-2 py-1 text-center" />
    </div>
  );
}
