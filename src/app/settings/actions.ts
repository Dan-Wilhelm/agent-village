"use server";

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getDb, schema } from "@/db";
import { logActivity } from "@/lib/activity";
import { requireOwnerAction } from "@/lib/auth/require-owner";
import { encryptSecret, secretContext } from "@/lib/crypto/secrets";
import { ClickUpError, createClickUpClient } from "@/integrations/clickup/client";
import { clientFor, getClickUpAccount } from "@/integrations/clickup/account";

/**
 * ClickUp connection settings. Only the encrypted token and WHICH spaces are
 * allowed are stored here — task data is always read live from ClickUp.
 */

export type ActionState = { ok: boolean; message: string } | null;

const tokenSchema = z
  .string()
  .trim()
  .min(10, "That doesn't look like a ClickUp token.")
  .max(200, "That doesn't look like a ClickUp token.")
  .regex(/^pk_[A-Za-z0-9_]+$/, "A personal ClickUp token starts with pk_");

function friendly(err: unknown): string {
  if (err instanceof ClickUpError) {
    if (err.status === 401) return "ClickUp rejected the token. Please check it and try again.";
    if (err.status === 429) return "ClickUp is rate-limiting right now. Please try again in a minute.";
    return `ClickUp error: ${err.message}`;
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

async function defaultWorkspaceId(): Promise<string> {
  const db = getDb();
  const [existing] = await db.select().from(schema.workspaces).limit(1);
  if (existing) return existing.id;
  const [created] = await db.insert(schema.workspaces).values({ name: "Default" }).returning();
  return created.id;
}

export async function connectClickUp(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireOwnerAction();
  const parsed = tokenSchema.safeParse(formData.get("token"));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid token" };
  const token = parsed.data;

  try {
    const client = createClickUpClient({ token });
    const [{ user }, { teams }] = await Promise.all([client.getAuthorizedUser(), client.getTeams()]);
    const db = getDb();
    const existing = await getClickUpAccount();
    const id = existing?.id ?? randomUUID();
    const onlyTeam = teams.length === 1 ? teams[0] : null;
    const values = {
      tokenCiphertext: encryptSecret(token, secretContext.clickupToken(id)),
      externalUserId: user.id,
      externalUserName: user.username ?? user.email ?? "ClickUp user",
      teamId: onlyTeam?.id ?? existing?.teamId ?? null,
      teamName: onlyTeam?.name ?? existing?.teamName ?? null,
      updatedAt: new Date(),
    };
    if (existing) {
      await db.update(schema.integrationAccounts).set(values).where(eq(schema.integrationAccounts.id, id));
    } else {
      await db.insert(schema.integrationAccounts).values({ id, workspaceId: await defaultWorkspaceId(), provider: "clickup", ...values });
    }
    await logActivity("owner", "clickup.connected", { teams: teams.length });
    revalidatePath("/settings");
    return { ok: true, message: `Connected as ${values.externalUserName}.` };
  } catch (err) {
    return { ok: false, message: friendly(err) };
  }
}

export async function selectClickUpWorkspace(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireOwnerAction();
  const teamId = String(formData.get("teamId") ?? "");
  const account = await getClickUpAccount();
  if (!account) return { ok: false, message: "Connect ClickUp first." };
  try {
    const { teams } = await clientFor(account).getTeams();
    const team = teams.find((t) => t.id === teamId);
    if (!team) return { ok: false, message: "Unknown workspace." };
    await getDb()
      .update(schema.integrationAccounts)
      .set({ teamId: team.id, teamName: team.name, selectedSpaceIds: [], updatedAt: new Date() })
      .where(eq(schema.integrationAccounts.id, account.id));
    await logActivity("owner", "clickup.workspace_selected", {});
    revalidatePath("/settings");
    return { ok: true, message: `Workspace "${team.name}" selected.` };
  } catch (err) {
    return { ok: false, message: friendly(err) };
  }
}

export async function saveClickUpSpaces(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireOwnerAction();
  const requested = formData.getAll("spaceId").map(String);
  const account = await getClickUpAccount();
  if (!account?.teamId) return { ok: false, message: "Choose a ClickUp workspace first." };
  try {
    const { spaces } = await clientFor(account).getSpaces(account.teamId);
    const valid = requested.filter((id) => spaces.some((s) => s.id === id));
    await getDb()
      .update(schema.integrationAccounts)
      .set({ selectedSpaceIds: valid, updatedAt: new Date() })
      .where(eq(schema.integrationAccounts.id, account.id));
    await logActivity("owner", "clickup.spaces_saved", { spaces: valid.length });
    revalidatePath("/settings");
    return { ok: true, message: `Saved. Agents and ClickUp HQ can now see ${valid.length} space(s), read live from ClickUp.` };
  } catch (err) {
    return { ok: false, message: friendly(err) };
  }
}

export async function disconnectClickUp(): Promise<ActionState> {
  await requireOwnerAction();
  const account = await getClickUpAccount();
  if (!account) return { ok: true, message: "Already disconnected." };
  await getDb().delete(schema.integrationAccounts).where(eq(schema.integrationAccounts.id, account.id));
  await logActivity("owner", "clickup.disconnected");
  revalidatePath("/settings");
  return { ok: true, message: "ClickUp disconnected. The encrypted token has been deleted." };
}

/** Workspaces + spaces available to the connected token (for the pickers). */
export async function loadClickUpChoices() {
  await requireOwnerAction();
  const account = await getClickUpAccount();
  if (!account) return { teams: [], spaces: [] };
  try {
    const client = clientFor(account);
    const { teams } = await client.getTeams();
    const spaces = account.teamId ? (await client.getSpaces(account.teamId)).spaces : [];
    return {
      teams: teams.map((t) => ({ id: t.id, name: t.name })),
      spaces: spaces.map((s) => ({ id: s.id, name: s.name, color: s.color ?? null })),
    };
  } catch (err) {
    return { teams: [], spaces: [], error: friendly(err) };
  }
}
