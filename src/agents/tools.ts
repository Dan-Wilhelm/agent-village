import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { clientFor, type ClickUpAccount } from "@/integrations/clickup/account";
import type { ClickUpCustomField } from "@/integrations/clickup/client";
import { apiValueFor, keyFields, matchesFieldFilter } from "@/integrations/clickup/fields";
import { isOpenTask } from "@/integrations/clickup/mapping";
import { fetchUpcomingEvents } from "@/integrations/calendar/feed";
import { figmaClientFor, type FigmaAccount } from "@/integrations/figma/account";
import { summariseNode } from "@/integrations/figma/client";
import { normaliseNodeId, parseFigmaUrl } from "@/integrations/figma/url";
import { listVaultFiles, readVaultFile, writeVaultFile } from "@/integrations/vault/github";

import { assertDiscreet } from "./discretion";
import { findRuleLines } from "./rule-lines";
import type { AgentEntry } from "./registry";
import type { AgentProfile } from "./schema";

/**
 * Tools an agent can use. READ tools run live and return data to the model
 * (nothing is stored). WRITE tools never change anything directly: they return
 * a PROPOSAL that the owner approves in the village (src/agents/execute.ts).
 * The only exception is draft_task, which writes into the private drafts list.
 */

export type ProposalKind =
  | "comment"
  | "task_change"
  | "draft_task"
  | "mission_control_message"
  | "playbook_rule"
  | "meeting_notes"
  | "figma_comment"
  | "rule_change";

/** A tool result with images (e.g. Figma frames the agent should look at). */
export interface ToolOutput {
  text: string;
  images: Array<{ media_type: "image/png" | "image/jpeg"; data: string }>;
}

export interface Proposal {
  id: string;
  kind: ProposalKind;
  agentId: string;
  /** What exactly will happen on approval (validated again on execution). */
  args: Record<string, unknown>;
  /** Short human summary for the panel. */
  summary: string;
  /** Set when the agent was allowed to do this without asking: what happened. */
  auto?: { ok: boolean; message: string };
}

export interface ToolContext {
  agent: AgentEntry;
  account: ClickUpAccount | null;
  missionControlUserId: string | null;
  draftsListName: string;
  /** Custom fields shown on task rows (company setting). */
  keyFields: string[];
  /** Vault folder of the agent's company, e.g. "Companies/ACME". */
  companyDir: string;
  proposals: Proposal[];
  /** Executes a proposal right away (only for kinds in the agent's auto_approve). */
  autoExecute?: (p: Proposal) => Promise<{ ok: boolean; message: string }>;
  /**
   * Set once the conversation contains content written by others (tasks, comments,
   * calendar, docs, replies). From then on nothing runs "without asking": such text
   * could carry injected instructions.
   */
  tainted?: boolean;
  /** Team leads only: ask a member of the team (runs the member's own turn). */
  delegate?: (memberId: string, request: string) => Promise<string>;
  /** How many team requests this turn made (capped). */
  delegations?: number;
  /** Ask another agent of the same company (read-only colleague turn). Not set inside colleague/delegated turns. */
  askColleague?: (colleagueId: string, question: string) => Promise<string>;
  /** Other agents of the same company (id, name, role). */
  colleagues?: Array<{ id: string; name: string; role: string }>;
  colleagueQuestions?: number;
  /** Answering a colleague's question: no writes, no proposals. */
  readOnly?: boolean;
  /** Set by end_conversation: the UI opens the finish dialog after this turn. */
  finishRequested?: boolean;
  /** The Figma account of the agent's company (null = not connected). */
  figma?: FigmaAccount | null;
  /** Members of the lead's team (id, name, role). */
  teamMembers?: Array<{ id: string; name: string; role: string }>;
}

type Permission = AgentProfile["permissions"][number];

interface ToolDef {
  permission: Permission | null; // null = always available
  /** Returns text written by others (prompt-injection risk): disables "without asking" for the rest of the conversation. */
  readsUntrusted?: boolean;
  /** Only for agents of kind "lead". */
  leadOnly?: boolean;
  definition: Anthropic.Tool;
  input: z.ZodTypeAny;
  run: (input: never, ctx: ToolContext) => Promise<string | ToolOutput>;
}

const iso = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "must be an ISO date/time");

function requireAccount(ctx: ToolContext) {
  if (!ctx.account?.teamId || !ctx.account.selectedSpaceIds.length) {
    throw new Error("ClickUp is not connected or no spaces are allowed yet.");
  }
  return ctx.account;
}

function compactTask(
  t: {
    id: string;
    name: string;
    status: { status: string };
    due_date: number | null;
    list: { id: string; name?: string | null };
    assignees?: Array<{ username?: string | null }> | null;
    tags?: Array<{ name: string }> | null;
    url?: string | null;
    date_updated: number | null;
    date_closed?: number | null;
    custom_fields?: ClickUpCustomField[] | null;
    checklists?: Array<{ items?: Array<{ resolved?: boolean | null }> | null }> | null;
  },
  fieldNames?: string[],
) {
  const fields = keyFields(t.custom_fields, fieldNames);
  const checkItems = (t.checklists ?? []).flatMap((c) => c.items ?? []);
  return {
    id: t.id,
    name: t.name,
    status: t.status.status,
    due: t.due_date ? new Date(t.due_date).toISOString() : null,
    list: t.list.name ?? t.list.id,
    assignees: (t.assignees ?? []).map((a) => a.username ?? "?"),
    ...(t.tags?.length ? { tags: t.tags.map((x) => x.name) } : {}),
    ...(Object.keys(fields).length ? { fields } : {}),
    ...(checkItems.length ? { checklist_progress: `${checkItems.filter((i) => i.resolved).length}/${checkItems.length} done` } : {}),
    updated: t.date_updated ? new Date(t.date_updated).toISOString() : null,
    ...(t.date_closed ? { closed: new Date(t.date_closed).toISOString() } : {}),
    url: t.url ?? null,
  };
}

/** Runs async jobs with a small concurrency limit (ClickUp rate limit friendly). */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

async function latestComment(ctx: ToolContext, taskId: string) {
  const { comments } = await clientFor(ctx.account!).getTaskComments(taskId);
  const newest = [...comments].sort((a, b) => (b.date ?? 0) - (a.date ?? 0))[0];
  return newest
    ? { by: newest.user?.username ?? "?", at: newest.date ? new Date(newest.date).toISOString() : null, text: (newest.comment_text ?? "").slice(0, 400) }
    : null;
}

async function liveTask(ctx: ToolContext, taskId: string) {
  const account = requireAccount(ctx);
  const task = await clientFor(account).getTask(taskId);
  if (!account.selectedSpaceIds.includes(task.space.id)) throw new Error("That task is outside the spaces you may use.");
  return task;
}

/** Runs the proposal now if Dan allowed this action type for the agent; returns the tool result text, or null. */
async function maybeAutoExecute(ctx: ToolContext, p: Proposal): Promise<string | null> {
  if (!ctx.autoExecute || !(ctx.agent.auto_approve as string[]).includes(p.kind)) return null;
  if (ctx.tainted) return null; // content from others was read: Dan approves this one himself
  const result = await ctx.autoExecute(p).catch((err: unknown) => ({ ok: false, message: err instanceof Error ? err.message : "Failed." }));
  p.auto = result;
  return result.ok
    ? `Done without asking (Dan allowed this action type for you): ${result.message} Tell Dan briefly what you did.`
    : `You were allowed to do this without asking, but it failed: ${result.message} Nothing was changed. Tell Dan.`;
}

