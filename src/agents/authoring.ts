import "server-only";

import { deleteVaultFile, listVaultFiles, readVaultFile, writeVaultFile } from "@/integrations/vault/github";
import { logActivity } from "@/lib/activity";

import {
  agentIdFor,
  buildChangelog,
  buildCompanyNote,
  buildContextNote,
  buildCraftNote,
  buildProfileNote,
  buildTeamNote,
  copiedProfileData,
  effectiveAutoApprove,
  normaliseTriggers,
  profileBody,
  slug,
  MODEL_FOR_KIND,
  type AgentInput,
} from "./authoring-format";
import { parseNote, serializeNote, updateFields } from "./frontmatter";
import { invalidateRegistry, loadRegistry } from "./registry";

/**
 * Creates and changes agents, teams and companies in the vault (settings and
 * playbooks only — never ClickUp content). Every change is one or more commits
 * in the vault repo, so it is reviewable and reversible.
 */

const day = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Berlin" });
const companyDirOf = (path: string) => path.split("/").slice(0, -1).join("/");

async function freshRegistry() {
  invalidateRegistry();
  return loadRegistry({ fresh: true });
}

async function writeNew(path: string, content: string, message: string) {
  if (await readVaultFile(path)) throw new Error(`${path} already exists.`);
  await writeVaultFile(path, content, message);
}

async function setTeamLead(teamPath: string, leadId: string | null) {
  const file = await readVaultFile(teamPath);
  if (!file) return;
  await writeVaultFile(teamPath, updateFields(file.content, { lead: leadId }), `Team lead → ${leadId ?? "none"}`, file.sha);
}

export async function createAgent(input: AgentInput) {
  const registry = await freshRegistry();
  const company = registry.companies.find((c) => c.id === input.company);
  if (!company) throw new Error("Unknown company.");
  const companyDir = companyDirOf(company.path);

  const agentId = agentIdFor(company.id, input.role);
  if (registry.agents.some((a) => a.id === agentId)) throw new Error(`An agent for the role “${input.role}” already exists in ${company.name}.`);
  const dir = `${companyDir}/Agents/${input.role.trim()}`;
  if ((await listVaultFiles()).some((p) => p.startsWith(`${dir}/`))) throw new Error(`The folder for “${input.role}” already exists in the vault.`);

  // Team: existing or new (created together with the agent).
  let teamName: string;
  let teamPath: string;
  if ("existing" in input.team) {
    const team = registry.teams.find((t) => t.company === company.name && t.name === (input.team as { existing: string }).existing);
    if (!team) throw new Error("Unknown team.");
    teamName = team.name;
    teamPath = team.path;
  } else {
    const t = input.team.create;
    if (registry.teams.some((x) => x.company === company.name && x.name.toLowerCase() === t.name.toLowerCase())) throw new Error(`Team “${t.name}” already exists.`);
    teamName = t.name.trim();
    teamPath = `${companyDir}/Teams/${teamName}/${teamName}.md`;
    await writeNew(teamPath, buildTeamNote({ id: `${company.id}-${slug(teamName)}`, name: teamName, company: company.name, lead: null, mission: t.mission }), `New team ${teamName}`);
  }

  await writeNew(`${dir}/${input.role.trim()}.md`, buildProfileNote(input, { agentId, companyName: company.name, teamName }), `New agent ${input.name} (${input.role})`);
  await writeNew(`${dir}/Craft.md`, buildCraftNote(input.role, input.craft), `${input.role}: starting craft`);
  await writeNew(`${dir}/Context.md`, buildContextNote(company.name, input.context, input.to_confirm), `${input.role}: starting context`);
  await writeNew(`${dir}/Changelog.md`, buildChangelog(day(), "created in the village wizard; points marked *to confirm* are checked with Dan in the introduction."), `${input.role}: changelog`);
  if (input.kind === "lead") await setTeamLead(teamPath, agentId);

  invalidateRegistry();
  await logActivity("owner", "agent.created", { agentId, kind: input.kind, autoApprove: effectiveAutoApprove(input.permissions, input.auto_approve) });
  return { agentId };
}

