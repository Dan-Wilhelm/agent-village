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
});
export type ClickUpTask = z.infer<typeof taskSchema>;

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
};

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
    init?: { query?: URLSearchParams; body?: unknown },
  ): Promise<T> {
    const url = `${BASE}${path}${init?.query ? `?${init.query.toString()}` : ""}`;
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
        const err = (json ?? {}) as { err?: string; ECODE?: string };
        throw new ClickUpError(err.err ?? `ClickUp request failed (${res.status})`, res.status, err.ECODE);
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
      if (q.dateUpdatedGtMs) query.set("date_updated_gt", String(q.dateUpdatedGtMs));
      return request("GET", `/team/${encodeURIComponent(teamId)}/task`, tasksPageSchema, { query });
    },
    getTaskComments: (taskId: string) => request("GET", `/task/${encodeURIComponent(taskId)}/comment`, commentsSchema),
  };
}

export type ClickUpClient = ReturnType<typeof createClickUpClient>;
