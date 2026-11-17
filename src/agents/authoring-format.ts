import { z } from "zod";

import { serializeNote } from "./frontmatter";
import { AUTO_APPROVABLE, BUILDING_IDS, PERMISSIONS, PRIORITIES, triggerSchema } from "./schema";

/**
 * Pure building blocks for creating/editing agents and teams from the wizard.
 * No I/O here (unit-tested); src/agents/authoring.ts writes the results to the vault.
 */

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
/** Folder/file-safe text (vault paths are named by role/team). */
const safeName = z
  .string()
  .trim()
  .min(2)
  .max(60)
  .regex(/^[^/\\:*?"<>|#^[\]{}]+$/, "no special characters like / \\ : * ? \" < > | # ^ [ ]")
  .refine((s) => !s.startsWith("."), "must not start with a dot");

export const KINDS = ["simple", "intelligent", "lead"] as const;
export const MODEL_FOR_KIND = { simple: "claude-haiku-5-5", intelligent: "claude-opus-5-5", lead: "claude-opus-5-5" } as const;

export const agentInputSchema = z.object({
  company: z.string().min(1).max(60),
  /** Existing team name, or a new team (created with the agent). */
  team: z.union([
    z.object({ existing: z.string().min(1).max(60) }),
    z.object({ create: z.object({ name: safeName, mission: z.string().trim().max(2000).default("") }) }),
  ]),
  role: safeName,
  name: z.string().trim().min(1).max(40),
  mission: z.string().trim().min(10).max(3000),
  routing: z.string().trim().max(800).default(""),
  /** How the job is done — becomes the starting Craft.md (transferable). */
  craft: z.string().trim().max(12_000).default(""),
  /** Company-specific facts the agent should start with — becomes Context.md. */
  context: z.string().trim().max(12_000).default(""),
  /** Open questions the agent asks in its introduction ("to confirm"). */
  to_confirm: z.array(z.string().trim().min(3).max(300)).max(12).default([]),
  kind: z.enum(KINDS),
  language: z.array(z.enum(["de", "en"])).min(1),
  priority: z.enum(PRIORITIES),
  look: z.object({ body: hex, accent: hex, hat: z.enum(["none", "cap", "beanie", "bow", "crown"]) }),
  home: z.enum(BUILDING_IDS),
  triggers: z.array(triggerSchema).min(1).max(6),
  permissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length),
  auto_approve: z.array(z.enum(AUTO_APPROVABLE)).max(AUTO_APPROVABLE.length).default([]),
});
export type AgentInput = z.infer<typeof agentInputSchema>;

/** What a write action needs as permission (auto-approve only makes sense with it). */
export const PERMISSION_FOR_AUTO: Record<(typeof AUTO_APPROVABLE)[number], (typeof PERMISSIONS)[number]> = {
  comment: "propose_comment",
  task_change: "propose_change",
  draft_task: "draft_task",
  mission_control_message: "message_mission_control",
};

export function slug(text: string) {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Stable agent id: "<company id>-<role slug>" (rename-safe; the display name can change). */
export function agentIdFor(companyId: string, role: string) {
  const s = slug(role);
  if (!s) throw new Error("The role needs letters or digits.");
  return `${companyId}-${s}`.slice(0, 63);
}

/** Normalises triggers: always callable, no duplicates. */
export function normaliseTriggers(triggers: AgentInput["triggers"]) {
  const out: AgentInput["triggers"] = triggers.filter((t) => t.type !== "on_call");
  out.push({ type: "on_call" });
  return out;
}

/** Auto-approve only for actions the agent may do at all. */
export function effectiveAutoApprove(permissions: AgentInput["permissions"], auto: AgentInput["auto_approve"]) {
  return auto.filter((k) => permissions.includes(PERMISSION_FOR_AUTO[k]));
}

export function profileBody(role: string, mission: string, routing: string) {
  return `# ${role}\n\n## Mission\n${mission.trim()}\n\n## Routing\n${routing.trim() || "(when Dan calls for this role)"}\n`;
}

export function buildProfileNote(input: AgentInput, ids: { agentId: string; companyName: string; teamName: string }) {
  const data = {
    type: "agent",
    id: ids.agentId,
    name: input.name.trim(),
    role: input.role.trim(),
    company: ids.companyName,
    team: ids.teamName,
    kind: input.kind,
    model: MODEL_FOR_KIND[input.kind],
    language: input.language,
    priority: input.priority,
    look: input.look,
    home: input.home,
    triggers: normaliseTriggers(input.triggers),
    permissions: input.permissions,
    introduced: false,
    auto_approve: effectiveAutoApprove(input.permissions, input.auto_approve),
  };
  return serializeNote({ data, body: `\n${profileBody(input.role, input.mission, input.routing)}` });
}

export function buildCraftNote(role: string, craft: string) {
  return `# Craft — ${role}\n\n${craft.trim() || "- (to be learned through training and feedback)"}\n`;
}

export function buildContextNote(companyName: string, context: string, toConfirm: string[]) {
  const confirm = toConfirm.length ? `\n\n## To confirm with Dan (introduction)\n${toConfirm.map((q) => `- *to confirm:* ${q.trim()}`).join("\n")}` : "";
  return `# Context — ${companyName}\n\n${context.trim() || "- (to be learned in this company)"}${confirm}\n`;
}

export function buildChangelog(day: string, line: string) {
  return `# Changelog\n- ${day}: ${line}\n`;
}

export function buildTeamNote(team: { id: string; name: string; company: string; lead: string | null; mission: string }) {
  return serializeNote({
    data: { type: "team", id: team.id, name: team.name, company: team.company, lead: team.lead },
    body: `\n# ${team.name}\n\n${team.mission.trim() || "(team mission to be described)"}\n`,
  });
}

export function buildCompanyNote(company: { id: string; name: string; draftsList: string }) {
  return serializeNote({
    data: { type: "company", id: company.id, name: company.name, environment: "clickup", drafts_list: company.draftsList },
    body: `\n# ${company.name}\n\nCompany context for every agent working in the ${company.name} environment.\n\n## Discretion rules (non-negotiable)\n- Never mention agents, AI, automation or any "village" anywhere in this company's tools.\n- Everything is written as Dan. No signatures, no "via …".\n- Read work data live; never copy task text, comments or names into notes. Write lessons in general form and link to the task instead.\n- New tasks only as drafts in "${company.draftsList}"; everything else needs Dan's approval.\n\n## Environment\n- Not connected yet: agents of this company have no tool access until its ClickUp workspace is connected (\`clickup_team_id\`).\n\n## Processes & conventions\n- (to be learned through introductions and training)\n`,
  });
}

/**
 * Copying an agent profile to another company: the CRAFT travels, the company
 * context does not. Returns the new frontmatter (introduced=false, no auto-approve).
 */
export function copiedProfileData(source: Record<string, unknown>, target: { agentId: string; companyName: string; teamName: string }) {
  return {
    ...source,
    id: target.agentId,
    company: target.companyName,
    team: target.teamName,
    introduced: false,
    auto_approve: [],
  };
}
