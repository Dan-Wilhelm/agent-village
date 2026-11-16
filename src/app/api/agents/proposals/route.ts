import { z } from "zod";

import { executeProposal } from "@/agents/execute";
import { requireOwnerForRoute } from "@/lib/auth/owner";

const bodySchema = z.object({
  agentId: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
  kind: z.enum(["comment", "task_change", "draft_task", "mission_control_message", "playbook_rule", "meeting_notes"]),
  args: z.record(z.string(), z.unknown()),
  decision: z.enum(["approve", "reject"]),
});

/** POST /api/agents/proposals — the owner approves or rejects a proposal. */
export async function POST(request: Request) {
  const owner = await requireOwnerForRoute();
  if (!owner.ok) return owner.response;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, message: "Invalid request." }, { status: 400 });
  try {
    return Response.json(await executeProposal(parsed.data));
  } catch (err) {
    return Response.json({ ok: false, message: err instanceof Error ? err.message : "Failed." }, { status: 422 });
  }
}
