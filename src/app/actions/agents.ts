"use server";

import { revalidatePath } from "next/cache";

import { loadRegistry, renameAgent } from "@/agents/registry";
import { logActivity } from "@/lib/activity";
import { requireOwnerAction } from "@/lib/auth/require-owner";

export interface RosterAgent {
  id: string;
  name: string;
  role: string;
  company: string;
  team: string;
  kind: "simple" | "intelligent" | "lead";
  priority: "urgent" | "high" | "normal" | "low";
  look: { body: string; accent: string; hat: "none" | "cap" | "beanie" | "bow" | "crown" };
  home: "office" | "hq" | "workshop" | "library" | "training";
  introduced: boolean;
  triggers: string[];
}

function describeTrigger(t: { type: string; days?: string[]; time?: string | string[]; minutes?: number; match?: string }) {
  if (t.type === "schedule") return `${(t.days ?? []).join(", ")} at ${[t.time].flat().join(", ")}`;
  if (t.type === "before_event") return `${t.minutes} min before ${t.match}`;
  return "when called";
}

/** All agents from the vault (settings only — no ClickUp content). */
export async function getRoster() {
  await requireOwnerAction();
  const registry = await loadRegistry();
  return {
    companies: registry.companies.map((c) => ({ id: c.id, name: c.name, environment: c.environment })),
    teams: registry.teams.map((t) => ({ id: t.id, name: t.name, company: t.company, lead: t.lead ?? null })),
    agents: registry.agents.map<RosterAgent>((a) => ({
      id: a.id,
      name: a.name,
      role: a.role,
      company: a.company,
      team: a.team,
      kind: a.kind,
      priority: a.priority,
      look: a.look,
      home: a.home,
      introduced: a.introduced,
      triggers: a.triggers.map(describeTrigger),
    })),
    problems: registry.problems,
  };
}

export async function renameAgentAction(agentId: string, newName: string) {
  await requireOwnerAction();
  try {
    const result = await renameAgent(String(agentId), String(newName));
    await logActivity("owner", "agent.renamed", { agentId: result.id });
    revalidatePath("/");
    return { ok: true as const, name: result.name };
  } catch (err) {
    return { ok: false as const, message: err instanceof Error ? err.message : "Rename failed." };
  }
}