async function newProposal(ctx: ToolContext, kind: ProposalKind, args: Record<string, unknown>, summary: string) {
  const p: Proposal = { id: `p_${crypto.randomUUID().slice(0, 8)}`, kind, agentId: ctx.agent.id, args, summary };
  ctx.proposals.push(p);
  const auto = await maybeAutoExecute(ctx, p);
  if (auto) return auto;
  return `Proposal ${p.id} is now shown to Dan for approval. Nothing has been changed yet. Tell Dan briefly what you proposed and wait for his decision.`;
}

const TOOLS: Record<string, ToolDef> = {
  search_tasks: {
    readsUntrusted: true,
    permission: "read_tasks",
    definition: {
      name: "search_tasks",
      description:
        "Search OPEN tasks live in the allowed ClickUp spaces. Use this whenever you need to know which tasks exist, are due, overdue, in a certain status or in a certain list. Returns compact task rows (id, name, status, due, list, assignees, url). Always use task ids from here when talking about tasks.",
      input_schema: {
        type: "object",
        properties: {
          statuses: { type: "array", items: { type: "string" }, description: "Exact status names, e.g. [\"external review\"]" },
          list_ids: { type: "array", items: { type: "string" }, description: "Restrict to these list ids (see list_structure)" },
          assigned_to_me: { type: "boolean", description: "Only tasks assigned to Dan" },
          due_before: { type: "string", description: "ISO date/time; only tasks due before this" },
          due_after: { type: "string", description: "ISO date/time; only tasks due after this" },
          query: { type: "string", description: "Case-insensitive text that must appear in the task name" },
          field_equals: {
            type: "object",
            additionalProperties: { type: "string" },
            description: "Custom field filters by readable value, e.g. {\"Client Code\": \"NOVA\", \"Format\": \"VID\"}",
          },
          tags: { type: "array", items: { type: "string" }, description: "Only tasks with at least one of these tags" },
          updated_after: { type: "string", description: "ISO date/time; only tasks changed after this (e.g. 'what happened since yesterday')" },
          include_closed: { type: "boolean", description: "Also return closed/done tasks (default false)" },
          with_last_comment: {
            type: "boolean",
            description: "Add each task's newest comment (who, when, text) — use it to see what was last done. Max 40 tasks.",
          },
          limit: { type: "integer", description: "Max rows (default 30, max 80)" },
          count_only: {
            type: "boolean",
            description: "Return exact COUNTS instead of rows (all pages, up to 3000 tasks), grouped by list, status and Client Code. Use this for 'how many …' questions.",
          },
        },
        additionalProperties: false,
      },
    },
    input: z.object({
      statuses: z.array(z.string().max(80)).max(20).optional(),
      list_ids: z.array(z.string().max(40)).max(50).optional(),
      assigned_to_me: z.boolean().optional(),
      due_before: iso.optional(),
      due_after: iso.optional(),
      query: z.string().max(120).optional(),
      field_equals: z.record(z.string().max(60), z.string().max(120)).optional(),
      tags: z.array(z.string().max(60)).max(10).optional(),
      updated_after: iso.optional(),
      include_closed: z.boolean().optional(),
      with_last_comment: z.boolean().optional(),
      limit: z.number().int().min(1).max(80).optional(),
      count_only: z.boolean().optional(),
    }),
    run: async (input: {
      statuses?: string[];
      list_ids?: string[];
      assigned_to_me?: boolean;
      due_before?: string;
      due_after?: string;
      query?: string;
      field_equals?: Record<string, string>;
      tags?: string[];
      updated_after?: string;
      include_closed?: boolean;
      with_last_comment?: boolean;
      limit?: number;
      count_only?: boolean;
    }, ctx) => {
      const account = requireAccount(ctx);
      const client = clientFor(account);
      const limit = input.count_only ? 3000 : (input.limit ?? 30);
      const q = input.query?.toLowerCase();
      const tagSet = input.tags?.map((t) => t.toLowerCase());
      const matched: Array<Parameters<typeof compactTask>[0]> = [];
      // Client-side filters (fields/tags/name) may need more pages.
      const maxPages = input.count_only ? 30 : input.field_equals || tagSet || q ? 10 : 5;
      let capped = false;
      for (let page = 0; page < maxPages && matched.length < limit; page++) {
        const res = await client.getTeamTasks(account.teamId!, {
          spaceIds: account.selectedSpaceIds,
          page,
          statuses: input.statuses,
          listIds: input.list_ids,
          assignees: input.assigned_to_me ? [account.externalUserId] : undefined,
          dueDateLtMs: input.due_before ? Date.parse(input.due_before) : undefined,
          dueDateGtMs: input.due_after ? Date.parse(input.due_after) : undefined,
          dateUpdatedGtMs: input.updated_after ? Date.parse(input.updated_after) : undefined,
          includeClosed: input.include_closed,
        });
        for (const t of res.tasks) {
          if (!account.selectedSpaceIds.includes(t.space.id)) continue; // never trust the API filter alone
          if (!input.include_closed && !isOpenTask(t)) continue;
          if (q && !t.name.toLowerCase().includes(q)) continue;
          if (tagSet && !(t.tags ?? []).some((g) => tagSet.includes(g.name.toLowerCase()))) continue;
          if (input.field_equals && !matchesFieldFilter(t.custom_fields, input.field_equals)) continue;
          matched.push(t);
        }
        if (res.last_page !== false || res.tasks.length === 0) break;
        if (page === maxPages - 1) capped = true;
      }
      if (input.count_only) {
        const tally = (key: (t: (typeof matched)[number]) => string) =>
          Object.fromEntries(
            Object.entries(matched.reduce<Record<string, number>>((acc, t) => ((acc[key(t)] = (acc[key(t)] ?? 0) + 1), acc), {})).sort((a, b) => b[1] - a[1]),
          );
        return JSON.stringify({
          total: matched.length,
          ...(capped ? { note: "More than 3000 matching tasks — the count is a lower bound." } : {}),
          by_list: tally((t) => t.list.name ?? t.list.id),
          by_status: tally((t) => t.status.status),
          by_client: tally((t) => String(keyFields(t.custom_fields, ["Client Code"])["Client Code"] ?? "(none)")),
        });
      }
      const rows = matched.slice(0, limit).map((t) => compactTask(t, ctx.keyFields));
      if (input.with_last_comment && ctx.agent.permissions.includes("read_comments")) {
        const withComments = await mapLimit(rows.slice(0, 40), 6, async (r) => ({ ...r, last_comment: await latestComment(ctx, r.id).catch(() => null) }));
        return JSON.stringify({ count: rows.length, tasks: [...withComments, ...rows.slice(40)] });
      }
      return JSON.stringify({ count: rows.length, tasks: rows });
    },
  },

  list_structure: {
    permission: "read_tasks",
    definition: {
      name: "list_structure",
      description:
        "Live overview of the allowed ClickUp spaces with their folders, lists (ids + names) and the statuses used in each space. Call this before filtering by list or status if you don't know the exact names.",
      input_schema: { type: "object", properties: {}, additionalProperties: false },
    },
    input: z.object({}),
    run: async (_input: Record<string, never>, ctx) => {
      const account = requireAccount(ctx);
      const client = clientFor(account);
      const { spaces } = await client.getSpaces(account.teamId!);
      const allowed = spaces.filter((s) => account.selectedSpaceIds.includes(s.id));
      const out = await Promise.all(
        allowed.map(async (s) => {
          const [{ folders }, { lists }] = await Promise.all([client.getFolders(s.id), client.getFolderlessLists(s.id)]);
          return {
            space: s.name,
            statuses: (s.statuses ?? []).map((x) => x.status),
            folders: folders.map((f) => ({ folder: f.name, lists: (f.lists ?? []).map((l) => ({ id: l.id, name: l.name })) })),
            lists: lists.map((l) => ({ id: l.id, name: l.name })),
          };
        }),
      );
      return JSON.stringify(out);
    },
  },

  get_task: {
    readsUntrusted: true,
    permission: "read_tasks",
    definition: {
      name: "get_task",
      description:
        "Read one task live: status, due date, assignees, description, checklists with each item's done/open state, and (if allowed) the latest comments. Use it to see what was last done on a task — Dan documents progress in comments and checklists.",
      input_schema: {
        type: "object",
        properties: {
          task_id: { type: "string" },
          with_comments: { type: "boolean", description: "Include the latest comments (default true)" },
        },
        required: ["task_id"],
        additionalProperties: false,
      },
    },
    input: z.object({ task_id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/), with_comments: z.boolean().optional() }),
    run: async (input: { task_id: string; with_comments?: boolean }, ctx) => {
      const task = await liveTask(ctx, input.task_id);
      const canComments = ctx.agent.permissions.includes("read_comments") && input.with_comments !== false;
      const comments = canComments ? (await clientFor(ctx.account!).getTaskComments(task.id)).comments.slice(0, 8) : [];
      return JSON.stringify({
        ...compactTask(task, ctx.keyFields),
        description: (task.markdown_description ?? task.text_content ?? "").slice(0, 6000),
        checklists: (task.checklists ?? []).map((cl) => ({
          name: cl.name ?? "Checklist",
          done: (cl.items ?? []).filter((i) => i.resolved).length,
          total: (cl.items ?? []).length,
          items: (cl.items ?? []).slice(0, 60).map((i) => ({ item: (i.name ?? "").slice(0, 200), done: Boolean(i.resolved), ...(i.parent ? { sub_item: true } : {}) })),
        })),
        comments: comments.map((c) => ({
          by: c.user?.username ?? "?",
          at: c.date ? new Date(c.date).toISOString() : null,
          text: (c.comment_text ?? "").slice(0, 1500),
        })),
      });
    },
  },

  get_calendar: {
    readsUntrusted: true,
    permission: "read_calendar",
    definition: {
      name: "get_calendar",
      description: "Dan's upcoming calendar events, live (title, start, end, attendees, short description). Use for meeting preparation.",
      input_schema: {
        type: "object",
        properties: { hours: { type: "integer", description: "Look-ahead window in hours (1–72, default 24)" } },
        additionalProperties: false,
      },
    },
    input: z.object({ hours: z.number().int().min(1).max(72).optional() }),
    run: async (input: { hours?: number }) => JSON.stringify(await fetchUpcomingEvents(input.hours ?? 24)),
  },

  read_mission_control_replies: {
    readsUntrusted: true,
    permission: "message_mission_control",
    definition: {
      name: "read_mission_control_replies",
      description: "Read the latest messages in Dan's direct-message chat with Mission Control (e.g. to pick up an answer to a request).",
      input_schema: { type: "object", properties: {}, additionalProperties: false },
    },
    input: z.object({}),
    run: async (_input: Record<string, never>, ctx) => {
      const account = requireAccount(ctx);
      if (!ctx.missionControlUserId) throw new Error("Mission Control is not configured.");
      const client = clientFor(account);
      const dm = await client.openDirectMessage(account.teamId!, ctx.missionControlUserId);
      const { data } = await client.getChatMessages(account.teamId!, dm.data.id, 10);
      return JSON.stringify(
        data.map((m) => ({
          from: m.user_id === account.externalUserId ? "Dan" : "Mission Control",
          at: m.date ? new Date(m.date).toISOString() : null,
          text: (m.content ?? "").slice(0, 3000),
        })),
      );
    },
  },

  propose_comment: {
    permission: "propose_comment",
    definition: {
      name: "propose_comment",
      description:
        "Propose a comment on a task, written AS DAN (his voice, his language for that task). Use it to document what was done (e.g. a follow-up). Never mention agents, AI, automation or the village. Dan approves before it is posted.",
      input_schema: {
        type: "object",
        properties: { task_id: { type: "string" }, text: { type: "string" } },
        required: ["task_id", "text"],
        additionalProperties: false,
      },
    },
    input: z.object({ task_id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/), text: z.string().min(1).max(4000) }),
    run: async (input: { task_id: string; text: string }, ctx) => {
      assertDiscreet(input.text);
      const task = await liveTask(ctx, input.task_id);
      return newProposal(ctx, "comment", { task_id: task.id, text: input.text }, `Comment on “${task.name}”`);
    },
  },

  propose_task_change: {
    permission: "propose_change",
    definition: {
      name: "propose_task_change",
      description: "Propose changing a task's status, due date or priority. Dan approves before anything changes.",
      input_schema: {
        type: "object",
        properties: {
          task_id: { type: "string" },
          status: { type: "string", description: "Exact status name" },
          due_date: { type: "string", description: "ISO date/time, or empty string to clear" },
          priority: { type: "integer", description: "1 urgent, 2 high, 3 normal, 4 low" },
          reason: { type: "string", description: "One sentence why" },
        },
        required: ["task_id", "reason"],
        additionalProperties: false,
      },
    },
    input: z.object({
      task_id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
      status: z.string().max(80).optional(),
      due_date: z.union([iso, z.literal("")]).optional(),
      priority: z.number().int().min(1).max(4).optional(),
      reason: z.string().max(400),
    }),
    run: async (input: { task_id: string; status?: string; due_date?: string; priority?: number; reason: string }, ctx) => {
      const task = await liveTask(ctx, input.task_id);
      const parts = [
        input.status ? `status → ${input.status}` : null,
        input.due_date !== undefined ? `due → ${input.due_date || "none"}` : null,
        input.priority ? `priority → ${input.priority}` : null,
      ].filter(Boolean);
      if (!parts.length) throw new Error("Nothing to change.");
      const { reason: _reason, ...args } = input;
      void _reason;
      return newProposal(ctx, "task_change", args, `“${task.name}”: ${parts.join(", ")}`);
    },
  },

  list_task_templates: {
    permission: "draft_task",
    definition: {
      name: "list_task_templates",
      description: "List the workspace's ClickUp task templates (id + name). Use a template id with draft_task so the new task gets the template's structure, checklists and subtasks.",
      input_schema: {
        type: "object",
        properties: { query: { type: "string", description: "Optional text the template name must contain" } },
        additionalProperties: false,
      },
    },
    input: z.object({ query: z.string().max(80).optional() }),
    run: async (input: { query?: string }, ctx) => {
      const account = requireAccount(ctx);
      const client = clientFor(account);
      const all: Array<{ id: string; name: string }> = [];
      for (let page = 0; page < 3; page++) {
        const { templates } = await client.getTaskTemplates(account.teamId!, page);
        all.push(...templates);
        if (templates.length < 100) break;
      }
      const q = input.query?.toLowerCase();
      return JSON.stringify(all.filter((t) => !q || t.name.toLowerCase().includes(q)).map((t) => ({ id: t.id, name: t.name.trim() })));
    },
  },

  draft_task: {
    permission: "draft_task",
    definition: {
      name: "draft_task",
      description: [
        "Create or revise a NEW task as a draft in Dan's private drafts list; Dan approves it in the village, then it is MOVED into the target list (status + custom fields applied).",
        "• New plain task: target_list_id + name + description_markdown.",
        "• From a ClickUp template: target_list_id + name + template_id (no description yet). The result shows the template's description — fill it in and call draft_task again with draft_task_id.",
        "• Revise an existing draft: draft_task_id + what changes. target_list_id, status and fields from earlier in this conversation are kept unless you pass new ones — after a page reload pass them again.",
        "checklists = checklists to add to the new task, e.g. [{\"name\": \"Build\", \"items\": [\"Hero section\", \"Quiz logic\"]}]; on a revision they replace the draft's checklists with the same names.",
        "fields = custom fields by readable value, e.g. {\"Client Code\": \"NOVA\", \"Format\": \"IMG\", \"Google Drive\": \"https://…\"}; they are checked against the target list now and set on approval.",
        "Write as Dan would (no mention of agents/AI).",
      ].join("\n"),
      input_schema: {
        type: "object",
        properties: {
          target_list_id: { type: "string" },
          name: { type: "string" },
          description_markdown: { type: "string" },
          template_id: { type: "string", description: "ClickUp task template id (from list_task_templates), e.g. t-86cb24gyz" },
          draft_task_id: { type: "string", description: "Revise this existing draft instead of creating a new one" },
          status: { type: "string", description: "Status in the target list after approval (exact name), e.g. \"briefing\"" },
          fields: { type: "object", additionalProperties: { type: "string" } },
          checklists: {
            type: "array",
            items: {
              type: "object",
              properties: { name: { type: "string" }, items: { type: "array", items: { type: "string" } } },
              required: ["name", "items"],
              additionalProperties: false,
            },
          },
          due_date: { type: "string", description: "ISO date/time (optional)" },
          priority: { type: "integer", description: "1 urgent, 2 high, 3 normal, 4 low (optional)" },
        },
        additionalProperties: false,
      },
    },
    input: z.object({
      target_list_id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/).optional(),
      name: z.string().min(1).max(250).optional(),
      description_markdown: z.string().max(20_000).optional(),
      template_id: z.string().regex(/^t-[A-Za-z0-9_-]{1,40}$/).optional(),
      draft_task_id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/).optional(),
      status: z.string().max(80).optional(),
      fields: z.record(z.string().max(60), z.string().max(2000)).optional(),
      checklists: z
        .array(z.object({ name: z.string().trim().min(1).max(120), items: z.array(z.string().trim().min(1).max(300)).min(1).max(50) }))
        .max(10)
        .optional(),
      due_date: iso.optional(),
      priority: z.number().int().min(1).max(4).optional(),
    }),
    run: async (
      raw: {
        checklists?: Array<{ name: string; items: string[] }>;
        target_list_id?: string;
        name?: string;
        description_markdown?: string;
        template_id?: string;
        draft_task_id?: string;
        status?: string;
        fields?: Record<string, string>;
        due_date?: string;
        priority?: number;
      },
      ctx,
    ) => {
      // Revising a draft keeps target/status/fields from its earlier card in this conversation.
      const prev = raw.draft_task_id ? ctx.proposals.find((x) => x.id === `p_d_${raw.draft_task_id}`)?.args : undefined;
      const input = {
        ...raw,
        target_list_id: raw.target_list_id ?? (prev?.target_list_id as string | undefined),
        status: raw.status ?? (prev?.status as string | undefined),
        fields: raw.fields ?? (prev?.fields as Record<string, string> | undefined),
      };
      if (!input.target_list_id) throw new Error("target_list_id is needed (the list the task should go to).");
      const targetListId = input.target_list_id;
      assertDiscreet(
        `${input.name ?? ""}\n${input.description_markdown ?? ""}\n${Object.values(input.fields ?? {}).join("\n")}\n${(input.checklists ?? []).map((c) => `${c.name}\n${c.items.join("\n")}`).join("\n")}`,
      );
      const account = requireAccount(ctx);
      const client = clientFor(account);

      // Check target list, status and fields NOW so mistakes come back to the agent, not to Dan.
      const target = await client.getList(targetListId);
      if (!account.selectedSpaceIds.includes(target.space.id)) throw new Error("The target list is outside the allowed spaces.");
      if (input.status && !(target.statuses ?? []).some((st) => st.status.toLowerCase() === input.status!.toLowerCase())) {
        throw new Error(`Status “${input.status}” does not exist in ${target.name}. Statuses: ${(target.statuses ?? []).map((st) => st.status).join(", ")}`);
      }
      if (input.fields && Object.keys(input.fields).length) {
        const { fields } = await client.getListFields(target.id);
        for (const [name, value] of Object.entries(input.fields)) {
          const def = fields.find((f) => f.name.toLowerCase() === name.toLowerCase());
          if (!def) throw new Error(`${target.name} has no custom field “${name}”.`);
          apiValueFor(def, value); // throws a helpful message for wrong options/values
        }
      }

      const draftsListId = await findDraftsList(ctx);
      const timing = {
        ...(input.due_date ? { due_date: Date.parse(input.due_date), due_date_time: input.due_date.includes("T") } : {}),
        ...(input.priority ? { priority: input.priority } : {}),
      };
      let draftId: string;
      let note = "";
      if (input.draft_task_id) {
        const existing = await client.getTask(input.draft_task_id);
        if (existing.list.id !== draftsListId) throw new Error("draft_task_id must be a task in the drafts list.");
        await client.updateTask(existing.id, {
          ...(input.name ? { name: input.name } : {}),
          ...(input.description_markdown !== undefined ? { markdown_description: input.description_markdown } : {}),
          ...timing,
        });
        draftId = existing.id;
      } else if (input.template_id) {
        if (!input.name) throw new Error("A name is needed for a new task.");
        const created = await client.createTaskFromTemplate(draftsListId, input.template_id, input.name);
        draftId = created.id;
        if (input.description_markdown) await client.updateTask(draftId, { markdown_description: input.description_markdown, ...timing });
        else {
          if (Object.keys(timing).length) await client.updateTask(draftId, timing);
          const fresh = await client.getTask(draftId);
          note = `\nThe draft was created from the template. Its description currently is:\n---\n${(fresh.markdown_description ?? fresh.text_content ?? "(empty)").slice(0, 6000)}\n---\nFill in the template (keep its structure) and call draft_task again with draft_task_id="${draftId}".`;
        }
      } else {
        if (!input.name || input.description_markdown === undefined) throw new Error("A new task needs a name and description_markdown (or a template_id).");
        const created = await client.createTask(draftsListId, { name: input.name, markdown_content: input.description_markdown, ...timing });
        draftId = created.id;
      }

      // Checklists live on the draft itself (they move with it on approval).
      if (input.checklists?.length) {
        const current = await client.getTask(draftId);
        const names = new Set(input.checklists.map((c) => c.name.toLowerCase()));
        for (const cl of current.checklists ?? []) if (cl.name && names.has(cl.name.toLowerCase())) await client.deleteChecklist(cl.id);
        for (const cl of input.checklists) {
          const { checklist } = await client.createChecklist(draftId, cl.name);
          for (const item of cl.items) await client.createChecklistItem(checklist.id, item);
        }
      }
      const draft = await client.getTask(draftId);
      const args = {
        draft_task_id: draftId,
        target_list_id: target.id,
        ...(input.status ? { status: input.status } : {}),
        ...(input.fields && Object.keys(input.fields).length ? { fields: input.fields } : {}),
      };
      // One approval card per draft: revising a draft replaces its card (same proposal id).
      const proposal: Proposal = { id: `p_d_${draftId}`, kind: "draft_task", agentId: ctx.agent.id, args, summary: `New task “${draft.name}” → ${target.name}` };
      const idx = ctx.proposals.findIndex((x) => x.id === proposal.id);
      if (idx >= 0) ctx.proposals[idx] = proposal;
      else ctx.proposals.push(proposal);
      // A template draft is only executed automatically once it is filled in (no pending template note).
      if (!note) {
        const auto = await maybeAutoExecute(ctx, proposal);
        if (auto) return auto;
      }
      return `Draft ${draftId} is in Dan's drafts list and shown to him for approval (target: ${target.name}). Nothing in the target list has changed yet.${note}`;
    },
  },

  propose_mission_control_message: {
    permission: "message_mission_control",
    definition: {
      name: "propose_mission_control_message",
      description:
        "Propose a direct message from Dan to Mission Control (e.g. ask for performance data or a preview link). Written as Dan, short and precise. Dan approves before it is sent; afterwards use read_mission_control_replies.",
      input_schema: {
        type: "object",
        properties: { text: { type: "string" }, reason: { type: "string" } },
        required: ["text", "reason"],
        additionalProperties: false,
      },
    },
    input: z.object({ text: z.string().min(1).max(3000), reason: z.string().max(400) }),
    run: async (input: { text: string; reason: string }, ctx) => {
      assertDiscreet(input.text);
      if (!ctx.missionControlUserId) throw new Error("Mission Control is not configured.");
      return newProposal(ctx, "mission_control_message", { text: input.text }, `Message to Mission Control: ${input.reason}`);
    },
  },

  find_docs: {
    readsUntrusted: true,
    permission: "read_meeting_notes",
    definition: {
      name: "find_docs",
      description: "Find ClickUp Docs (e.g. documentation of recurring meetings, client docs) in the allowed spaces by words in the doc name. Returns id, name, last update.",
      input_schema: {
        type: "object",
        properties: { query: { type: "string", description: "Words that must appear in the doc name, e.g. a client code" } },
        required: ["query"],
        additionalProperties: false,
      },
    },
    input: z.object({ query: z.string().min(2).max(80) }),
    run: async (input: { query: string }, ctx) => {
      const account = requireAccount(ctx);
      const client = clientFor(account);
      const words = input.query.toLowerCase().split(/\s+/).filter(Boolean);
      const hits: Array<{ id: string; name: string; updated: string | null; parent: { id: string; type: number } }> = [];
      let cursor: string | undefined;
      for (let page = 0; page < 6; page++) {
        const res = await client.searchDocs(account.teamId!, cursor);
        for (const d of res.docs) {
          const name = (d.name ?? "").toLowerCase();
          if (d.parent && words.every((w) => name.includes(w))) {
            hits.push({ id: d.id, name: d.name ?? "", updated: d.date_updated ? new Date(d.date_updated).toISOString() : null, parent: d.parent });
          }
        }
        cursor = res.next_cursor ?? undefined;
        if (!cursor) break;
      }
      const allowed = await mapLimit(hits.slice(0, 30), 4, async (h) => ((await docInAllowedSpace(ctx, h.parent)) ? h : null));
      return JSON.stringify(allowed.filter(Boolean).slice(0, 15).map((h) => ({ id: h!.id, name: h!.name, updated: h!.updated })));
    },
  },

  read_doc: {
    readsUntrusted: true,
    permission: "read_meeting_notes",
    definition: {
      name: "read_doc",
      description: "Read a ClickUp Doc (all pages, as text) live. Only docs in the allowed spaces.",
      input_schema: { type: "object", properties: { doc_id: { type: "string" } }, required: ["doc_id"], additionalProperties: false },
    },
    input: z.object({ doc_id: z.string().regex(/^[A-Za-z0-9_-]{1,60}$/) }),
    run: async (input: { doc_id: string }, ctx) => {
      const account = requireAccount(ctx);
      const client = clientFor(account);
      // Find the doc's parent to enforce the space rule.
      let parent: { id: string; type: number } | null = null;
      let cursor: string | undefined;
      for (let page = 0; page < 6 && !parent; page++) {
        const res = await client.searchDocs(account.teamId!, cursor);
        parent = res.docs.find((d) => d.id === input.doc_id)?.parent ?? null;
        cursor = res.next_cursor ?? undefined;
        if (!cursor) break;
      }
      if (!parent || !(await docInAllowedSpace(ctx, parent))) throw new Error("That doc is not in the spaces you may use.");
      const pages = await client.getDocPages(account.teamId!, input.doc_id);
      const flat: string[] = [];
      const walk = (ps: unknown[]) => {
        for (const raw of ps) {
          const pg = raw as { name?: string | null; content?: string | null; pages?: unknown[] | null };
          flat.push(`## ${pg.name ?? "Page"}\n${pg.content ?? ""}`);
          if (pg.pages?.length) walk(pg.pages);
        }
      };
      walk(pages);
      return flat.join("\n\n").slice(0, 15_000) || "(empty doc)";
    },
  },

  find_meeting_notes: {
    readsUntrusted: true,
    permission: "read_meeting_notes",
    definition: {
      name: "find_meeting_notes",
      description: "Search Dan's own meeting notes (stored in his vault after he shared them) by words in the file name, e.g. a client code or meeting title. Returns the newest matching notes with their text.",
      input_schema: {
        type: "object",
        properties: { query: { type: "string" }, limit: { type: "integer", description: "Max notes (default 3)" } },
        required: ["query"],
        additionalProperties: false,
      },
    },
    input: z.object({ query: z.string().min(2).max(80), limit: z.number().int().min(1).max(5).optional() }),
    run: async (input: { query: string; limit?: number }, ctx) => {
      const prefix = `${ctx.companyDir}/Meeting notes/`;
      const words = input.query.toLowerCase().split(/\s+/).filter(Boolean);
      const files = (await listVaultFiles())
        .filter((f) => f.startsWith(prefix) && f.endsWith(".md"))
        .filter((f) => words.every((w) => f.toLowerCase().includes(w)))
        .sort()
        .reverse()
        .slice(0, input.limit ?? 3);
      if (!files.length) return "No meeting notes found for this. Ask Dan whether he has notes to share.";
      const notes = await Promise.all(files.map(async (f) => `### ${f.slice(prefix.length, -3)}\n${((await readVaultFile(f))?.content ?? "").slice(0, 6000)}`));
      return notes.join("\n\n");
    },
  },

  propose_save_meeting_notes: {
    permission: "read_meeting_notes",
    definition: {
      name: "propose_save_meeting_notes",
      description: "When Dan shares meeting notes (e.g. from the Google Meet notetaker), propose saving them in his vault so they can be used for the next preparation. Keep his text; add a short summary and the client code if known. Dan approves before it is saved.",
      input_schema: {
        type: "object",
        properties: {
          date: { type: "string", description: "Meeting date YYYY-MM-DD" },
          title: { type: "string", description: "Short title incl. client code, e.g. \"NOVA weekly\"" },
          client_code: { type: "string" },
          summary: { type: "string", description: "3–6 bullet summary: decisions, open points, next steps" },
          notes: { type: "string", description: "The notes Dan provided" },
        },
        required: ["date", "title", "notes"],
        additionalProperties: false,
      },
    },
    input: z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      title: z.string().min(2).max(80).regex(/^[^/\\:*?"<>|#^[\]]+$/, "no special characters in the title"),
      client_code: z.string().regex(/^[A-Za-z0-9_-]{1,20}$/).optional(),
      summary: z.string().max(3000).optional(),
      notes: z.string().min(10).max(60_000),
    }),
    run: async (input: { date: string; title: string; client_code?: string; summary?: string; notes: string }, ctx) =>
      newProposal(ctx, "meeting_notes", { ...input, company_dir: ctx.companyDir }, `Save meeting notes “${input.date} ${input.title}” in your vault`),
  },

  resolve_inbox_item: {
    permission: null,
    definition: {
      name: "resolve_inbox_item",
      description: "Mark one of your open 'decide later' inbox items as handled after Dan decided (learned → you proposed the rule; discarded → not feedback; done → it was a request you fulfilled).",
      input_schema: {
        type: "object",
        properties: {
          file: { type: "string", description: "Inbox file path as shown in your context" },
          heading: { type: "string", description: "The item's heading line, e.g. \"11:51 — feedback for Otto (Client Follow-up)\"" },
          decision: { type: "string", enum: ["learned", "discarded", "done"] },
        },
        required: ["file", "heading", "decision"],
        additionalProperties: false,
      },
    },
    input: z.object({ file: z.string().max(300), heading: z.string().max(200), decision: z.enum(["learned", "discarded", "done"]) }),
    run: async (input: { file: string; heading: string; decision: "learned" | "discarded" | "done" }, ctx) => {
      if (!input.file.startsWith(`${ctx.companyDir}/Inbox/`) || input.file.includes("..")) throw new Error("Not an inbox file of your company.");
      const file = await readVaultFile(input.file);
      if (!file) throw new Error("Inbox file not found.");
      if (!file.content.includes(`agent: ${ctx.agent.id}`)) throw new Error("That inbox file belongs to another agent.");
      const at = file.content.indexOf(input.heading);
      if (at < 0) throw new Error("Item not found in that file.");
      const open = file.content.indexOf("- [ ] decide: learn / discard", at);
      if (open < 0) throw new Error("That item is already resolved.");
      const day = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Berlin" });
      const updated = `${file.content.slice(0, open)}- [x] decided ${day}: ${input.decision}${file.content.slice(open + "- [ ] decide: learn / discard".length)}`;
      await writeVaultFile(input.file, updated, `${ctx.agent.role}: inbox item ${input.decision}`, file.sha);
      return `Marked as ${input.decision}.`;
    },
  },

  figma_read: {
    readsUntrusted: true,
    permission: "read_figma",
    definition: {
      name: "figma_read",
      description:
        "Read a Figma file or frame live from a Figma link: file name, pages, frames (id, name, size) and the texts inside. Use the frame ids with figma_view to look at frames.",
      input_schema: { type: "object", properties: { url: { type: "string", description: "Figma link (design/file/proto/board), with or without node-id" } }, required: ["url"], additionalProperties: false },
    },
    input: z.object({ url: z.string().url().max(2000) }),
    run: async (input: { url: string }, ctx) => {
      const ref = parseFigmaUrl(input.url);
      if (!ref) throw new Error("That is not a Figma file link.");
      const client = requireFigma(ctx);
      if (ref.nodeId) {
        const res = await client.nodes(ref.fileKey, [ref.nodeId], 4);
        const node = res.nodes[ref.nodeId]?.document;
        if (!node) throw new Error("Frame not found in this file.");
        const s = summariseNode(node);
        return JSON.stringify({ file: res.name, last_modified: res.lastModified ?? null, frame: { id: node.id, name: node.name, type: node.type }, inside: s.frames, texts: s.texts });
      }
      const file = await client.file(ref.fileKey, 2);
      const pages = (file.document.children ?? []).map((pg) => ({
        page: pg.name,
        frames: (pg.children ?? []).slice(0, 80).map((f) => ({ id: f.id, name: f.name, type: f.type, size: f.absoluteBoundingBox ? `${Math.round(f.absoluteBoundingBox.width)}×${Math.round(f.absoluteBoundingBox.height)}` : null })),
      }));
      return JSON.stringify({ file: file.name, last_modified: file.lastModified ?? null, pages });
    },
  },

  figma_view: {
    readsUntrusted: true,
    permission: "read_figma",
    definition: {
      name: "figma_view",
      description:
        "Look at Figma frames as images (max 4 per call), e.g. to check a static ad, read its layout or compare variants. Pass a frame link with node-id, or node_ids from figma_read.",
      input_schema: {
        type: "object",
        properties: {
          url: { type: "string", description: "Figma link of the file (or directly of the frame)" },
          node_ids: { type: "array", items: { type: "string" }, description: "Frame ids like \"12:345\" (max 4)" },
        },
        required: ["url"],
        additionalProperties: false,
      },
    },
    input: z.object({ url: z.string().url().max(2000), node_ids: z.array(z.string().max(120)).max(4).optional() }),
    run: async (input: { url: string; node_ids?: string[] }, ctx) => {
      const ref = parseFigmaUrl(input.url);
      if (!ref) throw new Error("That is not a Figma file link.");
      const ids = [...new Set([...(input.node_ids ?? []).map(normaliseNodeId), ref.nodeId].filter((x): x is string => Boolean(x)))].slice(0, 4);
      if (!ids.length) throw new Error("Which frame? Pass a frame link with node-id, or node_ids from figma_read.");
      const client = requireFigma(ctx);
      // Scale so the longest side is ~1500 px (enough detail, sensible size).
      const meta = await client.nodes(ref.fileKey, ids, 1);
      const sides = ids.map((id) => meta.nodes[id]?.document.absoluteBoundingBox).filter(Boolean).map((b) => Math.max(b!.width, b!.height));
      const scale = sides.length ? Math.min(2, Math.max(0.05, 1500 / Math.max(...sides))) : 1;
      const { images } = await client.images(ref.fileKey, ids, Number(scale.toFixed(3)));
      const out: ToolOutput = { text: "", images: [] };
      const lines: string[] = [];
      for (const id of ids) {
        const name = meta.nodes[id]?.document.name ?? id;
        const src = images[id];
        if (!src) {
          lines.push(`${id} (${name}): could not be rendered`);
          continue;
        }
        const res = await fetch(src, { cache: "no-store" });
        const buf = Buffer.from(await res.arrayBuffer());
        if (!res.ok || buf.length > 4_500_000) {
          lines.push(`${id} (${name}): image too large or unavailable`);
          continue;
        }
        out.images.push({ media_type: "image/png", data: buf.toString("base64") });
        lines.push(`Image ${out.images.length}: ${id} (${name})`);
      }
      out.text = `${meta.name}\n${lines.join("\n")}`;
      return out;
    },
  },

  figma_comments: {
    readsUntrusted: true,
    permission: "read_figma",
    definition: {
      name: "figma_comments",
      description: "Read the comments in a Figma file (newest first): who, when, on which frame, resolved or open.",
      input_schema: { type: "object", properties: { url: { type: "string" }, open_only: { type: "boolean", description: "Only unresolved comments" } }, required: ["url"], additionalProperties: false },
    },
    input: z.object({ url: z.string().url().max(2000), open_only: z.boolean().optional() }),
    run: async (input: { url: string; open_only?: boolean }, ctx) => {
      const ref = parseFigmaUrl(input.url);
      if (!ref) throw new Error("That is not a Figma file link.");
      const { comments } = await requireFigma(ctx).comments(ref.fileKey);
      const rows = comments
        .filter((c) => !input.open_only || !c.resolved_at)
        .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
        .slice(0, 40)
        .map((c) => ({ by: c.user?.handle ?? "?", at: c.created_at ?? null, frame: c.client_meta?.node_id ?? null, resolved: Boolean(c.resolved_at), reply: Boolean(c.parent_id), text: c.message.slice(0, 600) }));
      return JSON.stringify({ count: rows.length, comments: rows });
    },
  },

  propose_figma_comment: {
    permission: "comment_figma",
    definition: {
      name: "propose_figma_comment",
      description: "Propose a comment in a Figma file (optionally pinned to a frame), written AS DAN. Never mention agents, AI or the village. Dan approves before it is posted.",
      input_schema: {
        type: "object",
        properties: { url: { type: "string" }, message: { type: "string" }, node_id: { type: "string", description: "Frame id to attach the comment to (optional)" } },
        required: ["url", "message"],
        additionalProperties: false,
      },
    },
    input: z.object({ url: z.string().url().max(2000), message: z.string().min(1).max(4000), node_id: z.string().max(120).optional() }),
    run: async (input: { url: string; message: string; node_id?: string }, ctx) => {
      assertDiscreet(input.message);
      const ref = parseFigmaUrl(input.url);
      if (!ref) throw new Error("That is not a Figma file link.");
      requireFigma(ctx);
      const nodeId = (input.node_id ? normaliseNodeId(input.node_id) : null) ?? ref.nodeId;
      return newProposal(ctx, "figma_comment", { file_key: ref.fileKey, ...(nodeId ? { node_id: nodeId } : {}), message: input.message }, `Figma comment${nodeId ? ` on frame ${nodeId}` : ""}`);
    },
  },

  end_conversation: {
    permission: null,
    definition: {
      name: "end_conversation",
      description:
        "Dan is saying goodbye or that he's done (e.g. \"danke, das war's\", \"tschüss\", \"bye\", \"that's all\", \"bis später\"). Write ONE short goodbye first, then call this as the last step (write nothing after it): the village then opens the finish dialog where Dan decides what you learn. Don't call it for a mere \"danke\" in the middle of work.",
      input_schema: { type: "object", properties: {}, additionalProperties: false },
    },
    input: z.object({}),
    run: async (_input: Record<string, never>, ctx) => {
      if (ctx.readOnly) throw new Error("Not available here.");
      ctx.finishRequested = true;
      return "Done — the finish dialog opens for Dan now. Your goodbye is already written: end your answer here without adding anything.";
    },
  },

  ask_colleague: {
    readsUntrusted: true,
    permission: null,
    definition: {
      name: "ask_colleague",
      description:
        "Ask another agent of your company for information Dan gave them (their playbook rules, saved meeting notes, open notes) or that they can look up with their own tools. Use it when Dan says he told a colleague something, or when a colleague's knowledge clearly helps. The colleague answers with the source; it cannot act. Max 4 questions per answer.",
      input_schema: {
        type: "object",
        properties: {
          colleague_id: { type: "string", description: "Agent id from your list of colleagues" },
          question: { type: "string", description: "Precise question incl. context — the colleague does not see this conversation" },
        },
        required: ["colleague_id", "question"],
        additionalProperties: false,
      },
    },
    input: z.object({ colleague_id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/), question: z.string().min(5).max(3000) }),
    run: async (input: { colleague_id: string; question: string }, ctx) => {
      if (!ctx.askColleague || !ctx.colleagues) throw new Error("You can't ask colleagues from here — answer with what you know.");
      if (!ctx.colleagues.some((c) => c.id === input.colleague_id)) {
        throw new Error(`Not a colleague in your company. Colleagues: ${ctx.colleagues.map((c) => `${c.id} (${c.name}, ${c.role})`).join(", ") || "none"}`);
      }
      ctx.colleagueQuestions = (ctx.colleagueQuestions ?? 0) + 1;
      if (ctx.colleagueQuestions > 4) throw new Error("You already asked 4 colleague questions in this answer — work with what you have.");
      return ctx.askColleague(input.colleague_id, input.question);
    },
  },

  ask_team_member: {
    readsUntrusted: true,
    permission: null,
    leadOnly: true,
    definition: {
      name: "ask_team_member",
      description:
        "Team leads only: hand a concrete request to a member of your team. The member works on it with its own tools and permissions and returns its answer; its proposals appear for Dan to approve. Ask several members in parallel when useful, then combine their answers for Dan.",
      input_schema: {
        type: "object",
        properties: {
          member_id: { type: "string", description: "Agent id of the team member" },
          request: { type: "string", description: "What exactly you need from them (context included — they don't see this conversation)" },
        },
        required: ["member_id", "request"],
        additionalProperties: false,
      },
    },
    input: z.object({ member_id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/), request: z.string().min(5).max(4000) }),
    run: async (input: { member_id: string; request: string }, ctx) => {
      if (!ctx.delegate || !ctx.teamMembers) throw new Error("Only a team lead can ask team members.");
      ctx.delegations = (ctx.delegations ?? 0) + 1;
      if (ctx.delegations > 6) throw new Error("You already asked your team 6 times in this answer — combine what you have for Dan.");
      if (!ctx.teamMembers.some((m) => m.id === input.member_id)) {
        throw new Error(`Not in your team. Members: ${ctx.teamMembers.map((m) => `${m.id} (${m.role})`).join(", ") || "none"}`);
      }
      return ctx.delegate(input.member_id, input.request);
    },
  },

  propose_rule_change: {
    permission: null,
    definition: {
      name: "propose_rule_change",
      description:
        "Dan wants a rule in your playbook removed or changed (\"forget the rule about …\", \"change it to …\"). Quote the existing rule (enough words to identify exactly one line). Leave new_rule empty to delete it, or give the new wording to replace it in place. Optionally also remove/replace the matching test case. Dan approves before anything changes.",
      input_schema: {
        type: "object",
        properties: {
          file: { type: "string", enum: ["craft", "context"] },
          current_rule: { type: "string", description: "Words from the existing rule (min. 10 characters, unique)" },
          new_rule: { type: "string", description: "New wording (leave out to delete the rule)" },
          current_test_case: { type: "string", description: "Words from the matching test case to remove/replace (optional)" },
          new_test_case: { type: "string", description: "New test case (optional)" },
          reason: { type: "string", description: "Short reason (Dan's words, no ClickUp content)" },
        },
        required: ["file", "current_rule", "reason"],
        additionalProperties: false,
      },
    },
    input: z.object({
      file: z.enum(["craft", "context"]),
      current_rule: z.string().min(10).max(600),
      new_rule: z.string().min(5).max(1200).optional(),
      current_test_case: z.string().min(10).max(600).optional(),
      new_test_case: z.string().min(5).max(800).optional(),
      reason: z.string().max(400),
    }),
    run: async (
      input: { file: "craft" | "context"; current_rule: string; new_rule?: string; current_test_case?: string; new_test_case?: string; reason: string },
      ctx,
    ) => {
      const dir = ctx.agent.path.split("/").slice(0, -1).join("/");
      const fileName = input.file === "craft" ? "Craft.md" : "Context.md";
      const note = await readVaultFile(`${dir}/${fileName}`);
      if (!note) throw new Error(`Your ${fileName} is empty — there is no rule to change.`);
      const matches = findRuleLines(note.content, input.current_rule);
      if (matches.length === 0) {
        const other = await readVaultFile(`${dir}/${input.file === "craft" ? "Context.md" : "Craft.md"}`);
        const elsewhere = other ? findRuleLines(other.content, input.current_rule).length : 0;
        throw new Error(elsewhere ? `Not in ${fileName} — it is in the other playbook file. Call again with file="${input.file === "craft" ? "context" : "craft"}".` : `No rule in ${fileName} contains that text. Quote the rule as it is written in your playbook.`);
      }
      if (matches.length > 1) throw new Error(`That matches ${matches.length} rules — quote more words. Candidates:\n${matches.join("\n")}`);
      let testLine: string | undefined;
      if (input.current_test_case) {
        const tests = await readVaultFile(`${dir}/Test cases.md`);
        const found = tests ? findRuleLines(tests.content, input.current_test_case) : [];
        if (found.length !== 1) throw new Error(found.length ? `The test case quote matches ${found.length} lines — quote more words.` : "No test case contains that text.");
        testLine = found[0];
      }
      const action = input.new_rule ? "Change" : "Remove";
      return newProposal(
        ctx,
        "rule_change",
        {
          file: input.file,
          line: matches[0],
          ...(input.new_rule ? { new_rule: input.new_rule } : {}),
          ...(testLine ? { test_case_line: testLine } : {}),
          ...(input.new_test_case ? { new_test_case: input.new_test_case } : {}),
          reason: input.reason,
        },
        `${action} a ${input.file} rule`,
      );
    },
  },

  propose_playbook_rule: {
    permission: null,
    definition: {
      name: "propose_playbook_rule",
      description:
        "Propose a lasting rule for your playbook, learned from Dan's feedback or training. 'craft' = transferable skill (would also apply in another company), 'context' = specific to this company. Write it in general form — never copy task text, client data or names from ClickUp; link a task id instead if needed. Include a test case that checks the rule.",
      input_schema: {
        type: "object",
        properties: {
          file: { type: "string", enum: ["craft", "context"] },
          rule: { type: "string" },
          test_case: { type: "string", description: "Given … → expected …" },
          source: { type: "string", description: "Short note what led to this rule (no ClickUp content)" },
          replaces: { type: "string", description: "If this rule answers a “to confirm” line of your playbook: that line's text (it is removed on approval)" },
        },
        required: ["file", "rule", "test_case", "source"],
        additionalProperties: false,
      },
    },
    input: z.object({
      file: z.enum(["craft", "context"]),
      rule: z.string().min(5).max(1200),
      test_case: z.string().min(5).max(800),
      source: z.string().max(400),
      replaces: z.string().max(600).optional(),
    }),
    run: async (input: { file: "craft" | "context"; rule: string; test_case: string; source: string; replaces?: string }, ctx) =>
      newProposal(ctx, "playbook_rule", input, `New ${input.file === "craft" ? "craft" : "context"} rule: ${input.rule.slice(0, 90)}`),
  },
};

