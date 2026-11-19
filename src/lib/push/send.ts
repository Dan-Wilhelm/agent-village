import "server-only";

import { eq } from "drizzle-orm";
import webpush from "web-push";

import { getDb } from "@/db";
import { pushSubscriptions } from "@/db/schema";

/**
 * Generic Web Push to the owner's devices. Payloads never contain ClickUp
 * content — only who is coming and a generic reason from the vault.
 */
let configured = false;
function configure() {
  if (configured) return true;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!pub || !priv || !subject) return false;
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  url?: string;
}

/** Sends to every subscription; removes endpoints the browser has revoked. Returns the number delivered. */
export async function pushToOwner(payload: PushPayload): Promise<number> {
  if (!configure()) return 0;
  const db = getDb();
  const subs = await db.select().from(pushSubscriptions);
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          { TTL: 600, urgency: "high" },
        );
        sent++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
      }
    }),
  );
  return sent;
}
