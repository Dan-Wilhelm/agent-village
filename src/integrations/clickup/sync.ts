import "server-only";

import { and, eq, inArray, lt, notInArray, sql } from "drizzle-orm";

import { getDb, schema } from "@/db";
import { logActivity } from "@/lib/activity";
import { decryptSecret, secretContext } from "@/lib/crypto/secrets";

import { createClickUpClient, type ClickUpClient, type ClickUpTask } from "./client";
import { isOpenTask, mapStatuses, mapTask, maxUpdatedMs } from "./mapping";

const MAX_PAGES = 100; // 100 tasks per page → up to 10k open tasks
const UPSERT_BATCH = 100;

type Account = typeof schema.integrationAccounts.$inferSelect;

/** The single ClickUp account of the default workspace (MVP), or null. */
export async function getClickUpAccount(): Promise<Account | null> {
  const rows = await getDb()
    .select()
    .from(schema.integrationAccounts)
    .where(eq(schema.integrationAccounts.provider, "clickup"))
    .limit(1);
  return rows[0] ?? null;
}

export function clientFor(account: Account): ClickUpClient {
  const token = decryptSecret(account.tokenCiphertext, secretContext.clickupToken(account.id));
  return createClickUpClient({ token });
}

async function upsertTasks(accountId: string, tasks: ClickUpTask[]) {
  const db = getDb();
  const rows = tasks.filter(isOpenTask).map((t) => ({ ...mapTask(t), accountId, syncedAt: new Date() }));
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const batch = rows.slice(i, i + UPSERT_BATCH);
    await db
      .insert(schema.clickupTasks)
      .values(batch)
      .onConflictDoUpdate({
        target: schema.clickupTasks.id,
        set: {
          accountId: sql`excluded.account_id`,
          spaceId: sql`excluded.space_id`,
          folderId: sql`excluded.folder_id`,
          listId: sql`excluded.list_id`,
          parentId: sql`excluded.parent_id`,
          name: sql`excluded.name`,
          status: sql`excluded.status`,
          statusType: sql`excluded.status_type`,
          statusColor: sql`excluded.status_color`,
          priority: sql`excluded.priority`,
          dueAt: sql`excluded.due_at`,
          startAt: sql`excluded.start_at`,
          createdAtRemote: sql`excluded.created_at_remote`,
          updatedAtRemote: sql`excluded.updated_at_remote`,
          closedAt: sql`excluded.closed_at`,
          assignees: sql`excluded.assignees`,
          tags: sql`excluded.tags`,
          url: sql`excluded.url`,
          descriptionMd: sql`excluded.description_md`,
          syncedAt: sql`excluded.synced_at`,
        },
      });
  }
  const closedIds = tasks.filter((t) => !isOpenTask(t)).map((t) => t.id);
  if (closedIds.length) {
    await db.delete(schema.clickupTasks).where(inArray(schema.clickupTasks.id, closedIds));
  }
  return { upserted: rows.length, removed: closedIds.length };
}

/** Spaces, folders and lists of the selected spaces. Removes everything of unselected spaces. */
async function syncHierarchy(account: Account, client: ClickUpClient) {
  const db = getDb();
  const selected = account.selectedSpaceIds;
  if (!account.teamId) throw new Error("No ClickUp workspace selected");
  const { spaces } = await client.getSpaces(account.teamId);
  const now = new Date();

  for (const space of spaces.filter((s) => selected.includes(s.id))) {
    await db
      .insert(schema.clickupSpaces)
      .values({ id: space.id, accountId: account.id, name: space.name, color: space.color ?? null, statuses: mapStatuses(space.statuses), syncedAt: now })
      .onConflictDoUpdate({
        target: schema.clickupSpaces.id,
        set: { name: space.name, color: space.color ?? null, statuses: mapStatuses(space.statuses), syncedAt: now },
      });

    const [{ folders }, { lists: folderless }] = await Promise.all([
      client.getFolders(space.id),
      client.getFolderlessLists(space.id),
    ]);
    for (const f of folders) {
      await db
        .insert(schema.clickupFolders)
        .values({ id: f.id, accountId: account.id, spaceId: space.id, name: f.name, hidden: Boolean(f.hidden), syncedAt: now })
        .onConflictDoUpdate({ target: schema.clickupFolders.id, set: { name: f.name, spaceId: space.id, hidden: Boolean(f.hidden), syncedAt: now } });
    }
    const lists = [
      ...folders.flatMap((f) => (f.lists ?? []).map((l) => ({ ...l, folderId: f.id }))),
      ...folderless.map((l) => ({ ...l, folderId: null as string | null })),
    ];
    for (const l of lists) {
      const statuses = l.statuses?.length ? mapStatuses(l.statuses) : null;
      await db
        .insert(schema.clickupLists)
        .values({ id: l.id, accountId: account.id, spaceId: space.id, folderId: l.folderId, name: l.name, statuses, syncedAt: now })
        .onConflictDoUpdate({ target: schema.clickupLists.id, set: { name: l.name, spaceId: space.id, folderId: l.folderId, statuses, syncedAt: now } });
    }
  }

  // Drop hierarchy rows that disappeared or belong to spaces no longer selected.
  await db.delete(schema.clickupLists).where(and(eq(schema.clickupLists.accountId, account.id), lt(schema.clickupLists.syncedAt, now)));
  await db.delete(schema.clickupFolders).where(and(eq(schema.clickupFolders.accountId, account.id), lt(schema.clickupFolders.syncedAt, now)));
  await db.delete(schema.clickupSpaces).where(and(eq(schema.clickupSpaces.accountId, account.id), lt(schema.clickupSpaces.syncedAt, now)));
  if (selected.length) {
    await db
      .delete(schema.clickupTasks)
      .where(and(eq(schema.clickupTasks.accountId, account.id), notInArray(schema.clickupTasks.spaceId, selected)));
  } else {
    await db.delete(schema.clickupTasks).where(eq(schema.clickupTasks.accountId, account.id));
  }
}

