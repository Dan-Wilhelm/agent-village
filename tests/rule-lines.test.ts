import { describe, expect, it } from "vitest";

import { findRuleLines, normaliseRuleText, replaceRuleLine } from "@/agents/rule-lines";

const craft = `# Craft — Client Follow-up

- Follow-up is due after **2 working days** without a client reaction. _(learned 2026-11-18)_
- Write follow-up texts in English, informal. _(learned 2026-11-19)_
- *to confirm:* Daily at 10:00 on weekdays?
`;

describe("rule lines", () => {
  it("ignores markdown and learned stamps when comparing", () => {
    expect(normaliseRuleText("- Follow-up is due after **2 working days** _(learned 2026-11-18)_")).toBe("follow-up is due after 2 working days");
  });

  it("finds exactly the quoted rule", () => {
    expect(findRuleLines(craft, "after 2 working days without a client reaction")).toEqual([
      "- Follow-up is due after **2 working days** without a client reaction. _(learned 2026-11-18)_",
    ]);
  });

  it("reports ambiguity and too-short quotes instead of guessing", () => {
    expect(findRuleLines(craft, "follow-up")).toEqual([]); // too short
    expect(findRuleLines(craft, "follow-up").length).toBe(0);
    expect(findRuleLines(craft + "- Another follow-up rule about texts in English, informal tone.\n", "in english, informal").length).toBe(2);
  });

  it("removes or replaces only that line, and refuses when it changed", () => {
    const line = findRuleLines(craft, "English, informal")[0];
    expect(replaceRuleLine(craft, line, null)).not.toContain("informal");
    expect(replaceRuleLine(craft, line, "- Write follow-up texts in German. _(changed 2026-11-20)_")).toContain("in German");
    expect(() => replaceRuleLine(craft, "- not there", null)).toThrow(/changed in the meantime/);
  });
});
