import { z } from "zod";

import { runAgentTurn, type EngineEvent } from "@/agents/engine";
import { requireOwnerForRoute } from "@/lib/auth/owner";

export const maxDuration = 300;

const bodySchema = z.object({
  mode: z.enum(["work", "training"]).default("work"),
  // The conversation lives in the browser; validated loosely here, strictly by the API.
  messages: z
    .array(
      z
        .object({
          role: z.enum(["user", "assistant", "system"]),
          content: z.union([z.string(), z.array(z.record(z.string(), z.unknown()))]),
        })
        // System messages in the history are only the server's own per-turn notes.
        .refine((m) => m.role !== "system" || (typeof m.content === "string" && m.content.startsWith("Current date and time (Europe/Berlin):")), "unexpected system message"),
    )
    .min(1)
    .max(400),
});

/**
 * POST /api/agents/:agentId/turn — streams one agent turn as Server-Sent Events.
 * Owner only. Nothing is stored: the browser sends the conversation each time.
 */
export async function POST(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  const owner = await requireOwnerForRoute();
  if (!owner.ok) return owner.response;
  const { agentId } = await params;
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(agentId)) return Response.json({ error: "bad agent" }, { status: 400 });

  const raw = await request.text();
  if (raw.length > 2_000_000) return Response.json({ error: "conversation too long" }, { status: 413 });
  const parsed = bodySchema.safeParse(JSON.parse(raw || "{}"));
  if (!parsed.success) return Response.json({ error: "bad request" }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: EngineEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      try {
        await runAgentTurn({
          agentId,
          mode: parsed.data.mode,
          messages: parsed.data.messages as never,
          emit,
        });
      } catch (err) {
        console.error("agent turn failed", { agentId, error: err instanceof Error ? err.message : "unknown" });
        emit({ type: "error", message: "The agent ran into a problem. Please try again." });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" },
  });
}
