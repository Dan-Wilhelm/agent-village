import { runVisitScheduler } from "@/agents/visits";
import { safeEqual } from "@/lib/secret-compare";

export const maxDuration = 60;

/** GET /api/cron/visits — called every minute by Vercel Cron (Bearer CRON_SECRET). */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(header, `Bearer ${secret}`)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  // Development only: simulate another time (?at=ISO) to test triggers.
  const at = process.env.NODE_ENV === "development" ? new URL(request.url).searchParams.get("at") : null;
  const now = at && !Number.isNaN(Date.parse(at)) ? new Date(at) : new Date();
  try {
    return Response.json(await runVisitScheduler(now));
  } catch (err) {
    console.error("visit scheduler failed", err);
    return Response.json({ error: "scheduler failed" }, { status: 500 });
  }
}
