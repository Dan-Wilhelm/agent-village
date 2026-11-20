/**
 * Minimal typed ClickUp API v2 client.
 *
 * - Personal token auth: `Authorization: pk_...` (no "Bearer" prefix).
 * - Stays under the lowest plan limit (100 requests/min) with a client-side
 *   sliding window, and waits for X-RateLimit-Reset on HTTP 429.
 * - Responses are validated with zod, but leniently (unknown fields are kept out).
 * - The token is never logged or included in error messages.
 */
import { z } from "zod";

const BASE = "https://api.clickup.com/api/v2";
const BASE_V3 = "https://api.clickup.com/api/v3";
const REQUESTS_PER_MINUTE = 90; // safety margin below 100

export class ClickUpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ClickUpError";
  }
}

// ---------------------------------------------------------------------------
// Schemas (only the fields we use)
// ---------------------------------------------------------------------------

const ms = z.union([z.string(), z.number()]).nullish().transform((v) => (v == null || v === "" ? null : Number(v)));

const statusSchema = z.object({
  id: z.coerce.string().nullish(),
  status: z.string(),
  type: z.string().nullish(),
  color: z.string().nullish(),
  orderindex: z.coerce.number().nullish(),
});

export const userSchema = z.object({
  user: z.object({ id: z.coerce.string(), username: z.string().nullish(), email: z.string().nullish() }),
});

export const teamsSchema = z.object({
  teams: z.array(z.object({ id: z.coerce.string(), name: z.string(), color: z.string().nullish() })),
});

export const spacesSchema = z.object({
  spaces: z.array(
    z.object({
      id: z.coerce.string(),
      name: z.string(),
      color: z.string().nullish(),
      statuses: z.array(statusSchema).nullish(),
    }),
  ),
});

const listSchema = z.object({
  id: z.coerce.string(),
  name: z.string(),
  statuses: z.array(statusSchema).nullish(),
});

export const foldersSchema = z.object({
  folders: z.array(
    z.object({
      id: z.coerce.string(),
      name: z.string(),
      hidden: z.boolean().nullish(),
      lists: z.array(listSchema).nullish(),
    }),
  ),
});

export const listsSchema = z.object({ lists: z.array(listSchema) });

export const taskSchema = z.object({
  id: z.coerce.string(),
  name: z.string(),
  status: statusSchema,
  priority: z.object({ id: z.coerce.string().nullish(), priority: z.string().nullish() }).nullish(),
  due_date: ms,
  start_date: ms,
  date_created: ms,
  date_updated: ms,
  date_closed: ms,
  assignees: z
    .array(z.object({ id: z.coerce.string(), username: z.string().nullish(), initials: z.string().nullish(), color: z.string().nullish() }))
    .nullish(),
  tags: z.array(z.object({ name: z.string() })).nullish(),
  url: z.string().nullish(),
  parent: z.coerce.string().nullish(),
  archived: z.boolean().nullish(),
  list: z.object({ id: z.coerce.string(), name: z.string().nullish() }),
  folder: z.object({ id: z.coerce.string(), name: z.string().nullish(), hidden: z.boolean().nullish() }).nullish(),
  space: z.object({ id: z.coerce.string() }),
  markdown_description: z.string().nullish(),
  text_content: z.string().nullish(),
  custom_fields: z.array(customFieldSchema()).nullish(),
  checklists: z
    .array(
      z.object({
        id: z.coerce.string(),
        name: z.string().nullish(),
        resolved: z.coerce.number().nullish(),
        unresolved: z.coerce.number().nullish(),
        items: z
          .array(z.object({ id: z.coerce.string(), name: z.string().nullish(), resolved: z.boolean().nullish(), parent: z.coerce.string().nullish() }))
          .nullish(),
      }),
    )
    .nullish(),
});
export type ClickUpTask = z.infer<typeof taskSchema>;

/** Custom field definition (+ value when it comes with a task). Options for drop_down/labels. */
function customFieldSchema() {
  return z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    value: z.unknown().optional(),
    type_config: z
      .object({
        options: z
          .array(z.object({ id: z.coerce.string(), name: z.string().nullish(), label: z.string().nullish(), orderindex: z.coerce.number().nullish() }))
          .nullish(),
      })
      .passthrough()
      .nullish(),
  });
}
export type ClickUpCustomField = z.infer<ReturnType<typeof customFieldSchema>>;
export const listFieldsSchema = z.object({ fields: z.array(customFieldSchema()) });

