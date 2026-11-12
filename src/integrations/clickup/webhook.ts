import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/** Task events we subscribe to. Docs/meetings have no webhooks in ClickUp. */
export const WEBHOOK_EVENTS = [
  "taskCreated",
  "taskUpdated",
  "taskDeleted",
  "taskStatusUpdated",
  "taskAssigneeUpdated",
  "taskDueDateUpdated",
  "taskMoved",
  "taskPriorityUpdated",
  "taskTagUpdated",
] as const;

export const webhookPayloadSchema = z.object({
  event: z.string(),
  webhook_id: z.coerce.string(),
  task_id: z.coerce.string().optional(),
});

/**
 * ClickUp signs the raw request body with HMAC-SHA256 (hex) using the webhook
 * secret, sent in the `X-Signature` header. Compare in constant time.
 */
export function verifyClickUpSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const given = Buffer.from(signature, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Constant-time comparison for bearer secrets (e.g. CRON_SECRET). */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Public URL ClickUp should call, or null when not deployed (local dev has no public URL). */
export function webhookEndpoint(env: Record<string, string | undefined> = process.env): string | null {
  const base = env.APP_BASE_URL ?? (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : null);
  if (!base || !base.startsWith("https://") || base.includes("localhost")) return null;
  return `${base.replace(/\/$/, "")}/api/webhooks/clickup`;
}
