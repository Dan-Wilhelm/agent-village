/** Due-date buckets in the viewer's local time zone. Pure, so it is unit-tested. */
export type DueBucket = "overdue" | "today" | "week" | "later" | "none";

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function dueBucket(dueIso: string | null, now: Date = new Date()): DueBucket {
  if (!dueIso) return "none";
  const due = new Date(dueIso);
  const today = startOfDay(now);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const weekEnd = new Date(today);
  weekEnd.setDate(today.getDate() + 7);
  if (due < today) return "overdue";
  if (due < tomorrow) return "today";
  if (due < weekEnd) return "week";
  return "later";
}

export function formatDue(dueIso: string | null, now: Date = new Date()): string {
  if (!dueIso) return "no date";
  const due = new Date(dueIso);
  const days = Math.round((startOfDay(due).getTime() - startOfDay(now).getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days < 0) return `${-days} days overdue`;
  if (days < 7) return due.toLocaleDateString(undefined, { weekday: "long" });
  return due.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