export const listDetailSchema = z.object({
  id: z.coerce.string(),
  name: z.string(),
  space: z.object({ id: z.coerce.string() }),
  statuses: z.array(statusSchema).nullish(),
});

export const taskTemplatesSchema = z.object({ templates: z.array(z.object({ id: z.string(), name: z.string() })) });

export const docsPageSchema = z.object({
  docs: z.array(
    z.object({
      id: z.string(),
      name: z.string().nullish(),
      parent: z.object({ id: z.coerce.string(), type: z.coerce.number() }).nullish(),
      date_updated: ms,
      deleted: z.boolean().nullish(),
      archived: z.boolean().nullish(),
    }),
  ),
  next_cursor: z.string().nullish(),
});
export const docPagesSchema = z.array(
  z.lazy(() => docPageSchema),
);
const docPageSchema: z.ZodType<{ id: string; name?: string | null; content?: string | null; pages?: unknown[] | null }> = z.object({
  id: z.string(),
  name: z.string().nullish(),
  content: z.string().nullish(),
  pages: z.array(z.unknown()).nullish(),
});

export const tasksPageSchema = z.object({ tasks: z.array(taskSchema), last_page: z.boolean().nullish() });

export const commentsSchema = z.object({
  comments: z.array(
    z.object({
      id: z.coerce.string(),
      comment_text: z.string().nullish(),
      user: z.object({ username: z.string().nullish() }).nullish(),
      date: ms,
    }),
  ),
});

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface ClickUpClientOptions {
  token: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  maxRetries?: number;
}

export type TeamTasksQuery = {
  spaceIds: string[];
  page?: number;
  includeClosed?: boolean;
  dateUpdatedGtMs?: number;
  /** Skip markdown descriptions (smaller pages for overviews). */
  withDescriptions?: boolean;
  statuses?: string[];
  listIds?: string[];
  assignees?: string[];
  dueDateLtMs?: number;
  dueDateGtMs?: number;
};

export const createdTaskSchema = z.object({ id: z.coerce.string(), url: z.string().nullish() });
export const commentCreatedSchema = z.object({ id: z.coerce.string() });
export const chatChannelSchema = z.object({ data: z.object({ id: z.coerce.string() }) });
export const chatMessagesSchema = z.object({
  data: z
    .array(z.object({ id: z.coerce.string(), user_id: z.coerce.string().nullish(), content: z.string().nullish(), date: ms }))
    .default([]),
});

export interface NewTask {
  name: string;
  markdown_content?: string;
  status?: string;
  due_date?: number;
  due_date_time?: boolean;
  assignees?: number[];
  priority?: number | null;
  tags?: string[];
}

export interface TaskChange {
  name?: string;
  markdown_description?: string;
  status?: string;
  due_date?: number | null;
  due_date_time?: boolean;
  priority?: number | null;
  assignees?: { add?: number[]; rem?: number[] };
}

