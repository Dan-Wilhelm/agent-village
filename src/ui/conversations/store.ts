"use client";

import type Anthropic from "@anthropic-ai/sdk";
import { create } from "zustand";

import { markAgentIntroduced } from "@/app/actions/agents";
import { useRoster } from "@/ui/roster/store";
import { releaseAgent, setAgentActivity, summonAgent } from "@/world/director";
import { sceneBridge } from "@/world/controls";

/**
 * Open conversations live ONLY in this browser tab (nothing is stored on the
 * server): the API history is sent with every turn.
 */

type ApiMessage = Anthropic.Beta.BetaMessageParam;

export interface ProposalView {
  id: string;
  kind: "comment" | "task_change" | "draft_task" | "mission_control_message" | "playbook_rule" | "meeting_notes" | "figma_comment" | "rule_change";
  agentId: string;
  args: Record<string, unknown>;
  summary: string;
  state: "pending" | "working" | "approved" | "rejected" | "failed";
  result?: string;
  /** Executed without asking (allowed for this agent). */
  auto?: { ok: boolean; message: string };
}

export type DisplayItem =
  | { kind: "user"; text: string }
  | { kind: "agent"; text: string }
  | { kind: "tool"; name: string; status: "running" | "done" | "error" }
  | { kind: "proposal"; id: string }
  | { kind: "note"; text: string }
  | { kind: "error"; text: string };

export interface Conversation {
  agentId: string;
  agentName: string;
  mode: "work" | "training";
  history: ApiMessage[];
  items: DisplayItem[];
  proposals: Record<string, ProposalView>;
  streaming: boolean;
  /** What the owner wrote — the only text "decide later" may store. */
  ownerNotes: string[];
  /** Prepared in the background for a trigger visit; not shown in the dock until Dan opens it. */
  hidden?: boolean;
  /** The trigger visit this conversation was prepared for. */
  preparedFor?: string;
  /** Answers Dan hasn't seen yet (the agent finished while another tab was open or the dock was hidden). */
  unread?: number;
  /** The agent understood Dan is done: open the finish dialog. */
  finishRequested?: boolean;
}

interface ConversationState {
  conversations: Record<string, Conversation>;
  order: string[];
  active: string | null;
  /** The dock is hidden ("Hide"); opening or focusing a conversation shows it again. */
  dockCollapsed: boolean;
  setDockCollapsed: (v: boolean) => void;
  open: (
    agentId: string,
    agentName: string,
    opts?: { opening?: string; mode?: "work" | "training"; visitTitle?: string; triggerLabel?: string },
  ) => void;
  focus: (agentId: string) => void;
  /**
   * A trigger visit arrived: start the agent's work right away, invisibly, while it walks over.
   * Lives only in this browser tab (nothing stored). Returns false if a conversation already exists.
   */
  prepare: (agentId: string, agentName: string, visit: { opening: string; triggerLabel: string; visitId: string }) => boolean;
  close: (agentId: string) => void;
  setMode: (agentId: string, mode: "work" | "training") => void;
  /** The finish dialog was opened for this conversation. */
  clearFinishRequest: (agentId: string) => void;
  /** `asNote`: text comes from a trigger, not from Dan (shown as a note, never stored as feedback). */
  send: (agentId: string, text: string, opts?: { asNote?: string }) => Promise<void>;
  decide: (agentId: string, proposalId: string, decision: "approve" | "reject") => Promise<void>;
}

const TOOL_LABEL: Record<string, string> = {
  search_tasks: "searching ClickUp",
  list_structure: "reading the list structure",
  get_task: "reading a task",
  get_calendar: "checking your calendar",
  read_mission_control_replies: "reading Mission Control",
  ask_colleague: "asking a colleague",
  ask_team_member: "asking the team",
  find_meeting_notes: "reading meeting notes",
  figma_read: "reading Figma",
  figma_view: "looking at the Figma frames",
  figma_comments: "reading Figma comments",
  find_docs: "looking for docs",
  read_doc: "reading a doc",
  list_task_templates: "looking at templates",
};
export const toolLabel = (name: string) => TOOL_LABEL[name] ?? "preparing a proposal";

