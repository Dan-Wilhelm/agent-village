import fs from "node:fs";
import { describe, expect, it } from "vitest";

import { parseNote, serializeNote, updateFields } from "@/agents/frontmatter";
import { agentProfileSchema, classifyVaultPath } from "@/agents/schema";

const fixture = fs.readFileSync(new URL("./fixture-agent-profile.md", import.meta.url), "utf8");

describe("vault notes", () => {
  it("parses frontmatter and keeps the body", () => {
    const note = parseNote(fixture);
    expect(note.data.id).toBe("sqvm-meeting-prep");
    expect(note.body).toContain("## Mission");
  });

  it("renames without touching the body", () => {
    const renamed = updateFields(fixture, { name: "Mira" });
    expect(parseNote(renamed).data.name).toBe("Mira");
    expect(parseNote(renamed).body.trim()).toBe(parseNote(fixture).body.trim());
    expect(parseNote(renamed).data.triggers).toEqual(parseNote(fixture).data.triggers);
  });

  it("round-trips a note", () => {
    const note = parseNote(fixture);
    expect(parseNote(serializeNote(note)).data).toEqual(note.data);
  });

  it("treats notes without frontmatter as plain body", () => {
    expect(parseNote("# Hello\ntext")).toEqual({ data: {}, body: "# Hello\ntext" });
  });
});

describe("agent profile schema", () => {
  it("accepts the seeded profile", () => {
    const r = agentProfileSchema.safeParse(parseNote(fixture).data);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.priority).toBe("urgent");
      expect(r.data.triggers[0]).toEqual({ type: "before_event", minutes: 10, match: "client meetings" });
    }
  });

  it("rejects unknown permissions, models and bad times", () => {
    const base = parseNote(fixture).data;
    expect(agentProfileSchema.safeParse({ ...base, permissions: ["delete_everything"] }).success).toBe(false);
    expect(agentProfileSchema.safeParse({ ...base, model: "gpt-x" }).success).toBe(false);
    expect(
      agentProfileSchema.safeParse({ ...base, triggers: [{ type: "schedule", days: ["mon"], time: "25:00" }] }).success,
    ).toBe(false);
  });
});

describe("vault paths", () => {
  it("classifies company, team and agent notes", () => {
    expect(classifyVaultPath("Companies/SQVM/SQVM.md")).toEqual({ kind: "company", company: "SQVM" });
    expect(classifyVaultPath("Companies/SQVM/Teams/Core/Core.md")).toEqual({ kind: "team", company: "SQVM", team: "Core" });
    expect(classifyVaultPath("Companies/SQVM/Agents/Meeting Prep/Meeting Prep.md")).toEqual({
      kind: "agent",
      company: "SQVM",
      role: "Meeting Prep",
    });
    expect(classifyVaultPath("Companies/SQVM/Agents/Meeting Prep/Craft.md")).toBeNull();
    expect(classifyVaultPath("Shared/About me.md")).toBeNull();
  });
});
