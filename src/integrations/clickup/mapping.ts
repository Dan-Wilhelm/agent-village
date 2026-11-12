import type { StatusDef, TaskAssignee } from "@/db/schema";

import type { ClickUpTask } from "./client";

/** Row shape for clickup_tasks (without account id / timestamps added at write time). */
export interface TaskRow {
  id: string;
  spaceId: string;
  folderId: string | null;
  listId: string;
  parentId: string | null;
  name: string;
  status: string;
  statusType: string | null;
  statusColor: string | null;
  priority: number | null;
  dueAt: Date | null;
  startAt: Date | null;
  createdAtRemote: Date | null;
  updatedAtRemote: Date | null;
  closedAt: Date | null;
  assignees: TaskAssignee[];
  tags: string[];
  url: string | null;
  descriptionMd: string | null;
}

const toDate = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? null : new Date(v));

/** We only keep tasks that are still open: closed/done statuses and archived tasks are removed. */
export function isOpenTask(t: ClickUpTask): boolean {
  if (t.archived) return false;
  if (t.date_closed) return false;
  const type = t.status.type ?? "";
  return type !== "closed" && type !== "done";
}

export function mapTask(t: ClickUpTask): TaskRow {
  const priority = t.priority?.id ? Number(t.priority.id) : null;
  return {
    id: t.id,
    spaceId: t.space.id,
    // ClickUp reports folderless lists inside a hidden folder
    folderId: t.folder && !t.folder.hidden ? t.folder.id : null,
    listId: t.list.id,
    parentId: t.parent ?? null,
    name: t.name,
    status: t.status.status,
    statusType: t.status.type ?? null,
    statusColor: t.status.color ?? null,
    priority: Number.isFinite(priority) ? priority : null,
    dueAt: toDate(t.due_date),
    startAt: toDate(t.start_date),
    createdAtRemote: toDate(t.date_created),
    updatedAtRemote: toDate(t.date_updated),
    closedAt: toDate(t.date_closed),
    assignees: (t.assignees ?? []).map((a) => ({
      id: a.id,
      username: a.username ?? "Unknown",
      initials: a.initials ?? undefined,
      color: a.color ?? undefined,
    })),
    tags: (t.tags ?? []).map((x) => x.name),
    url: t.url ?? null,
    // Keep descriptions bounded; full text is always one click away in ClickUp.
    descriptionMd: (t.markdown_description ?? t.text_content ?? null)?.slice(0, 20_000) ?? null,
  };
}

export function mapStatuses(
  statuses: Array<{ status: string; type?: string | null; color?: string | null; orderindex?: number | null }> | null | undefined,
): StatusDef[] {
  return (statuses ?? []).map((s, i) => ({
    status: s.status,
    type: s.type ?? "custom",
    color: s.color ?? "#999999",
    orderindex: s.orderindex ?? i,
  }));
}

/** Highest date_updated (ms) seen, used as the cursor for the next incremental sync. */
export function maxUpdatedMs(tasks: ClickUpTask[], previous: number | null): number | null {
  let max = previous;
  for (const t of tasks) if (t.date_updated != null && (max == null || t.date_updated > max)) max = t.date_updated;
  return max;
}
