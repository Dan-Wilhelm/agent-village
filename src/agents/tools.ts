import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { clientFor, type ClickUpAccount } from "@/integrations/clickup/account";
import { isOpenTask } from "@/integrations/clickup/mapping";
import { fetchUpcomingEvents } from "@/integrations/calendar/feed";

import { assertDiscreet } from "./discretion";
import type { AgentEntry } from "./registry";
import type { AgentProfile } from "./schema";

/**
 * Tools an agent can use. READ tools run live and return data to the model
 * (nothing is stored). WRITE tools never change anything directly: they return
 * a PROPOSAL that the owner approves in the village (src/agents/execute.ts).
 * The only exception is draft_task, which writes into the private drafts list.
 */

export type ProposalKind = "comment" | "task_change" | "draft_task" | "mission_control_message" | "playbook_rule";

export interface Proposal {
  id: string;
  kind: ProposalKind;
  agentId: string;
  /** What exactly will happen on approval (validated again on execution). */
  args: Record<string, unknown>;
  /** Short human summary for the panel. */
  summary: string;
}

export interface ToolContext {
  agent: AgentEntry;
  account: ClickUpAccount | null;
  missionControlUserId: string | null;
  draftsListName: string;
  proposals: Proposal[];
}

type Permission = AgentProfile["permissions"][number];

interface ToolDef {
  permission: Permission | null; // null = always available
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

function compactTask(t: {
  id: string;
  name: string;
  status: { status: string };
  due_date: number | null;
  list: { id: string; name?: string | null };
  assignees?: Array<{ username?: string | null }> | null;
  url?: string | null;
  date_updated: number | null;
}) {
  return {
    id: t.id,
    name: t.name,
    status: t.status.status,
    due: t.due_date ? new Date(t.due_date).toISOString() : null,
    list: t.list.name ?? t.list.id,
    assignees: (t.assignees ?? []).map((a) => a.username ?? "?"),
    updated: t.date_updated ? new Date(t.date_updated).toISOString() : null,
    url: t.url ?? null,
  };
}

async function liveTask(ctx: ToolContext, taskId: string) {
  const account = requireAccount(ctx);
  const task = await clientFor(account).getTask(taskId);
  if (!account.selectedSpaceIds.includes(task.space.id)) throw new Error("That task is outside the spaces you may use.");
  return task;
}

function newProposal(ctx: ToolContext, kind: ProposalKind, args: Record<string, unknown>, summary: string) {
  const p: Proposal = { id: `p_${crypto.randomUUID().slice(0, 8)}`, kind, agentId: ctx.agent.id, args, summary };
  ctx.proposals.push(p);
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
          limit: { type: "integer", description: "Max rows (default 30, max 60)" },
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
      limit: z.number().int().min(1).max(60).optional(),
    }),
    run: async (input: {
      statuses?: string[];
      list_ids?: string[];
      assigned_to_me?: boolean;
      due_before?: string;
      due_after?: string;
      query?: string;
      limit?: number;
    }, ctx) => {
      const account = requireAccount(ctx);
      const client = clientFor(account);
      const rows: ReturnType<typeof compactTask>[] = [];
      const q = input.query?.toLowerCase();
      for (let page = 0; page < 5 && rows.length < (input.limit ?? 30); page++) {
        const res = await client.getTeamTasks(account.teamId!, {
          spaceIds: account.selectedSpaceIds,
          page,
          statuses: input.statuses,
          listIds: input.list_ids,
          assignees: input.assigned_to_me ? [account.externalUserId] : undefined,
          dueDateLtMs: input.due_before ? Date.parse(input.due_before) : undefined,
          dueDateGtMs: input.due_after ? Date.parse(input.due_after) : undefined,
        });
        for (const t of res.tasks) if (isOpenTask(t) && (!q || t.name.toLowerCase().includes(q))) rows.push(compactTask(t));
        if (res.last_page !== false || res.tasks.length === 0) break;
      }
      const out = rows.slice(0, input.limit ?? 30);
      return JSON.stringify({ count: out.length, tasks: out });
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
        ...compactTask(task),
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

  draft_task: {
    permission: "draft_task",
    definition: {
      name: "draft_task",
      description:
        "Create a NEW task as a draft in Dan's private drafts list. On approval it is created in the target list and the draft is removed. Write the task as Dan would (no mention of agents/AI). Use list_structure to find the target list id.",
      input_schema: {
        type: "object",
        properties: {
          target_list_id: { type: "string" },
          name: { type: "string" },
          description_markdown: { type: "string" },
          due_date: { type: "string", description: "ISO date/time (optional)" },
          priority: { type: "integer", description: "1 urgent, 2 high, 3 normal, 4 low (optional)" },
        },
        required: ["target_list_id", "name", "description_markdown"],
        additionalProperties: false,
      },
    },
    input: z.object({
      target_list_id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
      name: z.string().min(1).max(250),
      description_markdown: z.string().max(20_000),
      due_date: iso.optional(),
      priority: z.number().int().min(1).max(4).optional(),
    }),
    run: async (
      input: { target_list_id: string; name: string; description_markdown: string; due_date?: string; priority?: number },
      ctx,
    ) => {
      assertDiscreet(`${input.name}\n${input.description_markdown}`);
      const account = requireAccount(ctx);
      const draftsListId = await findDraftsList(ctx);
      const draft = await clientFor(account).createTask(draftsListId, {
        name: input.name,
        markdown_content: input.description_markdown,
        ...(input.due_date ? { due_date: Date.parse(input.due_date), due_date_time: input.due_date.includes("T") } : {}),
        ...(input.priority ? { priority: input.priority } : {}),
      });
      return newProposal(
        ctx,
        "draft_task",
        { draft_task_id: draft.id, target_list_id: input.target_list_id },
        `New task “${input.name}”`,
      );
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
    }),
    run: async (input: { file: "craft" | "context"; rule: string; test_case: string; source: string }, ctx) =>
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

/** Tool definitions for an agent, filtered by its permissions (stable order for prompt caching). */
export function toolsFor(agent: AgentProfile): Anthropic.Tool[] {
  return Object.values(TOOLS)
    .filter((t) => t.permission === null || agent.permissions.includes(t.permission))
    .map((t) => ({ ...t.definition, eager_input_streaming: true }));
}

/** Runs one tool call. Input is validated against the schema first; errors become is_error results. */
export async function runTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<{ content: string; isError: boolean }> {
  const tool = TOOLS[name];
  if (!tool || (tool.permission && !ctx.agent.permissions.includes(tool.permission))) {
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
