import { getClickUpAccount, incrementalSync, recordSyncError } from "@/integrations/clickup/sync";
import { safeEqual } from "@/integrations/clickup/webhook";

export const maxDuration = 300;

/**
 * Catch-up sync, called by Vercel Cron (see vercel.json). Vercel sends
 * `Authorization: Bearer $CRON_SECRET`; without a configured secret we refuse.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return new Response(null, { status: 401 });

  const account = await getClickUpAccount();
  if (!account || !account.teamId || account.selectedSpaceIds.length === 0) {
    return Response.json({ skipped: "not connected" });
  }
  try {
    const result = await incrementalSync(account);
    return Response.json(result);
  } catch (err) {
    await recordSyncError(account.id, err);
    return Response.json({ error: "sync failed" }, { status: 500 });
  }
}