/** Changes settings + mission of an existing agent (role, company and team stay; folders are named by role). */
export async function updateAgent(agentId: string, input: AgentInput) {
  const registry = await freshRegistry();
  const agent = registry.agents.find((a) => a.id === agentId);
  if (!agent) throw new Error("Unknown agent.");
  const file = await readVaultFile(agent.path);
  if (!file) throw new Error("Agent profile not found.");
  const note = parseNote(file.content);
  const data = {
    ...note.data,
    name: input.name.trim(),
    kind: input.kind,
    model: MODEL_FOR_KIND[input.kind],
    language: input.language,
    priority: input.priority,
    look: input.look,
    home: input.home,
    triggers: normaliseTriggers(input.triggers),
    permissions: input.permissions,
    auto_approve: effectiveAutoApprove(input.permissions, input.auto_approve),
  };
  // Keep everything after the Routing section (e.g. notes Dan added in Obsidian).
  const rest = note.body.split(/\n## Routing\n[\s\S]*?(?=\n## |\s*$)/)[1] ?? "";
  const body = `\n${profileBody(agent.role, input.mission, input.routing)}${rest.trim() ? `\n${rest.trim()}\n` : ""}`;
  await writeVaultFile(agent.path, serializeNote({ data, body }), `${agent.role}: settings changed`, file.sha);

  const team = registry.teams.find((t) => t.company === agent.company && t.name === agent.team);
  if (team) {
    if (input.kind === "lead" && team.lead !== agentId) await setTeamLead(team.path, agentId);
    if (input.kind !== "lead" && team.lead === agentId) await setTeamLead(team.path, null);
  }
  invalidateRegistry();
  await logActivity("owner", "agent.updated", { agentId, autoApprove: data.auto_approve });
  return { agentId };
}

/** Moves the agent's folder to Companies/<C>/Archive/ (out of the village, still in the vault + git history). */
export async function archiveAgent(agentId: string) {
  const registry = await freshRegistry();
  const agent = registry.agents.find((a) => a.id === agentId);
  if (!agent) throw new Error("Unknown agent.");
  const dir = companyDirOf(agent.path); // …/Agents/<Role>
  const companyDir = dir.split("/").slice(0, -2).join("/");
  const target = `${companyDir}/Archive/${agent.role} (${day()})`;
  const files = (await listVaultFiles()).filter((p) => p.startsWith(`${dir}/`));
  for (const path of files) {
    const file = await readVaultFile(path);
    if (!file) continue;
    await writeVaultFile(`${target}/${path.slice(dir.length + 1)}`, file.content, `Archive ${agent.role}`);
    await deleteVaultFile(path, `Archive ${agent.role}`, file.sha);
  }
  const team = registry.teams.find((t) => t.company === agent.company && t.name === agent.team);
  if (team?.lead === agentId) await setTeamLead(team.path, null);
  invalidateRegistry();
  await logActivity("owner", "agent.archived", { agentId });
  return { archivedTo: target };
}

export async function createCompany(name: string) {
  const clean = name.trim();
  if (!/^[^/\\:*?"<>|#^[\]{}]{2,40}$/.test(clean)) throw new Error("Please use 2–40 characters without special characters.");
  const registry = await freshRegistry();
  const id = slug(clean);
  if (!id || registry.companies.some((c) => c.id === id || c.name.toLowerCase() === clean.toLowerCase())) throw new Error(`Company “${clean}” already exists.`);
  await writeNew(`Companies/${clean}/${clean}.md`, buildCompanyNote({ id, name: clean, draftsList: "Drafts – pending approval" }), `New company ${clean}`);
  invalidateRegistry();
  await logActivity("owner", "company.created", { companyId: id });
  return { companyId: id, name: clean };
}

export async function createTeam(companyId: string, name: string, mission: string) {
  const registry = await freshRegistry();
  const company = registry.companies.find((c) => c.id === companyId);
  if (!company) throw new Error("Unknown company.");
  const clean = name.trim();
  if (!/^[^/\\:*?"<>|#^[\]{}]{2,60}$/.test(clean)) throw new Error("Please use 2–60 characters without special characters.");
  if (registry.teams.some((t) => t.company === company.name && t.name.toLowerCase() === clean.toLowerCase())) throw new Error(`Team “${clean}” already exists.`);
  const path = `${companyDirOf(company.path)}/Teams/${clean}/${clean}.md`;
  await writeNew(path, buildTeamNote({ id: `${company.id}-${slug(clean)}`, name: clean, company: company.name, lead: null, mission }), `New team ${clean}`);
  invalidateRegistry();
  await logActivity("owner", "team.created", { companyId });
  return { team: clean };
}

/**
 * Copies a team (structure + each agent's CRAFT) into another company. Company
 * context is NOT copied: the copies introduce themselves there and learn it fresh.
 */
export async function copyTeam(teamId: string, targetCompanyId: string) {
  const registry = await freshRegistry();
  const team = registry.teams.find((t) => t.id === teamId);
  if (!team) throw new Error("Unknown team.");
  const target = registry.companies.find((c) => c.id === targetCompanyId);
  if (!target) throw new Error("Unknown target company.");
  if (target.name === team.company) throw new Error("Pick another company — the team already lives here.");
  if (registry.teams.some((t) => t.company === target.name && t.name.toLowerCase() === team.name.toLowerCase())) {
    throw new Error(`${target.name} already has a team “${team.name}”.`);
  }
  const targetDir = companyDirOf(target.path);
  const members = registry.agents.filter((a) => a.company === team.company && a.team === team.name);
  const idMap = new Map(members.map((a) => [a.id, agentIdFor(target.id, a.role)]));
  const taken = members.filter((a) => registry.agents.some((x) => x.id === idMap.get(a.id)));
  if (taken.length) throw new Error(`${target.name} already has agents for: ${taken.map((a) => a.role).join(", ")}.`);

  const teamFile = await readVaultFile(team.path);
  const mission = teamFile ? parseNote(teamFile.content).body.replace(/^\s*# .*\n/, "").trim() : "";
  await writeNew(
    `${targetDir}/Teams/${team.name}/${team.name}.md`,
    buildTeamNote({ id: `${target.id}-${slug(team.name)}`, name: team.name, company: target.name, lead: team.lead ? (idMap.get(team.lead) ?? null) : null, mission }),
    `Copy team ${team.name} from ${team.company}`,
  );

  const copied: string[] = [];
  for (const a of members) {
    const srcDir = companyDirOf(a.path);
    const dstDir = `${targetDir}/Agents/${a.role}`;
    const profile = await readVaultFile(a.path);
    if (!profile) continue;
    const note = parseNote(profile.content);
    const data = copiedProfileData(note.data, { agentId: idMap.get(a.id)!, companyName: target.name, teamName: team.name });
    await writeNew(`${dstDir}/${a.role}.md`, serializeNote({ data, body: note.body }), `Copy ${a.role} to ${target.name}`);
    const craft = await readVaultFile(`${srcDir}/Craft.md`);
    await writeNew(`${dstDir}/Craft.md`, craft?.content ?? buildCraftNote(a.role, ""), `${a.role}: craft copied`);
    await writeNew(`${dstDir}/Context.md`, buildContextNote(target.name, "", ["Which lists, statuses and fields does this job use here?", "Language and naming conventions in this company?"]), `${a.role}: fresh context`);
    await writeNew(`${dstDir}/Changelog.md`, buildChangelog(day(), `copied from ${team.company} (team ${team.name}): craft taken over, company context starts fresh.`), `${a.role}: changelog`);
    copied.push(idMap.get(a.id)!);
  }
  invalidateRegistry();
  await logActivity("owner", "team.copied", { teamId, targetCompanyId, agents: copied.length });
  return { copied };
}
