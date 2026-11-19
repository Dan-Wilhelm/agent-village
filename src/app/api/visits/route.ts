import { z } from "zod";

import { markVisitDelivered, pendingVisits } from "@/agents/visits";
import { requireOwnerForRoute } from "@/lib/auth/owner";
import { rateLimitResponse } from "@/lib/rate-limit";

/** GET /api/visits — visits that are due now (no content, only who/why/priority). */
export async function GET() {
  const owner = await requireOwnerForRoute();
  if (!owner.ok) return owner.response;
  const limited = await rateLimitResponse("readHeavy");
  if (limited) return limited;
  const list = await pendingVisits();
  return Response.json({ visits: list.map((v) => ({ ...v, dueAt: v.dueAt.toISOString() })) });
}

const bodySchema = z.object({ id: z.string().uuid() });

/** POST /api/visits — the owner opened the visit; it will not be shown again. */
export async function POST(request: Request) {
  const owner = await requireOwnerForRoute();
  if (!owner.ok) return owner.response;
  const limited = await rateLimitResponse("readHeavy");
  if (limited) return limited;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });
  await markVisitDelivered(parsed.data.id);
  return Response.json({ ok: true });
}
