import type { ClickUpTask } from "./client";

/** A task as shown in ClickUp HQ (read live, never stored). */
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

const iso = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? null : new Date(v).toISOString());

/** Closed/done statuses and archived tasks are not "open". */
export function isOpenTask(t: ClickUpTask): boolean {
  if (t.archived) return false;
  if (t.date_closed) return false;
  const type = t.status.type ?? "";
  return type !== "closed" && type !== "done";
}

export function toHqTask(t: ClickUpTask): HqTask {
  const priority = t.priority?.id ? Number(t.priority.id) : null;
  return {
    id: t.id,
    name: t.name,
    status: t.status.status,
    statusColor: t.status.color ?? null,
    priority: Number.isFinite(priority) ? priority : null,
    dueAt: iso(t.due_date),
    listId: t.list.id,
    spaceId: t.space.id,
    // ClickUp reports folderless lists inside a hidden folder
    folderId: t.folder && !t.folder.hidden ? t.folder.id : null,
    parentId: t.parent ?? null,
    assignees: (t.assignees ?? []).map((a) => ({
      id: a.id,
      username: a.username ?? "Unknown",
      initials: a.initials ?? undefined,
      color: a.color ?? undefined,
    })),
    tags: (t.tags ?? []).map((x) => x.name),
    url: t.url ?? null,
  };
}

/** List and folder names, taken from the tasks themselves (no extra requests, nothing stored). */
export function hierarchyFromTasks(tasks: ClickUpTask[]) {
  const lists = new Map<string, { id: string; name: string; spaceId: string; folderId: string | null }>();
  const folders = new Map<string, { id: string; name: string }>();
  for (const t of tasks) {
    const folderId = t.folder && !t.folder.hidden ? t.folder.id : null;
    if (!lists.has(t.list.id)) lists.set(t.list.id, { id: t.list.id, name: t.list.name ?? "List", spaceId: t.space.id, folderId });
    if (folderId && !folders.has(folderId)) folders.set(folderId, { id: folderId, name: t.folder?.name ?? "Folder" });
  }
  return {
    lists: [...lists.values()].sort((a, b) => a.name.localeCompare(b.name)),
    folders: [...folders.values()],
  };
}