export const useConversations = create<ConversationState>()((set, get) => {
  const patch = (agentId: string, fn: (c: Conversation) => Conversation) =>
    set((s) => (s.conversations[agentId] ? { conversations: { ...s.conversations, [agentId]: fn(s.conversations[agentId]) } } : s));

  return {
    conversations: {},
    order: [],
    active: null,
    dockCollapsed: false,
    setDockCollapsed: (v) =>
      set((s) => {
        // Showing the dock again = Dan now sees the active conversation.
        if (v || !s.active || !s.conversations[s.active]?.unread) return { dockCollapsed: v };
        return { dockCollapsed: v, conversations: { ...s.conversations, [s.active]: { ...s.conversations[s.active], unread: 0 } } };
      }),

    open: (agentId, agentName, opts) => {
      sceneBridge.unlock();
      const exists = get().conversations[agentId];
      if (!exists) {
        set((s) => ({
          conversations: {
            ...s.conversations,
            [agentId]: { agentId, agentName, mode: opts?.mode ?? "work", history: [], items: [], proposals: {}, streaming: false, ownerNotes: [] },
          },
          order: [...s.order, agentId],
        }));
        summonAgent(agentId, { title: opts?.visitTitle ?? "You called", body: opts?.opening ?? "", priority: undefined });
      } else if (opts?.mode) {
        patch(agentId, (c) => ({ ...c, mode: opts.mode! }));
      }
      patch(agentId, (c) => (c.hidden || c.unread ? { ...c, hidden: false, unread: 0 } : c));
      set({ active: agentId, dockCollapsed: false });
      if (!opts?.opening) return;
      const conv = get().conversations[agentId];
      if (conv?.streaming) {
        // Never drop or double-send: tell Dan the agent is still busy with the last message.
        patch(agentId, (c) => ({ ...c, items: [...c.items, { kind: "note", text: "Still answering your last message — send this again in a moment." }] }));
        return;
      }
      const lastUser = conv?.items.findLast((it) => it.kind === "user");
      if (lastUser && lastUser.kind === "user" && lastUser.text === opts.opening && conv?.items.at(-1)?.kind !== "error") return; // same request again
      void get().send(agentId, opts.opening, opts.triggerLabel ? { asNote: opts.triggerLabel } : undefined);
    },

    focus: (agentId) => {
      sceneBridge.unlock();
      patch(agentId, (c) => (c.hidden || c.unread ? { ...c, hidden: false, unread: 0 } : c));
      set({ active: agentId, dockCollapsed: false });
    },

    clearFinishRequest: (agentId) => patch(agentId, (c) => (c.finishRequested ? { ...c, finishRequested: false } : c)),

    prepare: (agentId, agentName, visit) => {
      if (get().conversations[agentId]) return false;
      set((s) => ({
        conversations: {
          ...s.conversations,
          [agentId]: {
            agentId,
            agentName,
            mode: "work",
            history: [],
            items: [],
            proposals: {},
            streaming: false,
            ownerNotes: [],
            hidden: true,
            preparedFor: visit.visitId,
          },
        },
        order: [...s.order, agentId],
      }));
      void get().send(agentId, visit.opening, { asNote: visit.triggerLabel });
      return true;
    },

    close: (agentId) => {
      const closing = get().conversations[agentId];
      const rosterEntry = useRoster.getState().agents.find((a) => a.id === agentId);
      if (closing && closing.ownerNotes.length > 0 && rosterEntry && !rosterEntry.introduced) {
        void markAgentIntroduced(agentId);
        useRoster.setState((r) => ({ agents: r.agents.map((a) => (a.id === agentId ? { ...a, introduced: true } : a)) }));
      }
      set((s) => {
        const { [agentId]: _gone, ...rest } = s.conversations;
        void _gone;
        const order = s.order.filter((id) => id !== agentId);
        const visible = order.filter((id) => !rest[id]?.hidden);
        return { conversations: rest, order, active: s.active === agentId ? (visible.at(-1) ?? null) : s.active };
      });
      releaseAgent(agentId);
    },

    setMode: (agentId, mode) => {
      patch(agentId, (c) => ({ ...c, mode, items: [...c.items, { kind: "note", text: mode === "training" ? "Training mode on — teach me." : "Back to work mode." }] }));
      setAgentActivity(agentId, mode === "training" ? "training" : "waiting");
    },

    send: async (agentId, text, opts) => {
      const c = get().conversations[agentId];
      if (!c || c.streaming || !text.trim()) return;
      const userMessage: ApiMessage = { role: "user", content: text };
      patch(agentId, (x) => ({
        ...x,
        streaming: true,
        history: [...x.history, userMessage],
        items: [...x.items, opts?.asNote ? { kind: "note", text: opts.asNote } : { kind: "user", text }],
        ownerNotes: opts?.asNote ? x.ownerNotes : [...x.ownerNotes, text],
      }));
      setAgentActivity(agentId, "working");

      let agentText = "";
      const appendText = (delta: string) => {
        agentText += delta;
        patch(agentId, (x) => {
          const items = [...x.items];
          const last = items.at(-1);
          if (last?.kind === "agent") items[items.length - 1] = { kind: "agent", text: last.text + delta };
          else items.push({ kind: "agent", text: delta });
          return { ...x, items };
        });
      };

      try {
        const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/turn`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: get().conversations[agentId]?.mode ?? "work", messages: get().conversations[agentId]?.history ?? [] }),
        });
        if (!res.ok || !res.body) {
          throw new Error(
            res.status === 401 ? "Please sign in again." : res.status === 429 ? "Too many requests — please wait a moment." : "The agent is not reachable.",
          );
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buffer.indexOf("\n\n")) >= 0) {
            const chunk = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            if (!chunk.startsWith("data: ")) continue;
            const event = JSON.parse(chunk.slice(6));
            if (event.type === "text") appendText(event.text);
            else if (event.type === "tool") {
              patch(agentId, (x) => {
                // A finished tool replaces its own "running" line instead of adding a new one.
                if (event.status !== "running") {
                  const idx = x.items.findLastIndex((it) => it.kind === "tool" && it.name === event.name && it.status === "running");
                  if (idx >= 0) {
                    const items = [...x.items];
                    items[idx] = { kind: "tool", name: event.name, status: event.status };
                    return { ...x, items };
                  }
                }
                return { ...x, items: [...x.items, { kind: "tool", name: event.name, status: event.status }] };
              });
              if (event.status === "running") setAgentActivity(agentId, "working", toolLabel(event.name));
            } else if (event.type === "proposal") {
              const p = event.proposal as Omit<ProposalView, "state">;
              const state: ProposalView["state"] = p.auto ? (p.auto.ok ? "approved" : "failed") : "pending";
              // A revised draft keeps its id: update the card in place instead of adding a second one.
              patch(agentId, (x) => ({
                ...x,
                proposals: { ...x.proposals, [p.id]: { ...p, state, ...(p.auto ? { result: p.auto.message } : {}) } },
                items: x.proposals[p.id] ? x.items : [...x.items, { kind: "proposal", id: p.id }],
              }));
            } else if (event.type === "done") {
              patch(agentId, (x) => ({ ...x, history: [...x.history, ...(event.messages as ApiMessage[])] }));
            } else if (event.type === "finish") {
              patch(agentId, (x) => ({ ...x, finishRequested: true }));
            } else if (event.type === "error") {
              patch(agentId, (x) => ({ ...x, items: [...x.items, { kind: "error", text: event.message }] }));
            }
          }
        }
      } catch (err) {
        patch(agentId, (x) => ({ ...x, items: [...x.items, { kind: "error", text: err instanceof Error ? err.message : "Something went wrong." }] }));
      } finally {
        // Not looking at this conversation right now? Mark the new answer as unread.
        const s = get();
        const unseen = s.active !== agentId || s.dockCollapsed || s.conversations[agentId]?.hidden;
        patch(agentId, (x) => ({ ...x, streaming: false, ...(unseen && agentText ? { unread: (x.unread ?? 0) + 1 } : {}) }));
        const after = get().conversations[agentId];
        const mode = after?.mode;
        // A prepared visit is ready before Dan opened it: say so in the speech bubble.
        setAgentActivity(agentId, mode === "training" ? "training" : "waiting", after?.hidden ? "✓ ready" : agentText ? "💬" : undefined);
      }
    },

    decide: async (agentId, proposalId, decision) => {
      const c = get().conversations[agentId];
      const p = c?.proposals[proposalId];
      if (!c || !p || p.state !== "pending") return;
      const setP = (patchP: Partial<ProposalView>) =>
        patch(agentId, (x) => ({ ...x, proposals: { ...x.proposals, [proposalId]: { ...x.proposals[proposalId], ...patchP } } }));
      setP({ state: "working" });
      try {
        const res = await fetch("/api/agents/proposals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // The proposal's own agent (a lead's conversation can hold proposals of its team members).
          body: JSON.stringify({ agentId: p.agentId, kind: p.kind, args: p.args, decision }),
        });
        const json = (await res.json()) as { ok: boolean; message: string };
        if (!res.ok || !json.ok) throw new Error(json.message || "Failed.");
        setP({ state: decision === "approve" ? "approved" : "rejected", result: json.message });
        // Tell the agent what happened (appended to the conversation, not stored anywhere).
        const note = `[Dan ${decision === "approve" ? "approved" : "rejected"} proposal ${proposalId} (${p.summary}). Result: ${json.message}]`;
        patch(agentId, (x) => ({ ...x, history: appendUserNote(x.history, note) }));
      } catch (err) {
        setP({ state: "failed", result: err instanceof Error ? err.message : "Failed." });
      }
    },
  };
});

/**
 * Appends the decision as a NEW user message (append-only: already-sent turns are
 * never edited, which keeps the model's earlier reasoning valid).
 */
function appendUserNote(history: ApiMessage[], note: string): ApiMessage[] {
  return [...history, { role: "user", content: note }];
}