export function createClickUpClient(opts: ClickUpClientOptions) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const maxRetries = opts.maxRetries ?? 3;
  const sent: number[] = [];

  async function throttle() {
    for (;;) {
      const t = now();
      while (sent.length && t - sent[0] >= 60_000) sent.shift();
      if (sent.length < REQUESTS_PER_MINUTE) {
        sent.push(t);
        return;
      }
      await sleep(60_000 - (t - sent[0]) + 50);
    }
  }

  async function request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    schema: z.ZodType<T> | null,
    init?: { query?: URLSearchParams; body?: unknown; v3?: boolean },
  ): Promise<T> {
    const url = `${init?.v3 ? BASE_V3 : BASE}${path}${init?.query ? `?${init.query.toString()}` : ""}`;
    for (let attempt = 0; ; attempt++) {
      await throttle();
      const res = await fetchImpl(url, {
        method,
        headers: {
          Authorization: opts.token,
          "Content-Type": "application/json",
        },
        body: init?.body === undefined ? undefined : JSON.stringify(init.body),
        cache: "no-store",
      });

      if (res.status === 429 && attempt < maxRetries) {
        const reset = Number(res.headers.get("x-ratelimit-reset"));
        const waitMs = Number.isFinite(reset) && reset > 0 ? Math.max(500, reset * 1000 - now()) : 2000 * (attempt + 1);
        await sleep(Math.min(waitMs, 60_000));
        continue;
      }
      if (res.status >= 500 && attempt < maxRetries) {
        await sleep(1000 * (attempt + 1));
        continue;
      }

      const text = await res.text();
      let json: unknown = undefined;
      try {
        json = text ? JSON.parse(text) : undefined;
      } catch {
        /* non-JSON body */
      }
      if (!res.ok) {
        const err = (json ?? {}) as { err?: string; message?: string; ECODE?: string };
        throw new ClickUpError(err.err ?? err.message ?? `ClickUp request failed (${res.status})`, res.status, err.ECODE);
      }
      if (!schema) return undefined as T;
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        throw new ClickUpError(`Unexpected ClickUp response for ${method} ${path.split("?")[0]}`, 502);
      }
      return parsed.data;
    }
  }

  return {
    getAuthorizedUser: () => request("GET", "/user", userSchema),
    getTeams: () => request("GET", "/team", teamsSchema),
    getSpaces: (teamId: string) =>
      request("GET", `/team/${encodeURIComponent(teamId)}/space`, spacesSchema, {
        query: new URLSearchParams({ archived: "false" }),
      }),
    getFolders: (spaceId: string) =>
      request("GET", `/space/${encodeURIComponent(spaceId)}/folder`, foldersSchema, {
        query: new URLSearchParams({ archived: "false" }),
      }),
    getFolderlessLists: (spaceId: string) =>
      request("GET", `/space/${encodeURIComponent(spaceId)}/list`, listsSchema, {
        query: new URLSearchParams({ archived: "false" }),
      }),
    getTask: (taskId: string) =>
      request("GET", `/task/${encodeURIComponent(taskId)}`, taskSchema, {
        query: new URLSearchParams({ include_markdown_description: "true" }),
      }),
    getTeamTasks: (teamId: string, q: TeamTasksQuery) => {
      const query = new URLSearchParams({
        page: String(q.page ?? 0),
        subtasks: "true",
        include_closed: String(q.includeClosed ?? false),
        include_markdown_description: String(q.withDescriptions ?? false),
        order_by: "updated",
        reverse: "true",
      });
      for (const id of q.spaceIds) query.append("space_ids[]", id);
      for (const st of q.statuses ?? []) query.append("statuses[]", st);
      for (const id of q.listIds ?? []) query.append("list_ids[]", id);
      for (const id of q.assignees ?? []) query.append("assignees[]", id);
      if (q.dateUpdatedGtMs) query.set("date_updated_gt", String(q.dateUpdatedGtMs));
      if (q.dueDateLtMs) query.set("due_date_lt", String(q.dueDateLtMs));
      if (q.dueDateGtMs) query.set("due_date_gt", String(q.dueDateGtMs));
      return request("GET", `/team/${encodeURIComponent(teamId)}/task`, tasksPageSchema, { query });
    },
    getTaskComments: (taskId: string) => request("GET", `/task/${encodeURIComponent(taskId)}/comment`, commentsSchema),
    // --- writes: only called after the owner approved (or for drafts in the drafts list) ---
    createTask: (listId: string, task: NewTask) =>
      request("POST", `/list/${encodeURIComponent(listId)}/task`, createdTaskSchema, { body: { ...task, notify_all: false } }),
    updateTask: (taskId: string, change: TaskChange) =>
      request("PUT", `/task/${encodeURIComponent(taskId)}`, createdTaskSchema, { body: change }),
    deleteTask: (taskId: string) => request("DELETE", `/task/${encodeURIComponent(taskId)}`, null),
    createComment: (taskId: string, text: string) =>
      request("POST", `/task/${encodeURIComponent(taskId)}/comment`, commentCreatedSchema, {
        body: { comment_text: text, notify_all: false },
      }),
    // --- chat (v3): DMs to workspace members, e.g. "Mission Control" ---
    openDirectMessage: (teamId: string, userId: string) =>
      request("POST", `/workspaces/${encodeURIComponent(teamId)}/chat/channels/direct_message`, chatChannelSchema, {
        body: { user_ids: [userId] },
        v3: true,
      }),
    sendChatMessage: (teamId: string, channelId: string, text: string) =>
      request("POST", `/workspaces/${encodeURIComponent(teamId)}/chat/channels/${encodeURIComponent(channelId)}/messages`, z.object({ id: z.coerce.string() }).passthrough(), {
        body: { type: "message", content: text, content_format: "text/plain" },
        v3: true,
      }),
    getChatMessages: (teamId: string, channelId: string, limit = 10) =>
      request("GET", `/workspaces/${encodeURIComponent(teamId)}/chat/channels/${encodeURIComponent(channelId)}/messages`, chatMessagesSchema, {
        query: new URLSearchParams({ limit: String(limit) }),
        v3: true,
      }),
    getList: (listId: string) => request("GET", `/list/${encodeURIComponent(listId)}`, listDetailSchema),
    getListFields: (listId: string) => request("GET", `/list/${encodeURIComponent(listId)}/field`, listFieldsSchema),
    getFolder: (folderId: string) =>
      request("GET", `/folder/${encodeURIComponent(folderId)}`, z.object({ id: z.coerce.string(), space: z.object({ id: z.coerce.string() }) })),
    // --- checklists (drafts only, or after approval) ---
    createChecklist: (taskId: string, name: string) =>
      request("POST", `/task/${encodeURIComponent(taskId)}/checklist`, z.object({ checklist: z.object({ id: z.coerce.string() }) }), { body: { name } }),
    createChecklistItem: (checklistId: string, name: string) =>
      request("POST", `/checklist/${encodeURIComponent(checklistId)}/checklist_item`, null, { body: { name } }),
    deleteChecklist: (checklistId: string) => request("DELETE", `/checklist/${encodeURIComponent(checklistId)}`, null),
    setCustomField: (taskId: string, fieldId: string, value: unknown) =>
      request("POST", `/task/${encodeURIComponent(taskId)}/field/${encodeURIComponent(fieldId)}`, null, { body: { value } }),
    // --- task templates ---
    getTaskTemplates: (teamId: string, page = 0) =>
      request("GET", `/team/${encodeURIComponent(teamId)}/taskTemplate`, taskTemplatesSchema, {
        query: new URLSearchParams({ page: String(page) }),
      }),
    createTaskFromTemplate: async (listId: string, templateId: string, name: string) => {
      const res = await request(
        "POST",
        `/list/${encodeURIComponent(listId)}/taskTemplate/${encodeURIComponent(templateId)}`,
        z.object({ id: z.coerce.string().nullish(), task: z.object({ id: z.coerce.string() }).passthrough().nullish() }).passthrough(),
        { body: { name } },
      );
      const id = res.id ?? res.task?.id;
      if (!id) throw new ClickUpError("ClickUp did not return the new task id", 502);
      return { id };
    },
    /** v3: moves a task to another home list (keeps subtasks/checklists); maps the status by id. */
    moveTask: (teamId: string, taskId: string, listId: string, statusMapping?: { from: string; to: string }) =>
      request(
        "PUT",
        `/workspaces/${encodeURIComponent(teamId)}/tasks/${encodeURIComponent(taskId)}/home_list/${encodeURIComponent(listId)}`,
        null,
        {
          v3: true,
          body: {
            move_custom_fields: false,
            ...(statusMapping ? { status_mappings: [{ source_status: statusMapping.from, destination_status: statusMapping.to }] } : {}),
          },
        },
      ),
    // --- docs (v3) ---
    searchDocs: (teamId: string, cursor?: string) =>
      request("GET", `/workspaces/${encodeURIComponent(teamId)}/docs`, docsPageSchema, {
        v3: true,
        query: new URLSearchParams({ limit: "100", deleted: "false", archived: "false", ...(cursor ? { cursor } : {}) }),
      }),
    getDocPages: (teamId: string, docId: string) =>
      request("GET", `/workspaces/${encodeURIComponent(teamId)}/docs/${encodeURIComponent(docId)}/pages`, docPagesSchema, {
        v3: true,
        query: new URLSearchParams({ max_page_depth: "-1", content_format: "text/md" }),
      }),
    createList: (spaceId: string, name: string) =>
      request("POST", `/space/${encodeURIComponent(spaceId)}/list`, z.object({ id: z.coerce.string(), name: z.string() }), {
        body: { name },
      }),
  };
}

export type ClickUpClient = ReturnType<typeof createClickUpClient>;
