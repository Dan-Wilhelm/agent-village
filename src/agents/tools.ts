import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { clientFor, type ClickUpAccount } from "@/integrations/clickup/account";
import type { ClickUpCustomField } from "@/integrations/clickup/client";
import { apiValueFor, keyFields, matchesFieldFilter } from "@/integrations/clickup/fields";
import { isOpenTask } from "@/integrations/clickup/mapping";
import { fetchUpcomingEvents } from "@/integrations/calendar/feed";
import { listVaultFiles, readVaultFile, writeVaultFile } from "@/integrations/vault/github";

import { assertDiscreet } from "./discretion";
import type { AgentEntry } from "./registry";
import type { AgentProfile } from "./schema";

/**
 * Tools an agent can use. READ tools run live and return data to the model
 * (nothing is stored). WRITE tools never change anything directly: they return
 * a PROPOSAL that the owner approves in the village (src/agents/execute.ts).
 * The only exception is draft_task, which writes into the private drafts list.
 */

export type ProposalKind = "comment" | "task_change" | "draft_task" | "mission_control_message" | "playbook_rule" | "meeting_notes";

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
  /** Vault folder of the agent's company, e.g. "Companies/SQVM". */
  companyDir: string;
  proposals: Proposal[];
  /** Executes a proposal right away (only for kinds in the agent's auto_approve). */
  autoExecute?: (p: Proposal) => Promise<{ ok: boolean; message: string }>;
  /** Team leads only: ask a member of the team (runs the member's own turn). */
  delegate?: (memberId: string, request: string) => Promise<string>;
  /** Members of the lead's team (id, name, role). */
  teamMembers?: Array<{ id: string; name: string; role: string }>;
}

type Permission = AgentProfile["permissions"][number];

interface ToolDef {
  permission: Permission | null; // null = always available
  /** Only for agents of kind "lead". */
  leadOnly?: boolean;
  definition: Anthropic.Tool;
  input: z.ZodTypeAny;
  run: (input: never, ctx: ToolContext) => Promise<string>;
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
  },
  fieldNames?: string[],
) {
  const fields = keyFields(t.custom_fields, fieldNames);
  return {
    id: t.id,
    name: t.name,
    status: t.status.status,
    due: t.due_date ? new Date(t.due_date).toISOString() : null,
    list: t.list.name ?? t.list.id,
    assignees: (t.assignees ?? []).map((a) => a.username ?? "?"),
    ...(t.tags?.length ? { tags: t.tags.map((x) => x.name) } : {}),
    ...(Object.keys(fields).length ? { fields } : {}),
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
            description: "Custom field filters by readable value, e.g. {\"Client Code\": \"ALGE\", \"Format\": \"VID\"}",
          },
          tags: { type: "array", items: { type: "string" }, description: "Only tasks with at least one of these tags" },
          updated_after: { type: "string", description: "ISO date/time; only tasks changed after this (e.g. 'what happened since yesterday')" },
          include_closed: { type: "boolean", description: "Also return closed/done tasks (default false)" },
          with_last_comment: {
            type: "boolean",
            description: "Add each task's newest comment (who, when, text) — use it to see what was last done. Max 40 tasks.",
          },
          limit: { type: "integer", description: "Max rows (default 30, max 80)" },
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
    }, ctx) => {
      const account = requireAccount(ctx);
      const client = clientFor(account);
      const limit = input.limit ?? 30;
      const q = input.query?.toLowerCase();
      const tagSet = input.tags?.map((t) => t.toLowerCase());
      const matched: Array<Parameters<typeof compactTask>[0]> = [];
      // Client-side filters (fields/tags/name) may need more pages.
      const maxPages = input.field_equals || tagSet || q ? 10 : 5;
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
          if (!input.include_closed && !isOpenTask(t)) continue;
          if (q && !t.name.toLowerCase().includes(q)) continue;
          if (tagSet && !(t.tags ?? []).some((g) => tagSet.includes(g.name.toLowerCase()))) continue;
          if (input.field_equals && !matchesFieldFilter(t.custom_fields, input.field_equals)) continue;
          matched.push(t);
        }
        if (res.last_page !== false || res.tasks.length === 0) break;
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
    permission: "read_tasks",
    definition: {
      name: "get_task",
      description:
        "Read one task live: status, due date, assignees, description and (if allowed) the latest comments. Use it to see what was last done on a task — Dan documents progress in comments.",
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
        comments: comments.map((c) => ({
          by: c.user?.username ?? "?",
          at: c.date ? new Date(c.date).toISOString() : null,
          text: (c.comment_text ?? "").slice(0, 1500),
        })),
      });
    },
  },

  get_calendar: {
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
        "fields = custom fields by readable value, e.g. {\"Client Code\": \"ALGE\", \"Format\": \"IMG\", \"Google Drive\": \"https://…\"}; they are checked against the target list now and set on approval.",
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
      due_date: iso.optional(),
      priority: z.number().int().min(1).max(4).optional(),
    }),
    run: async (
      raw: {
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
      assertDiscreet(`${input.name ?? ""}\n${input.description_markdown ?? ""}\n${Object.values(input.fields ?? {}).join("\n")}`);
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
          title: { type: "string", description: "Short title incl. client code, e.g. \"ALGE weekly\"" },
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
      client_code: z.string().max(20).optional(),
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

  ask_team_member: {
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
      if (!ctx.teamMembers.some((m) => m.id === input.member_id)) {
        throw new Error(`Not in your team. Members: ${ctx.teamMembers.map((m) => `${m.id} (${m.role})`).join(", ") || "none"}`);
      }
      return ctx.delegate(input.member_id, input.request);
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

/** Tool definitions for an agent, filtered by its permissions (stable order for prompt caching). */
export function toolsFor(agent: AgentProfile): Anthropic.Tool[] {
  return Object.values(TOOLS)
    .filter((t) => (t.permission === null || agent.permissions.includes(t.permission)) && (!t.leadOnly || agent.kind === "lead"))
    .map((t) => ({ ...t.definition, eager_input_streaming: true }));
}

/** Runs one tool call. Input is validated against the schema first; errors become is_error results. */
export async function runTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<{ content: string; isError: boolean }> {
  const tool = TOOLS[name];
  if (!tool || (tool.permission && !ctx.agent.permissions.includes(tool.permission)) || (tool.leadOnly && ctx.agent.kind !== "lead")) {
    return { content: `Tool ${name} is not available to you.`, isError: true };
  }
  const parsed = tool.input.safeParse(rawInput);
  if (!parsed.success) {
    return { content: JSON.stringify({ INVALID_INPUT: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }), isError: true };
  }
  try {
    return { content: await tool.run(parsed.data as never, ctx), isError: false };
  } catch (err) {
    return { content: err instanceof Error ? err.message : "Tool failed.", isError: true };
  }
}
