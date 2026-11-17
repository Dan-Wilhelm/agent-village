import { describe, expect, it } from "vitest";

import {
  agentIdFor,
  agentInputSchema,
  buildContextNote,
  buildProfileNote,
  copiedProfileData,
  effectiveAutoApprove,
  normaliseTriggers,
  slug,
} from "@/agents/authoring-format";
import { parseNote } from "@/agents/frontmatter";
import { agentProfileSchema, classifyVaultPath } from "@/agents/schema";

const base = {
  company: "acme",
  team: { existing: "Core" },
  role: "Process Consultant",
  name: "Paula",
  mission: "Finds waste in Dan's processes and proposes improvements.",
  kind: "intelligent" as const,
  language: ["de" as const],
  priority: "normal" as const,
  look: { body: "#aabbcc", accent: "#112233", hat: "cap" as const },
  home: "library" as const,
  triggers: [{ type: "schedule" as const, days: ["mon" as const], time: "09:00" }],
  permissions: ["read_tasks" as const, "propose_comment" as const],
  auto_approve: ["comment" as const, "draft_task" as const],
};

describe("agent authoring", () => {
  it("makes stable ids and slugs (umlauts, ß, spaces)", () => {
    expect(slug("Prozess-Berater für Größe")).toBe("prozess-berater-fur-grosse");
    expect(agentIdFor("acme", "Process Consultant")).toBe("acme-process-consultant");
    expect(() => agentIdFor("acme", "!!!")).toThrow();
  });

  it("rejects unsafe role names (they become vault folders)", () => {
    expect(agentInputSchema.safeParse({ ...base, role: "a/b" }).success).toBe(false);
    expect(agentInputSchema.safeParse({ ...base, role: "Review [x]" }).success).toBe(false);
    expect(agentInputSchema.safeParse(base).success).toBe(true);
  });

  it("is always callable and only auto-approves permitted actions", () => {
    expect(normaliseTriggers([{ type: "on_call" }, { type: "before_event", minutes: 5, match: "x" }])).toEqual([
      { type: "before_event", minutes: 5, match: "x" },
      { type: "on_call" },
    ]);
    expect(effectiveAutoApprove(["propose_comment"], ["comment", "draft_task"])).toEqual(["comment"]);
  });

  it("builds a profile the registry accepts, at the right path", () => {
    const input = agentInputSchema.parse(base);
    const note = parseNote(buildProfileNote(input, { agentId: "acme-process-consultant", companyName: "ACME", teamName: "Core" }));
    const profile = agentProfileSchema.parse(note.data);
    expect(profile).toMatchObject({ id: "acme-process-consultant", model: "claude-opus-5-5", introduced: false, auto_approve: ["comment"] });
    expect(profile.triggers.at(-1)).toEqual({ type: "on_call" });
    expect(note.body).toContain("## Mission");
    expect(classifyVaultPath("Companies/ACME/Agents/Process Consultant/Process Consultant.md")).toMatchObject({ kind: "agent" });
    expect(classifyVaultPath("Companies/ACME/Archive/Process Consultant/Process Consultant.md")).toBeNull();
  });

  it("writes open questions as 'to confirm' lines", () => {
    expect(buildContextNote("ACME", "", ["Which list?"])).toContain("- *to confirm:* Which list?");
  });

  it("copies a profile without company context, introduction or auto-approve", () => {
    const copied = copiedProfileData({ id: "acme-x", company: "ACME", team: "Core", introduced: true, auto_approve: ["comment"], role: "X" }, { agentId: "medawi-x", companyName: "Medawi", teamName: "CI" });
    expect(copied).toMatchObject({ id: "medawi-x", company: "Medawi", team: "CI", introduced: false, auto_approve: [], role: "X" });
  });
});
