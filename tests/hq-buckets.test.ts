import { describe, expect, it } from "vitest";

import { dueBucket, formatDue } from "@/ui/hq/buckets";

const now = new Date(2026, 10, 12, 14, 0); // Thu 12 Nov 2026, 14:00 local
const at = (d: number, h = 12) => new Date(2026, 10, d, h).toISOString();

describe("due buckets", () => {
  it("classifies relative to the local day", () => {
    expect(dueBucket(null, now)).toBe("none");
    expect(dueBucket(at(11, 23), now)).toBe("overdue");
    expect(dueBucket(at(12, 1), now)).toBe("today"); // earlier today is still "today"
    expect(dueBucket(at(12, 23), now)).toBe("today");
    expect(dueBucket(at(13), now)).toBe("week");
    expect(dueBucket(at(18, 23), now)).toBe("week");
    expect(dueBucket(at(19, 1), now)).toBe("later");
  });

  it("formats human-friendly labels", () => {
    expect(formatDue(at(12), now)).toBe("today");
    expect(formatDue(at(13), now)).toBe("tomorrow");
    expect(formatDue(at(9), now)).toBe("3 days overdue");
    expect(formatDue(null, now)).toBe("no date");
  });
});
