import "server-only";

import { z } from "zod";

/**
 * The owner's calendar, read LIVE from the Apps Script feed
 * (docs/integrations/google-calendar-feed.gs). Never stored.
 */
const eventSchema = z.object({
  id: z.string(),
  title: z.string(),
  start: z.string(),
  end: z.string(),
  attendees: z.array(z.string()).default([]),
  description: z.string().default(""),
});
const feedSchema = z.object({ generatedAt: z.string(), events: z.array(eventSchema) });
export type CalendarEvent = z.infer<typeof eventSchema>;

export async function fetchUpcomingEvents(hours = 24): Promise<CalendarEvent[]> {
  const url = process.env.CALENDAR_FEED_URL;
  const key = process.env.CALENDAR_FEED_SECRET;
  if (!url || !key) throw new Error("Calendar feed is not configured.");
  const res = await fetch(`${url}?key=${encodeURIComponent(key)}&hours=${Math.min(Math.max(hours, 1), 72)}`, {
    redirect: "follow",
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Calendar feed failed (${res.status}).`);
  const parsed = feedSchema.safeParse(await res.json());
  if (!parsed.success) throw new Error("Calendar feed returned an unexpected answer (check the password).");
  return parsed.data.events;
}
