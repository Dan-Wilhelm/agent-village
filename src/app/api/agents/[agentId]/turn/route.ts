import { z } from "zod";

import { runAgentTurn, type EngineEvent } from "@/agents/engine";
import { requireOwnerForRoute } from "@/lib/auth/owner";
import { rateLimitResponse } from "@/lib/rate-limit";
import { verifyTurnNote } from "@/lib/turn-note-sig";

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
          _sig: z.string().max(100).optional(),
        }),
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
  const limited = await rateLimitResponse("agentTurn");
  if (limited) return limited;
  const { agentId } = await params;
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(agentId)) return Response.json({ error: "bad agent" }, { status: 400 });

  const raw = await request.text();
  if (raw.length > 2_000_000) return Response.json({ error: "conversation too long" }, { status: 413 });
  let json: unknown;
  try {
    json = JSON.parse(raw || "{}");
  } catch {
    return Response.json({ error: "bad request" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return Response.json({ error: "bad request" }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: EngineEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      try {
        await runAgentTurn({
          agentId,
          mode: parsed.data.mode,
          // System messages: only the server's own signed turn notes survive (signature stripped for the API).
          messages: parsed.data.messages
            .filter((m) => m.role !== "system" || (typeof m.content === "string" && verifyTurnNote(m.content, m._sig)))
            .map(({ _sig, ...m }) => (void _sig, m)) as never,
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
