import "server-only";

import { and, inArray, lt, lte, gt, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { visits } from "@/db/schema";
import { fetchUpcomingEvents } from "@/integrations/calendar/feed";
import { logActivity } from "@/lib/activity";
import { pushToOwner } from "@/lib/push/send";

import { loadRegistry } from "./registry";
import { dueEventVisits, dueScheduleVisits, type DueVisit } from "./schedule";

/**
 * Turns the agents' triggers into visits. A visit stores only
 * agent id, a generic reason, priority and times — never ClickUp content.
 */
export async function runVisitScheduler(now = new Date()) {
  const db = getDb();
  const { agents } = await loadRegistry({ fresh: true });

  const due: Array<DueVisit & { priority: (typeof agents)[number]["priority"] }> = [];
  for (const a of agents) {
    for (const v of dueScheduleVisits(a.id, a.role, a.triggers, now)) due.push({ ...v, priority: a.priority });
  }

  let calendarError: string | null = null;
  const eventAgents = agents.filter((a) => a.triggers.some((t) => t.type === "before_event"));
  if (eventAgents.length > 0) {
    try {
      const maxLead = Math.max(...eventAgents.flatMap((a) => a.triggers.map((t) => (t.type === "before_event" ? t.minutes : 0))));
      const events = await fetchUpcomingEvents(Math.ceil((maxLead + 30) / 60));
      for (const a of eventAgents) {
        // A meeting starting soon outranks routine visits.
        for (const v of dueEventVisits(a.id, a.triggers, events, now)) due.push({ ...v, priority: "urgent" });
      }
    } catch (err) {
      calendarError = err instanceof Error ? err.message : "calendar failed";
    }
  }

  const created = due.length
    ? await db
        .insert(visits)
        .values(due.map((v) => ({ agentId: v.agentId, reason: v.reason, priority: v.priority, triggerKey: v.triggerKey, dueAt: v.dueAt, expiresAt: v.expiresAt })))
        .onConflictDoNothing({ target: visits.triggerKey })
        .returning({ id: visits.id, agentId: visits.agentId, reason: visits.reason })
    : [];

  // Housekeeping: expire missed visits, delete handled ones after a day (pointers only live as long as needed).
  await db.update(visits).set({ status: "expired" }).where(and(eq(visits.status, "pending"), lte(visits.expiresAt, now)));
  await db
    .delete(visits)
    .where(and(inArray(visits.status, ["delivered", "expired"]), lt(visits.createdAt, new Date(now.getTime() - 24 * 3600_000))));

  for (const v of created) {
    const agent = agents.find((a) => a.id === v.agentId);
    await pushToOwner({
      title: `${agent?.name ?? "Someone"} is on the way`,
      body: v.reason,
      tag: `visit-${v.id}`,
      url: "/",
    });
  }
  if (created.length) await logActivity("system", "visits.created", { count: created.length });
  return { created: created.length, calendarError };
}

/** Visits the village should show now. */
export async function pendingVisits(now = new Date()) {
  return getDb()
    .select({ id: visits.id, agentId: visits.agentId, reason: visits.reason, priority: visits.priority, dueAt: visits.dueAt })
    .from(visits)
    .where(and(eq(visits.status, "pending"), lte(visits.dueAt, now), gt(visits.expiresAt, now)));
}

export async function markVisitDelivered(id: string) {
  await getDb().update(visits).set({ status: "delivered" }).where(and(eq(visits.id, id), eq(visits.status, "pending")));
}
