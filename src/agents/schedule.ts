import type { Trigger } from "./schema";

/**
 * Pure scheduling logic (no I/O): which visits are due for an agent's triggers.
 * Times in profiles are Europe/Berlin wall-clock times.
 */

export const TIME_ZONE = "Europe/Berlin";
type DayKey = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";

/** Wall-clock parts of `date` in the given time zone. */
export function zonedParts(date: Date, timeZone = TIME_ZONE) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    hour: Number(p.hour),
    minute: Number(p.minute),
    weekday: p.weekday.toLowerCase().slice(0, 3) as DayKey,
  };
}

export interface DueVisit {
  agentId: string;
  reason: string;
  triggerKey: string;
  dueAt: Date;
  expiresAt: Date;
}

/**
 * Schedule triggers that became due within the last `windowMinutes` (the cron
 * runs every minute; a window tolerates missed runs). Expires after 3 hours.
 */
export function dueScheduleVisits(
  agentId: string,
  reasonLabel: string,
  triggers: Trigger[],
  now: Date,
  windowMinutes = 10,
): DueVisit[] {
  const out: DueVisit[] = [];
  for (let back = 0; back < windowMinutes; back++) {
    const t = new Date(now.getTime() - back * 60_000);
    const z = zonedParts(t);
    const hhmm = `${String(z.hour).padStart(2, "0")}:${String(z.minute).padStart(2, "0")}`;
    for (const trig of triggers) {
      if (trig.type !== "schedule" || !trig.days.includes(z.weekday)) continue;
      const times = Array.isArray(trig.time) ? trig.time : [trig.time];
      if (!times.includes(hhmm)) continue;
      const dueAt = new Date(Math.floor(t.getTime() / 60_000) * 60_000);
      out.push({
        agentId,
        reason: reasonLabel,
        triggerKey: `${agentId}:schedule:${z.date}T${hhmm}`,
        dueAt,
        expiresAt: new Date(dueAt.getTime() + 3 * 3600_000),
      });
    }
  }
  return out;
}

export interface CalendarEventLite {
  id: string;
  start: string;
  attendees: string[];
}

const domainOf = (email: string) => email.split("@")[1]?.toLowerCase() ?? "";

/** The owner's own domain = the most common attendee domain across the window. */
export function internalDomain(events: CalendarEventLite[]): string | null {
  const counts = new Map<string, number>();
  for (const e of events) for (const a of e.attendees) counts.set(domainOf(a), (counts.get(domainOf(a)) ?? 0) + 1);
  let best: string | null = null;
  let max = 0;
  for (const [d, n] of counts) if (d && n > max) [best, max] = [d, n];
  return best;
}

/** "client meetings" = meetings with at least one attendee outside the internal domain. */
export function matchesEvent(match: string, event: CalendarEventLite, internal: string | null): boolean {
  if (/client|kunde|extern/i.test(match)) {
    return internal !== null && event.attendees.some((a) => domainOf(a) && domainOf(a) !== internal);
  }
  return true;
}

/** before_event triggers: due `minutes` before an event start (within the window), expire at the start. */
export function dueEventVisits(
  agentId: string,
  triggers: Trigger[],
  events: CalendarEventLite[],
  now: Date,
  windowMinutes = 10,
): DueVisit[] {
  const internal = internalDomain(events);
  const out: DueVisit[] = [];
  for (const trig of triggers) {
    if (trig.type !== "before_event") continue;
    for (const ev of events) {
      const start = Date.parse(ev.start);
      if (Number.isNaN(start) || !matchesEvent(trig.match, ev, internal)) continue;
      const dueAt = start - trig.minutes * 60_000;
      if (now.getTime() >= dueAt && now.getTime() - dueAt < windowMinutes * 60_000 && now.getTime() < start) {
        const hhmm = new Date(start).toLocaleTimeString("en-GB", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" });
        out.push({
          agentId,
          reason: `Meeting at ${hhmm}`,
          triggerKey: `${agentId}:event:${ev.id}:${start}`,
          dueAt: new Date(dueAt),
          expiresAt: new Date(start + 15 * 60_000),
        });
      }
    }
  }
  return out;
}
