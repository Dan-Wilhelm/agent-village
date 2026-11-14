"use server";

import { revalidatePath } from "next/cache";

import { dispatch } from "@/agents/dispatch";
import { loadRegistry, markIntroduced, renameAgent } from "@/agents/registry";
import { readVaultFile, writeVaultFile } from "@/integrations/vault/github";
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
  if (t.type === "schedule") {
    const days = t.days ?? [];
    const label =
      days.join(",") === "mon,tue,wed,thu,fri" ? "weekdays" : days.length === 7 ? "daily" : days.map((d) => d[0].toUpperCase() + d.slice(1)).join(", ");
    return `${label} at ${[t.time].flat().join(", ")}`;
  }
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

/** "I want to …" → best matching agents (ids from the roster only). */
export async function dispatchRequest(text: string) {
  await requireOwnerAction();
  try {
    return { ok: true as const, candidates: await dispatch(String(text)) };
  } catch {
    return { ok: false as const, candidates: [], message: "Could not find the right agent right now." };
  }
}

/**
 * "Decide later": stores ONLY the owner's own words from a conversation as an
 * inbox note in the company's vault folder (no ClickUp content, no agent output).
 */
export async function saveFeedbackForLater(agentId: string, ownerNotes: string[]) {
  await requireOwnerAction();
  const registry = await loadRegistry();
  const agent = registry.agents.find((a) => a.id === agentId);
  if (!agent) return { ok: false as const, message: "Unknown agent." };
  const notes = ownerNotes.map((n) => String(n).trim()).filter(Boolean).slice(-30).map((n) => n.slice(0, 2000));
  if (!notes.length) return { ok: false as const, message: "Nothing to save." };
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Berlin" });
  const time = new Date().toLocaleTimeString("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });
  const path = `Companies/${agent.company}/Inbox/${day} ${agent.role}.md`;
  const existing = await readVaultFile(path);
  const block = `## ${time} — feedback for ${agent.name} (${agent.role})

${notes.map((n) => `> ${n.replace(/\n/g, "\n> ")}`).join("\n\n")}

- [ ] decide: learn / discard
`;
  const content = existing ? `${existing.content.trimEnd()}

${block}` : `---
type: feedback-inbox
agent: ${agent.id}
---
# Feedback inbox — ${agent.role} (${day})

${block}`;
  await writeVaultFile(path, content, `${agent.role}: feedback saved for later`, existing?.sha);
  await logActivity("owner", "feedback.saved_for_later", { agentId });
  return { ok: true as const, message: "Saved to your inbox in the vault." };
}

export async function markAgentIntroduced(agentId: string) {
  await requireOwnerAction();
  await markIntroduced(String(agentId)).catch(() => undefined);
  return { ok: true as const };
}