/** Tolerant name match: dashes (–, —, -), spacing and case don't matter. */
export function sameListName(a: string, b: string) {
  const norm = (x: string) => x.replace(/[\u2012-\u2015-]/g, "-").replace(/\s+/g, " ").trim().toLowerCase();
  return norm(a) === norm(b);
}

async function findDraftsList(ctx: ToolContext): Promise<string> {
  const account = requireAccount(ctx);
  const client = clientFor(account);
  const { spaces } = await client.getSpaces(account.teamId!);
  for (const s of spaces.filter((x) => account.selectedSpaceIds.includes(x.id))) {
    const { lists } = await client.getFolderlessLists(s.id);
    const hit = lists.find((l) => sameListName(l.name, ctx.draftsListName));
    if (hit) return hit.id;
  }
  throw new Error(`The drafts list “${ctx.draftsListName}” does not exist yet. Ask Dan to create it in Settings.`);
}

function requireFigma(ctx: ToolContext) {
  if (!ctx.figma) throw new Error("Figma is not connected for this company yet — Dan can connect it in Settings → Figma.");
  return figmaClientFor(ctx.figma);
}

/** Doc parents: 4 = space, 5 = folder, 6 = list. Workspace-level/private docs are not allowed. */
async function docInAllowedSpace(ctx: ToolContext, parent: { id: string; type: number }) {
  const account = requireAccount(ctx);
  const client = clientFor(account);
  try {
    if (parent.type === 4) return account.selectedSpaceIds.includes(parent.id);
    if (parent.type === 5) return account.selectedSpaceIds.includes((await client.getFolder(parent.id)).space.id);
    if (parent.type === 6) return account.selectedSpaceIds.includes((await client.getList(parent.id)).space.id);
  } catch {
    return false;
  }
  return false;
}

