"use server";

import { desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { archiveAgent, copyTeam, createAgent, createCompany, createTeam, updateAgent } from "@/agents/authoring";
import { agentInputSchema, type AgentInput } from "@/agents/authoring-format";
import { suggestAgent } from "@/agents/draft-agent";
import { loadRegistry } from "@/agents/registry";
import { getDb } from "@/db";
import { activityLog } from "@/db/schema";
import { getClickUpAccount } from "@/integrations/clickup/account";
import { requireOwnerAction } from "@/lib/auth/require-owner";

/** Owner-only actions behind the agent wizard, teams and the activity log. */

type Result<T> = ({ ok: true } & T) | { ok: false; message: string };
const fail = (err: unknown, fallback: string) => ({ ok: false as const, message: err instanceof Error ? err.message : fallback });

/** Companies (with connection state) and teams for the wizard. */
export async function getWizardOptions() {
  await requireOwnerAction();
  const [registry, account] = await Promise.all([loadRegistry({ fresh: true }), getClickUpAccount()]);
  return {
    companies: registry.companies.map((c) => ({
      id: c.id,
      name: c.name,
      connected: Boolean(c.clickup_team_id && account?.teamId === c.clickup_team_id),
      hasMissionControl: Boolean(c.mission_control_user_id),
    })),
    teams: registry.teams.map((t) => ({ id: t.id, name: t.name, company: t.company, lead: t.lead ?? null })),
  };
}

/** Current settings of an agent, in wizard form. */
export async function getAgentForEdit(agentId: string): Promise<Result<{ input: AgentInput }>> {
  await requireOwnerAction();
  const registry = await loadRegistry({ fresh: true });
  const a = registry.agents.find((x) => x.id === String(agentId));
  if (!a) return { ok: false, message: "Unknown agent." };
  const company = registry.companies.find((c) => c.name === a.company);
  const section = (title: string) => a.description.match(new RegExp(`## ${title}\\n([\\s\\S]*?)(?=\\n## |$)`))?.[1]?.trim() ?? "";
  return {
    ok: true,
    input: {
      company: company?.id ?? "",
      team: { existing: a.team },
      role: a.role,
      name: a.name,
      mission: section("Mission") || a.description.slice(0, 500),
      routing: section("Routing"),
      craft: "",
      context: "",
      to_confirm: [],
      kind: a.kind,
      language: a.language,
      priority: a.priority,
      look: a.look,
      home: a.home,
      triggers: a.triggers,
      permissions: a.permissions,
      auto_approve: a.auto_approve,
    },
  };
}

export async function suggestAgentAction(description: string, companyId: string) {
  await requireOwnerAction();
  try {
    return { ok: true as const, suggestion: await suggestAgent(String(description), String(companyId)) };
  } catch (err) {
    return fail(err, "No suggestion right now.");
  }
}

export async function createAgentAction(raw: unknown): Promise<Result<{ agentId: string }>> {
  await requireOwnerAction();
  const parsed = agentInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  try {
    const r = await createAgent(parsed.data);
    revalidatePath("/");
    return { ok: true, agentId: r.agentId };
  } catch (err) {
    return fail(err, "Could not create the agent.");
  }
}

export async function updateAgentAction(agentId: string, raw: unknown): Promise<Result<{ agentId: string }>> {
  await requireOwnerAction();
  const parsed = agentInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  try {
    const r = await updateAgent(String(agentId), parsed.data);
    revalidatePath("/");
    return { ok: true, agentId: r.agentId };
  } catch (err) {
    return fail(err, "Could not save the agent.");
  }
}

export async function archiveAgentAction(agentId: string): Promise<Result<{ archivedTo: string }>> {
  await requireOwnerAction();
  try {
    const r = await archiveAgent(String(agentId));
    revalidatePath("/");
    return { ok: true, archivedTo: r.archivedTo };
  } catch (err) {
    return fail(err, "Could not archive the agent.");
  }
}

export async function createCompanyAction(name: string): Promise<Result<{ companyId: string; name: string }>> {
  await requireOwnerAction();
  try {
    return { ok: true, ...(await createCompany(String(name))) };
  } catch (err) {
    return fail(err, "Could not create the company.");
  }
}

export async function createTeamAction(companyId: string, name: string, mission: string): Promise<Result<{ team: string }>> {
  await requireOwnerAction();
  try {
    return { ok: true, ...(await createTeam(String(companyId), String(name), String(mission ?? ""))) };
  } catch (err) {
    return fail(err, "Could not create the team.");
  }
}

export async function copyTeamAction(teamId: string, targetCompanyId: string): Promise<Result<{ copied: string[] }>> {
  await requireOwnerAction();
  try {
    const r = await copyTeam(String(teamId), String(targetCompanyId));
    revalidatePath("/");
    return { ok: true, copied: r.copied };
  } catch (err) {
    return fail(err, "Could not copy the team.");
  }
}

/** The newest entries of the activity log (no secrets or content are ever logged). */
export async function getActivity(limit = 100) {
  await requireOwnerAction();
  const rows = await getDb()
    .select()
    .from(activityLog)
    .orderBy(desc(activityLog.at))
    .limit(Math.min(Math.max(1, Number(limit) || 100), 300));
  return rows.map((r) => ({ id: r.id, at: r.at.toISOString(), actor: r.actor, action: r.action, details: r.details }));
}
