import { z } from "zod";

/** Settings of companies, teams and agents as stored in vault frontmatter. */

export const BUILDING_IDS = ["office", "hq", "workshop", "library", "training"] as const;
export const PRIORITIES = ["urgent", "high", "normal", "low"] as const;
export const PERMISSIONS = [
  "read_tasks",
  "read_comments",
  "read_calendar",
  "read_meeting_notes",
  "draft_task",
  "propose_comment",
  "propose_change",
  "message_mission_control",
] as const;

/** Write actions the owner may allow an agent to do WITHOUT asking (per agent, default none). */
export const AUTO_APPROVABLE = ["comment", "task_change", "draft_task", "mission_control_message"] as const;
export type AutoApprovable = (typeof AUTO_APPROVABLE)[number];

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "time must be HH:MM");
const day = z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);

export const triggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("schedule"), days: z.array(day).min(1), time: z.union([time, z.array(time).min(1)]) }),
  z.object({ type: z.literal("before_event"), minutes: z.number().int().min(1).max(240), match: z.string().min(1) }),
  z.object({ type: z.literal("on_call") }),
]);
export type Trigger = z.infer<typeof triggerSchema>;

export const agentProfileSchema = z.object({
  type: z.literal("agent"),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/, "id: lowercase letters, digits and dashes"),
  name: z.string().trim().min(1).max(40),
  role: z.string().trim().min(1).max(60),
  company: z.string().min(1),
  team: z.string().min(1),
  kind: z.enum(["simple", "intelligent", "lead"]),
  model: z.enum(["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]),
  language: z.array(z.enum(["de", "en"])).min(1).default(["de", "en"]),
  priority: z.enum(PRIORITIES).default("normal"),
  look: z
    .object({
      body: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      hat: z.enum(["none", "cap", "beanie", "bow", "crown"]),
    })
    .default({ body: "#c89463", accent: "#7a4f30", hat: "none" }),
  home: z.enum(BUILDING_IDS).default("workshop"),
  triggers: z.array(triggerSchema).default([{ type: "on_call" }]),
  permissions: z.array(z.enum(PERMISSIONS)).default(["read_tasks"]),
  introduced: z.boolean().default(false),
  /** Proposal kinds executed immediately (still validated + logged). Empty = always ask. */
  auto_approve: z.array(z.enum(AUTO_APPROVABLE)).default([]),
});
export type AgentProfile = z.infer<typeof agentProfileSchema>;

export const companySchema = z.object({
  type: z.literal("company"),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
  name: z.string().min(1),
  environment: z.enum(["clickup"]),
  drafts_list: z.string().min(1).optional(),
  /** ClickUp member id of "Mission Control" (DM target), if the company has it. */
  mission_control_user_id: z.coerce.string().regex(/^\d+$/).optional(),
  /** Custom fields shown to agents on every task row (defaults to a sensible set). */
  key_fields: z.array(z.string().min(1).max(60)).max(30).optional(),
  /** The ClickUp workspace (team id) this company's agents may use. Unset = no access (strict isolation). */
  clickup_team_id: z.coerce.string().regex(/^\d+$/).optional(),
});
export type CompanyProfile = z.infer<typeof companySchema>;

export const teamSchema = z.object({
  type: z.literal("team"),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
  name: z.string().min(1),
  company: z.string().min(1),
  lead: z.string().nullable().optional(),
});
export type TeamProfile = z.infer<typeof teamSchema>;

/** Where a vault path belongs: Companies/<C>/<C>.md, …/Teams/<T>/<T>.md, …/Agents/<Role>/<Role>.md */
export function classifyVaultPath(path: string):
  | { kind: "company"; company: string }
  | { kind: "team"; company: string; team: string }
  | { kind: "agent"; company: string; role: string }
  | null {
  const p = path.split("/");
  if (p[0] !== "Companies" || p.length < 3) return null;
  if (p.length === 3 && p[2] === `${p[1]}.md`) return { kind: "company", company: p[1] };
  if (p.length === 5 && p[2] === "Teams" && p[4] === `${p[3]}.md`) return { kind: "team", company: p[1], team: p[3] };
  if (p.length === 5 && p[2] === "Agents" && p[4] === `${p[3]}.md`) return { kind: "agent", company: p[1], role: p[3] };
  return null;
}
