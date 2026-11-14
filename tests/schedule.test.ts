import { describe, expect, it } from "vitest";

import { dueEventVisits, dueScheduleVisits, internalDomain, zonedParts } from "@/agents/schedule";

describe("zoned time (Europe/Berlin)", () => {
  it("handles winter and summer time", () => {
    expect(zonedParts(new Date("2026-11-16T07:00:00Z"))).toMatchObject({ hour: 8, minute: 0, weekday: "mon", date: "2026-11-16" });
    expect(zonedParts(new Date("2026-07-06T06:00:00Z"))).toMatchObject({ hour: 8, minute: 0, weekday: "mon" });
  });
});

describe("schedule triggers", () => {
  const weekdays8 = [{ type: "schedule" as const, days: ["mon", "tue", "wed", "thu", "fri"] as ("mon" | "tue" | "wed" | "thu" | "fri")[], time: "08:00" }];

  it("fires at the configured local time on weekdays, deduped by key", () => {
    const due = dueScheduleVisits("kai", "Daily plan", weekdays8, new Date("2026-11-16T07:03:00Z"));
    expect(due).toHaveLength(1);
    expect(due[0].triggerKey).toBe("kai:schedule:2026-11-16T08:00");
    expect(due[0].dueAt.toISOString()).toBe("2026-11-16T07:00:00.000Z");
  });

  it("does not fire on weekends or outside the window", () => {
    expect(dueScheduleVisits("kai", "x", weekdays8, new Date("2026-11-14T07:01:00Z"))).toHaveLength(0); // Saturday
    expect(dueScheduleVisits("kai", "x", weekdays8, new Date("2026-11-16T07:30:00Z"))).toHaveLength(0);
  });

  it("supports several times a day", () => {
    const rita = [{ type: "schedule" as const, days: ["mon"] as "mon"[], time: ["09:00", "13:00", "17:00"] }];
    expect(dueScheduleVisits("rita", "x", rita, new Date("2026-11-16T12:00:30Z"))[0]?.triggerKey).toBe("rita:schedule:2026-11-16T13:00");
  });
});

describe("before_event triggers", () => {
  const events = [
    { id: "a", start: "2026-11-16T09:00:00Z", attendees: ["dan@acme.com", "kim@acme.com"] },
    { id: "b", start: "2026-11-16T10:00:00Z", attendees: ["dan@acme.com", "anna@client.de"] },
  ];
  const mila = [{ type: "before_event" as const, minutes: 10, match: "client meetings" }];

  it("knows the internal domain", () => {
    expect(internalDomain(events)).toBe("acme.com");
  });

  it("fires 10 minutes before client meetings only", () => {
    expect(dueEventVisits("mila", mila, events, new Date("2026-11-16T08:51:00Z"))).toHaveLength(0); // internal meeting
    const due = dueEventVisits("mila", mila, events, new Date("2026-11-16T09:51:00Z"));
    expect(due).toHaveLength(1);
    expect(due[0].reason).toBe("Meeting at 11:00");
    expect(due[0].expiresAt.toISOString()).toBe("2026-11-16T10:15:00.000Z");
  });

  it("does not fire after the meeting started", () => {
    expect(dueEventVisits("mila", mila, events, new Date("2026-11-16T10:01:00Z"))).toHaveLength(0);
  });
});
