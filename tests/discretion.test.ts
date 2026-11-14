import { describe, expect, it } from "vitest";

import { assertDiscreet, findDiscretionViolations } from "@/agents/discretion";

describe("discretion guard", () => {
  it("blocks any mention of the village, agents, AI or automation", () => {
    expect(findDiscretionViolations("Posted via Agent Village")).toContain("Agent Village");
    expect(findDiscretionViolations("Mein Agent hat das erledigt")).toContain("agent/bot");
    expect(findDiscretionViolations("Erstellt mit KI")).toContain("AI");
    expect(findDiscretionViolations("drafted by Claude")).toContain("AI product names");
    expect(findDiscretionViolations("Automatisch erstellt")).toContain("automation");
    expect(() => assertDiscreet("This was automated")).toThrow(/Blocked/);
  });

  it("lets normal work texts through", () => {
    expect(findDiscretionViolations("Follow-up an den Kunden am 14.11. geschickt, warte auf Feedback.")).toEqual([]);
    expect(findDiscretionViolations("Please review the hook in the first frame and the CTA.")).toEqual([]);
    expect(findDiscretionViolations("Kickoff mit Kim und Mission Control abgestimmt")).toEqual([]);
  });
});
