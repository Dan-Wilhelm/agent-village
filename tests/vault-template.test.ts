import fs from "node:fs";

import { describe, expect, it } from "vitest";

import { parseNote } from "@/agents/frontmatter";
import { classifyVaultPath, companySchema, teamSchema } from "@/agents/schema";

// The starter vault for self-hosters must be accepted by the registry as is.
describe("vault-template", () => {
  const read = (p: string) => parseNote(fs.readFileSync(`vault-template/${p}`, "utf8"));

  it("has a valid company and team at the paths the registry expects", () => {
    expect(classifyVaultPath("Companies/Acme/Acme.md")).toEqual({ kind: "company", company: "Acme" });
    expect(classifyVaultPath("Companies/Acme/Teams/Core/Core.md")).toEqual({ kind: "team", company: "Acme", team: "Core" });
    const company = companySchema.parse(read("Companies/Acme/Acme.md").data);
    expect(company).toMatchObject({ id: "acme", name: "Acme", environment: "clickup" });
    expect(company.clickup_team_id).toBeUndefined(); // not connected until the owner sets it
    expect(teamSchema.parse(read("Companies/Acme/Teams/Core/Core.md").data)).toMatchObject({ company: "Acme", lead: null });
  });
});
