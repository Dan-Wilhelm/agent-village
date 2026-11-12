import { after } from "next/server";
import { eq } from "drizzle-orm";

import { getDb, schema } from "@/db";
import { decryptSecret, secretContext } from "@/lib/crypto/secrets";
import { applyTaskEvent, recordSyncError } from "@/integrations/clickup/sync";
import { verifyClickUpSignature, webhookPayloadSchema } from "@/integrations/clickup/webhook";

/**
 * ClickUp webhook receiver. Public (no session), so it authenticates every
 * request by its HMAC signature with the per-webhook secret stored encrypted.
 * It never trusts the payload: the task is re-read from ClickUp.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > 256_000) return new Response(null, { status: 413 });

  let payload;
  try {
    payload = webhookPayloadSchema.parse(JSON.parse(raw));
  } catch {
    return new Response(null, { status: 400 });
  }

  const [account] = await getDb()
    .select()
    .from(schema.integrationAccounts)
    .where(eq(schema.integrationAccounts.webhookId, payload.webhook_id))
    .limit(1);
  // Same answer for "unknown webhook" and "bad signature": reveal nothing.
  if (!account?.webhookSecretCiphertext) return new Response(null, { status: 401 });

  const secret = decryptSecret(account.webhookSecretCiphertext, secretContext.clickupWebhook(account.id));
  if (!verifyClickUpSignature(raw, request.headers.get("x-signature"), secret)) {
    return new Response(null, { status: 401 });
  }

  const taskId = payload.task_id;
  if (taskId) {
    // Acknowledge fast; do the ClickUp round-trip after the response.
    after(async () => {
      try {
        await applyTaskEvent(account, taskId, payload.event);
      } catch (err) {
        await recordSyncError(account.id, err);
      }
    });
  }
  return new Response(null, { status: 200 });
}
