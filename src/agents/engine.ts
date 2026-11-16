import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { loadAgentContext } from "./context";
import { runTool, toolsFor, type Proposal, type ToolContext } from "./tools";

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
  | { type: "error"; message: string };

const MAX_ITERATIONS = 12;
const EFFORT = { simple: "low", intelligent: "medium", lead: "high" } as const;

export async function runAgentTurn(opts: {
  agentId: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  mode?: "work" | "training";
  emit: (event: EngineEvent) => void;
}) {
  const ctx = await loadAgentContext(opts.agentId, opts.mode);
  const client = new Anthropic();
  const tools = toolsFor(ctx.agent);
  const toolCtx: ToolContext = {
    agent: ctx.agent,
    account: ctx.account,
    missionControlUserId: ctx.missionControlUserId,
    draftsListName: ctx.draftsListName,
    keyFields: ctx.keyFields,
    companyDir: ctx.companyDir,
    proposals: [],
  };
  const isOpus = ctx.agent.model === "claude-opus-5-5";
  const history = [...opts.messages];
  const added: Anthropic.Beta.BetaMessageParam[] = [];
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
      // Opus: a declined request is retried server-side on a fallback model instead of failing.
      ...(isOpus ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
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

  opts.emit({ type: "done", messages: added });
}
