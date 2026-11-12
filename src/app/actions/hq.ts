"use server";

import { and, asc, eq, sql } from "drizzle-orm";

import { getDb, schema } from "@/db";
import { requireOwnerAction } from "@/lib/auth/require-owner";
import { clientFor, getClickUpAccount } from "@/integrations/clickup/sync";

export interface HqTask {
  id: string;
  name: string;
  status: string;
  statusColor: string | null;
  priority: number | null;
  dueAt: string | null;
  listId: string;
  spaceId: string;
  folderId: string | null;
  parentId: string | null;
  assignees: Array<{ id: string; username: string; initials?: string; color?: string }>;
  tags: string[];
  url: string | null;
}

export type HqOverview =
  | { connected: false }
  | {
      connected: true;
      ready: boolean;
      me: string;
      lastSyncAt: string | null;
      spaces: Array<{ id: string; name: string; color: string | null }>;
      lists: Array<{ id: string; name: string; spaceId: string; folderId: string | null }>;
      folders: Array<{ id: string; name: string }>;
      tasks: HqTask[];
      truncated: boolean;
    };

const TASK_LIMIT = 3000;

export async function getHqOverview(): Promise<HqOverview> {
  await requireOwnerAction();
  const account = await getClickUpAccount();
  if (!account) return { connected: false };
  const db = getDb();
  const [spaces, lists, folders, tasks] = await Promise.all([
    db.select().from(schema.clickupSpaces).where(eq(schema.clickupSpaces.accountId, account.id)).orderBy(asc(schema.clickupSpaces.name)),
    db.select().from(schema.clickupLists).where(eq(schema.clickupLists.accountId, account.id)).orderBy(asc(schema.clickupLists.name)),
    db.select().from(schema.clickupFolders).where(eq(schema.clickupFolders.accountId, account.id)),
    db
      .select({
        id: schema.clickupTasks.id,
        name: schema.clickupTasks.name,
        status: schema.clickupTasks.status,
        statusColor: schema.clickupTasks.statusColor,
        priority: schema.clickupTasks.priority,
        dueAt: schema.clickupTasks.dueAt,
        listId: schema.clickupTasks.listId,
        spaceId: schema.clickupTasks.spaceId,
        folderId: schema.clickupTasks.folderId,
        parentId: schema.clickupTasks.parentId,
        assignees: schema.clickupTasks.assignees,
        tags: schema.clickupTasks.tags,
        url: schema.clickupTasks.url,
      })
      .from(schema.clickupTasks)
      .where(eq(schema.clickupTasks.accountId, account.id))
      .orderBy(sql`${schema.clickupTasks.dueAt} asc nulls last`, asc(schema.clickupTasks.name))
      .limit(TASK_LIMIT + 1),
  ]);

  return {
    connected: true,
    ready: Boolean(account.teamId && account.selectedSpaceIds.length),
    me: account.externalUserId,
    lastSyncAt: account.lastFullSyncAt?.toISOString() ?? null,
    spaces: spaces.map((s) => ({ id: s.id, name: s.name, color: s.color })),
    lists: lists.map((l) => ({ id: l.id, name: l.name, spaceId: l.spaceId, folderId: l.folderId })),
    folders: folders.map((f) => ({ id: f.id, name: f.name })),
    tasks: tasks.slice(0, TASK_LIMIT).map((t) => ({ ...t, dueAt: t.dueAt?.toISOString() ?? null })),
    truncated: tasks.length > TASK_LIMIT,
  };
}

export interface HqTaskDetail {
  id: string;
  description: string | null;
  comments: Array<{ id: string; author: string; text: string; at: string | null }>;
  commentsError?: string;
}

/** Description from the cache; latest comments live from ClickUp (one request). */
export async function getHqTaskDetail(taskId: string): Promise<HqTaskDetail | null> {
  await requireOwnerAction();
  if (typeof taskId !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(taskId)) return null;
  const account = await getClickUpAccount();
  if (!account) return null;
  const [row] = await getDb()
    .select({ id: schema.clickupTasks.id, description: schema.clickupTasks.descriptionMd })
    .from(schema.clickupTasks)
    .where(and(eq(schema.clickupTasks.id, taskId), eq(schema.clickupTasks.accountId, account.id)))
    .limit(1);
  if (!row) return null; // only tasks from the synced spaces

  try {
    const { comments } = await clientFor(account).getTaskComments(taskId);
    return {
      id: row.id,
      description: row.description,
      comments: comments.slice(0, 8).map((c) => ({
        id: c.id,
        author: c.user?.username ?? "Someone",
        text: (c.comment_text ?? "").slice(0, 4000),
        at: c.date ? new Date(c.date).toISOString() : null,
      })),
    };
  } catch {
    return { id: row.id, description: row.description, comments: [], commentsError: "Comments could not be loaded right now." };
  }
}
