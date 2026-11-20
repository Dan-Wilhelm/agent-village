"use server";

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { loadRegistry } from "@/agents/registry";
import { getDb, schema } from "@/db";
import { getFigmaAccount, listFigmaAccounts } from "@/integrations/figma/account";
import { createFigmaClient, FigmaError } from "@/integrations/figma/client";
import { logActivity } from "@/lib/activity";
import { requireOwnerAction } from "@/lib/auth/require-owner";
import { encryptSecret, secretContext } from "@/lib/crypto/secrets";

/**
 * Figma connection per company: only the encrypted personal access token and the
 * Figma account's handle are stored. Designs are always read live from Figma.
 */
export type FigmaActionState = { ok: boolean; message: string } | null;

const tokenSchema = z
  .string()
  .trim()
  .min(20, "That doesn't look like a Figma token.")
  .max(300, "That doesn't look like a Figma token.")
  .regex(/^[A-Za-z0-9_-]+$/, "That doesn't look like a Figma token (it usually starts with figd_).");

/** Companies with their Figma connection (handle only). */
export async function loadFigmaStatus() {
  await requireOwnerAction();
  const [registry, accounts] = await Promise.all([loadRegistry(), listFigmaAccounts()]);
  return registry.companies.map((c) => {
    const a = accounts.find((x) => x.companyId === c.id);
    return { companyId: c.id, companyName: c.name, handle: a?.figmaHandle ?? null, since: a?.createdAt.toISOString() ?? null };
  });
}

export async function connectFigma(_prev: FigmaActionState, formData: FormData): Promise<FigmaActionState> {
  await requireOwnerAction();
  const companyId = String(formData.get("companyId") ?? "");
  const registry = await loadRegistry();
  if (!registry.companies.some((c) => c.id === companyId)) return { ok: false, message: "Unknown company." };
  const parsed = tokenSchema.safeParse(formData.get("token"));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid token" };
  try {
    // Check the token before storing it (needs the scope current_user:read).
    const me = await createFigmaClient(parsed.data).me();
    const existing = await getFigmaAccount(companyId);
    const id = existing?.id ?? randomUUID();
    const values = {
      tokenCiphertext: encryptSecret(parsed.data, secretContext.figmaToken(id)),
      figmaUserId: me.id,
      figmaHandle: me.handle,
    };
    const db = getDb();
    if (existing) await db.update(schema.figmaAccounts).set(values).where(eq(schema.figmaAccounts.id, id));
    else await db.insert(schema.figmaAccounts).values({ id, companyId, ...values });
    await logActivity("owner", "figma.connected", { companyId });
    revalidatePath("/settings");
    return { ok: true, message: `Connected as ${me.handle}.` };
  } catch (err) {
    if (err instanceof FigmaError && (err.status === 403 || err.status === 401)) {
      return { ok: false, message: "Figma rejected the token. Check it and that it has the scope “current_user:read”." };
    }
    return { ok: false, message: err instanceof Error ? err.message : "Could not reach Figma." };
  }
}

export async function disconnectFigma(companyId: string): Promise<FigmaActionState> {
  await requireOwnerAction();
  await getDb().delete(schema.figmaAccounts).where(eq(schema.figmaAccounts.companyId, String(companyId)));
  await logActivity("owner", "figma.disconnected", { companyId });
  revalidatePath("/settings");
  return { ok: true, message: "Disconnected." };
}
