import "server-only";

import { getDb, schema } from "@/db";

export type Actor = "owner" | "system" | `agent:${string}`;

/** Appends to the audit log. Never pass secrets in `details`. */
export async function logActivity(actor: Actor, action: string, details: Record<string, unknown> = {}) {
  try {
    await getDb().insert(schema.activityLog).values({ actor, action, details });
  } catch (err) {
    // Logging must never break the main action; surface it in server logs instead.
    console.error("activity log write failed", { action, error: err instanceof Error ? err.message : String(err) });
  }
}
