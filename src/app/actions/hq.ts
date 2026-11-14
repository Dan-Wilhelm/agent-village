"use server";

import { requireOwnerAction } from "@/lib/auth/require-owner";
import { ClickUpError } from "@/integrations/clickup/client";
import { clientFor, getClickUpAccount } from "@/integrations/clickup/account";
import type { HqTask } from "@/integrations/clickup/mapping";

export type { HqTask };

export type HqMeta =
  | { connected: false }
  | {
      connected: true;
      ready: boolean;
      me: string;
      spaces: Array<{ id: string; name: string; color: string | null }>;
      error?: string;
    };

/** Connection + allowed spaces (live from ClickUp). Tasks are loaded in parallel slices via /api/hq/tasks. */
export async function getHqMeta(): Promise<HqMeta> {
  await requireOwnerAction();
  const account = await getClickUpAccount();
  if (!account) return { connected: false };
  const ready = Boolean(account.teamId && account.selectedSpaceIds.length);
  if (!ready || !account.teamId) return { connected: true, ready: false, me: account.externalUserId, spaces: [] };
  try {
    const { spaces } = await clientFor(account).getSpaces(account.teamId);
    return {
      connected: true,
      ready: true,
      me: account.externalUserId,
      spaces: spaces
        .filter((s) => account.selectedSpaceIds.includes(s.id))
        .map((s) => ({ id: s.id, name: s.name, color: s.color ?? null })),
    };
  } catch (err) {
    const error =
      err instanceof ClickUpError && err.status === 401
        ? "ClickUp rejected the token. Please reconnect in Settings."
        : "Could not reach ClickUp right now.";
    return { connected: true, ready: true, me: account.externalUserId, spaces: [], error };
  }
}

export interface HqTaskDetail {
  id: string;
  description: string | null;
  comments: Array<{ id: string; author: string; text: string; at: string | null }>;
  commentsError?: string;
}

/** Description and latest comments, live from ClickUp; only for tasks in the allowed spaces. */
export async function getHqTaskDetail(taskId: string): Promise<HqTaskDetail | null> {
  await requireOwnerAction();
  if (typeof taskId !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(taskId)) return null;
  const account = await getClickUpAccount();
  if (!account) return null;
  const client = clientFor(account);

  let task;
  try {
    task = await client.getTask(taskId);
  } catch {
    return null;
  }
  if (!account.selectedSpaceIds.includes(task.space.id)) return null; // only allowed spaces

  const description = (task.markdown_description ?? task.text_content ?? null)?.slice(0, 20_000) ?? null;
  try {
    const { comments } = await client.getTaskComments(taskId);
    return {
      id: task.id,
      description,
      comments: comments.slice(0, 8).map((c) => ({
        id: c.id,
        author: c.user?.username ?? "Someone",
        text: (c.comment_text ?? "").slice(0, 4000),
        at: c.date ? new Date(c.date).toISOString() : null,
      })),
    };
  } catch {
    return { id: task.id, description, comments: [], commentsError: "Comments could not be loaded right now." };
  }
}