/** Tools that change something or propose a change — never available in a read-only colleague turn. */
const WRITE_TOOLS = new Set([
  "propose_comment",
  "propose_task_change",
  "draft_task",
  "propose_mission_control_message",
  "propose_figma_comment",
  "propose_save_meeting_notes",
  "propose_playbook_rule",
  "propose_rule_change",
  "resolve_inbox_item",
  "ask_team_member",
  "ask_colleague",
  "end_conversation",
]);

/** Names of tools whose results contain text written by others. */
export const UNTRUSTED_TOOL_NAMES = new Set(Object.entries(TOOLS).filter(([, t]) => t.readsUntrusted).map(([n]) => n));

/** Tool definitions for an agent, filtered by its permissions (stable order for prompt caching). */
export function toolsFor(agent: AgentProfile, opts: { readOnly?: boolean } = {}): Anthropic.Tool[] {
  return Object.values(TOOLS)
    .filter((t) => (t.permission === null || agent.permissions.includes(t.permission)) && (!t.leadOnly || agent.kind === "lead"))
    .filter((t) => !opts.readOnly || !WRITE_TOOLS.has(t.definition.name))
    .map((t) => ({ ...t.definition, eager_input_streaming: true }));
}

/** Runs one tool call. Input is validated against the schema first; errors become is_error results. */
export type ToolResultContent = string | Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam>;

export async function runTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<{ content: ToolResultContent; isError: boolean }> {
  const tool = TOOLS[name];
  if (
    !tool ||
    (tool.permission && !ctx.agent.permissions.includes(tool.permission)) ||
    (tool.leadOnly && ctx.agent.kind !== "lead") ||
    (ctx.readOnly && WRITE_TOOLS.has(name))
  ) {
    return { content: `Tool ${name} is not available to you.`, isError: true };
  }
  const parsed = tool.input.safeParse(rawInput);
  if (!parsed.success) {
    return { content: JSON.stringify({ INVALID_INPUT: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }), isError: true };
  }
  try {
    const result = await tool.run(parsed.data as never, ctx);
    if (tool.readsUntrusted) ctx.tainted = true;
    if (typeof result === "string") return { content: result, isError: false };
    return {
      content: [
        { type: "text", text: result.text },
        ...result.images.map((img) => ({ type: "image" as const, source: { type: "base64" as const, media_type: img.media_type, data: img.data } })),
      ],
      isError: false,
    };
  } catch (err) {
    return { content: err instanceof Error ? err.message : "Tool failed.", isError: true };
  }
}
