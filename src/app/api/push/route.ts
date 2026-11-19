import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { logActivity } from "@/lib/activity";
import { requireOwnerForRoute } from "@/lib/auth/owner";
import { pushToOwner } from "@/lib/push/send";
import { rateLimitResponse } from "@/lib/rate-limit";

const subscribeSchema = z.object({
  action: z.literal("subscribe"),
  subscription: z.object({
    endpoint: z
      .string()
      .url()
      .max(2000)
      .refine((u) => {
        // Only the browsers' real push services (the server POSTs to this URL).
        const host = new URL(u).hostname;
        return (
          u.startsWith("https://") &&
          (host === "fcm.googleapis.com" ||
            host === "updates.push.services.mozilla.com" ||
            host.endsWith(".push.apple.com") ||
            host.endsWith(".notify.windows.com"))
        );
      }, "unsupported push service"),
    keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
  }),
});
const unsubscribeSchema = z.object({ action: z.literal("unsubscribe"), endpoint: z.string().url().max(2000) });
const testSchema = z.object({ action: z.literal("test") });
const bodySchema = z.discriminatedUnion("action", [subscribeSchema, unsubscribeSchema, testSchema]);

/** POST /api/push — subscribe / unsubscribe this device, or send a test notification. */
export async function POST(request: Request) {
  const owner = await requireOwnerForRoute();
  if (!owner.ok) return owner.response;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, message: "Invalid request." }, { status: 400 });
  const limited = await rateLimitResponse(parsed.data.action === "test" ? "pushTest" : "readHeavy");
  if (limited) return limited;
  const db = getDb();
  const body = parsed.data;

  if (body.action === "subscribe") {
    const { endpoint, keys } = body.subscription;
    await db
      .insert(pushSubscriptions)
      .values({ endpoint, p256dh: keys.p256dh, auth: keys.auth })
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { p256dh: keys.p256dh, auth: keys.auth } });
    await logActivity("owner", "push.subscribed", {});
    return Response.json({ ok: true, message: "Notifications are on for this device." });
  }
  if (body.action === "unsubscribe") {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, body.endpoint));
    await logActivity("owner", "push.unsubscribed", {});
    return Response.json({ ok: true, message: "Notifications are off for this device." });
  }
  const sent = await pushToOwner({ title: "Test from the village", body: "Notifications work 🎉", tag: "test", url: "/" });
  return Response.json({ ok: sent > 0, message: sent > 0 ? `Sent to ${sent} device(s).` : "No device is subscribed." });
}
