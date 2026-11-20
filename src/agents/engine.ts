import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { loadAgentContext } from "./context";
import { signTurnNote } from "@/lib/turn-note-sig";

import { executeProposal } from "./execute";
import { runTool, toolsFor, UNTRUSTED_TOOL_NAMES, type Proposal, type ToolContext } from "./tools";

/**
 * One conversation turn with an agent. STATELESS: the browser holds the
 * conversation and sends it with every turn; the server streams the answer,
 * runs read tools live and collects proposals. Nothing is persisted here.
 */

export type EngineEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string; status: "running" | "done" | "error" }
  | { type: "proposal"; proposal: Proposal }
  | { type: "done"; messages: Anthropic.Beta.BetaMessageParam[] }
  | { type: "finish" }
  | { type: "error"; message: string };

const MAX_ITERATIONS = 12;
const EFFORT = { simple: "low", intelligent: "medium", lead: "high" } as const;

export async function runAgentTurn(opts: {
  agentId: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  mode?: "work" | "training";
  emit: (event: EngineEvent) => void;
  /** Set when a team lead hands this request to a member (depth 1 only). */
  delegatedBy?: { name: string; role: string };
  /** Set when a colleague asks a question: read-only turn (depth 1 only). */
  askedBy?: { name: string; role: string };
}) {
  const firstTurn = !opts.messages.some((m) => m.role === "assistant");
  const ctx = await loadAgentContext(opts.agentId, opts.mode, { delegatedBy: opts.delegatedBy, askedBy: opts.askedBy, firstTurn });
  const readOnly = Boolean(opts.askedBy);
  const client = new Anthropic();
  const tools = toolsFor(ctx.agent, { readOnly });
  const toolCtx: ToolContext = {
    agent: ctx.agent,
    account: ctx.account,
    missionControlUserId: ctx.missionControlUserId,
    draftsListName: ctx.draftsListName,
    keyFields: ctx.keyFields,
    companyDir: ctx.companyDir,
    figma: ctx.figma,
    proposals: [],
    // Only proposal kinds Dan allowed for THIS agent run without asking; executeProposal re-validates everything.
    // Never in delegated turns (the request came from another agent, not from Dan).
    readOnly,
    autoExecute: opts.delegatedBy || readOnly
      ? undefined
      : async (p) => {
          const r = await executeProposal({ agentId: p.agentId, kind: p.kind, args: p.args, decision: "approve" });
          return { ok: r.ok, message: r.message };
        },
    // Earlier turns already read content written by others → nothing runs without asking.
    tainted: opts.messages.some(
      (m) => m.role === "assistant" && Array.isArray(m.content) && m.content.some((b) => b.type === "tool_use" && UNTRUSTED_TOOL_NAMES.has(b.name)),
    ),
  };
  // Colleague questions: only from Dan's own conversation (no chains), answered read-only.
  if (!opts.delegatedBy && !opts.askedBy) {
    toolCtx.colleagues = ctx.colleagues;
    toolCtx.askColleague = async (colleagueId, question) => {
      const colleague = ctx.colleagues.find((c) => c.id === colleagueId);
      let answer = "";
      await runAgentTurn({
        agentId: colleagueId,
        messages: [{ role: "user", content: question }],
        mode: "work",
        askedBy: { name: ctx.agent.name, role: ctx.agent.role },
        emit: (e) => {
          if (e.type === "text") answer += e.text;
          else if (e.type === "error") answer += `\n[${e.message}]`;
        },
      });
      return `${colleague?.name ?? colleagueId} (${colleague?.role ?? "colleague"}) answers:\n${answer.trim() || "(no answer)"}`;
    };
  }
  if (ctx.agent.kind === "lead" && !opts.delegatedBy && !opts.askedBy) {
    toolCtx.teamMembers = ctx.teamMembers;
    toolCtx.delegate = async (memberId, request) => {
      let answer = "";
      await runAgentTurn({
        agentId: memberId,
        messages: [{ role: "user", content: request }],
        mode: "work",
        delegatedBy: { name: ctx.agent.name, role: ctx.agent.role },
        emit: (e) => {
          if (e.type === "text") answer += e.text;
          else if (e.type === "proposal") opts.emit(e); // the member's cards show up in the lead's conversation
          else if (e.type === "error") answer += `\n[${e.message}]`;
        },
      });
      return answer.trim() || "(no answer)";
    };
  }
  const isOpus = ctx.agent.model === "claude-opus-5-5";
  const history = [...opts.messages];
  const added: Anthropic.Beta.BetaMessageParam[] = [];
  // Append-only: per-turn facts go in as a role:"system" message right after Dan's message.
  // The browser keeps it (it is part of `added`), so later turns replay it unchanged.
  if (history.at(-1)?.role === "user") {
    const note: Anthropic.Beta.BetaMessageParam = { role: "system", content: ctx.turnNote };
    history.push(note);
    // The browser's copy carries a signature; only signed notes are accepted back (see the turn route).
    added.push({ ...note, _sig: signTurnNote(ctx.turnNote) } as Anthropic.Beta.BetaMessageParam);
  }
  // Emit new proposals and changed ones (a revised draft keeps its id and replaces its card).
  const emitted = new Map<string, string>();

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const stream = client.beta.messages.stream({
      model: ctx.agent.model,
      max_tokens: 32_000,
      system: ctx.system,
      tools,
      messages: history,
      cache_control: { type: "ephemeral" },
      output_config: { effort: EFFORT[ctx.agent.kind] },
      // Safety net: if the frozen prompt still changed (e.g. a rule was learned mid-conversation),
      // drop the outdated reasoning instead of failing the turn. Drops are logged below.
      thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } },
      // Opus: a declined request is retried server-side on a fallback model instead of failing.
      betas: isOpus ? ["thinking-binding-controls-2026-08-01", "server-side-fallback-2026-07-01"] : ["thinking-binding-controls-2026-08-01"],
      ...(isOpus ? { fallbacks: "default" as const } : {}),
    });
    stream.on("text", (delta) => opts.emit({ type: "text", text: delta }));

    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await stream.finalMessage();
    } catch (err) {
      if (err instanceof Anthropic.APIError) throw err;
      // A tool input could not be parsed at all (eager streaming) — re-issue this turn once more.
      if (i < MAX_ITERATIONS - 1) continue;
      throw err;
    }

    if (message.input_transformations?.length) {
      // Monitoring only (no content): which earlier reasoning blocks were dropped and why.
      console.warn("thinking blocks dropped", {
        agentId: ctx.agent.id,
        entries: message.input_transformations.map((t) => ({ type: t.type, reason: "reason" in t ? t.reason : undefined, path: "path" in t ? t.path : undefined })),
      });
    }
    const assistant: Anthropic.Beta.BetaMessageParam = { role: "assistant", content: message.content };
    history.push(assistant);
    added.push(assistant);

    if (message.stop_reason === "refusal") {
      opts.emit({ type: "error", message: "The agent could not answer this request." });
      break;
    }
    const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (message.stop_reason === "max_tokens" && toolUses.length) {
      opts.emit({ type: "error", message: "The answer got too long. Please ask for something smaller." });
      break;
    }
    if (message.stop_reason === "pause_turn") continue;
    if (toolUses.length === 0) break;

    const results = await Promise.all(
      toolUses.map(async (use) => {
        opts.emit({ type: "tool", name: use.name, status: "running" });
        const r = await runTool(use.name, use.input, toolCtx);
        opts.emit({ type: "tool", name: use.name, status: r.isError ? "error" : "done" });
        return { type: "tool_result" as const, tool_use_id: use.id, content: r.content, ...(r.isError ? { is_error: true } : {}) };
      }),
    );
    for (const p of toolCtx.proposals) {
      const json = JSON.stringify(p);
      if (emitted.get(p.id) === json) continue;
      emitted.set(p.id, json);
      opts.emit({ type: "proposal", proposal: p });
    }

    const toolMessage: Anthropic.Beta.BetaMessageParam = { role: "user", content: results };
    history.push(toolMessage);
    added.push(toolMessage);
  }

  if (toolCtx.finishRequested && !opts.delegatedBy && !opts.askedBy) opts.emit({ type: "finish" });
  opts.emit({ type: "done", messages: added });
}