export interface SyncResult {
  kind: "full" | "incremental";
  tasks: number;
  removed: number;
  pages: number;
}

/** Full sync: hierarchy + all open tasks; tasks not seen anymore are removed. */
export async function fullSync(account: Account): Promise<SyncResult> {
  const client = clientFor(account);
  const db = getDb();
  const started = new Date();
  await syncHierarchy(account, client);

  let pages = 0;
  let total = 0;
  let cursor: number | null = account.syncCursorMs ? Number(account.syncCursorMs) : null;
  if (account.selectedSpaceIds.length && account.teamId) {
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await client.getTeamTasks(account.teamId, { spaceIds: account.selectedSpaceIds, page });
      pages++;
      const r = await upsertTasks(account.id, res.tasks);
      total += r.upserted;
      cursor = maxUpdatedMs(res.tasks, cursor);
      if (res.last_page !== false || res.tasks.length === 0) break;
    }
  }
  // Anything not refreshed in this run is closed, archived, moved away or deleted.
  const removed = await db
    .delete(schema.clickupTasks)
    .where(and(eq(schema.clickupTasks.accountId, account.id), lt(schema.clickupTasks.syncedAt, started)))
    .returning({ id: schema.clickupTasks.id });

  await db
    .update(schema.integrationAccounts)
    .set({ lastFullSyncAt: new Date(), syncCursorMs: cursor ? String(cursor) : null, lastSyncError: null, updatedAt: new Date() })
    .where(eq(schema.integrationAccounts.id, account.id));
  await logActivity("system", "clickup.full_sync", { tasks: total, removed: removed.length, pages });
  return { kind: "full", tasks: total, removed: removed.length, pages };
}

/** Incremental sync since the last cursor (includes closed tasks so they get removed). */
export async function incrementalSync(account: Account): Promise<SyncResult> {
  if (!account.syncCursorMs || !account.lastFullSyncAt || !account.teamId) return fullSync(account);
  // A full sync once a day keeps hierarchy and deletions exact.
  if (Date.now() - account.lastFullSyncAt.getTime() > 24 * 3600 * 1000) return fullSync(account);

  const client = clientFor(account);
  let cursor = Number(account.syncCursorMs);
  let pages = 0;
  let total = 0;
  let removed = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await client.getTeamTasks(account.teamId, {
      spaceIds: account.selectedSpaceIds,
      page,
      includeClosed: true,
      dateUpdatedGtMs: Number(account.syncCursorMs),
    });
    pages++;
    const r = await upsertTasks(account.id, res.tasks);
    total += r.upserted;
    removed += r.removed;
    cursor = maxUpdatedMs(res.tasks, cursor) ?? cursor;
    if (res.last_page !== false || res.tasks.length === 0) break;
  }
  await getDb()
    .update(schema.integrationAccounts)
    .set({ syncCursorMs: String(cursor), lastSyncError: null, updatedAt: new Date() })
    .where(eq(schema.integrationAccounts.id, account.id));
  return { kind: "incremental", tasks: total, removed, pages };
}

/** Applies one webhook event by re-reading the task from ClickUp (never trusting the payload). */
export async function applyTaskEvent(account: Account, taskId: string, event: string) {
  const db = getDb();
  if (event === "taskDeleted") {
    await db.delete(schema.clickupTasks).where(eq(schema.clickupTasks.id, taskId));
    return "deleted";
  }
  const task = await clientFor(account).getTask(taskId);
  if (!account.selectedSpaceIds.includes(task.space.id) || !isOpenTask(task)) {
    await db.delete(schema.clickupTasks).where(eq(schema.clickupTasks.id, taskId));
    return "removed";
  }
  await upsertTasks(account.id, [task]);
  return "upserted";
}

export async function recordSyncError(accountId: string, err: unknown) {
  const message = err instanceof Error ? err.message.slice(0, 500) : "Unknown error";
  await getDb()
    .update(schema.integrationAccounts)
    .set({ lastSyncError: message, updatedAt: new Date() })
    .where(eq(schema.integrationAccounts.id, accountId));
  await logActivity("system", "clickup.sync_error", { message });
}
