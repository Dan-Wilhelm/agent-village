import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { ClickUpError, createClickUpClient, taskSchema } from "@/integrations/clickup/client";
import { isOpenTask, mapTask, maxUpdatedMs } from "@/integrations/clickup/mapping";
import { safeEqual, verifyClickUpSignature, webhookEndpoint } from "@/integrations/clickup/webhook";

const task = (over: Record<string, unknown> = {}) => ({
  id: "abc",
  name: "Static ad brief",
  status: { status: "client review", type: "custom", color: "#ff0" },
  priority: { id: "2", priority: "high" },
  due_date: "1767225600000",
  start_date: null,
  date_created: "1767000000000",
  date_updated: "1767100000000",
  date_closed: null,
  assignees: [{ id: 7, username: "Dan", initials: "D", color: "#123" }],
  tags: [{ name: "ads" }],
  url: "https://app.clickup.com/t/abc",
  parent: null,
  archived: false,
  list: { id: "L1" },
  folder: { id: "F1", hidden: false },
  space: { id: "S1" },
  markdown_description: "Hello **world**",
  ...over,
});

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

describe("ClickUp client", () => {
  it("sends the raw personal token (no Bearer) and parses the user", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ user: { id: 1, username: "dan", email: "d@x.de" } }));
    const c = createClickUpClient({ token: "pk_1_ABC", fetchImpl: fetchImpl as unknown as typeof fetch });
    const res = await c.getAuthorizedUser();
    expect(res.user.id).toBe("1");
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("pk_1_ABC");
  });

  it("waits and retries on 429, then succeeds", async () => {
    const sleep = vi.fn(async () => {});
    let calls = 0;
    const fetchImpl = vi.fn(async () => (++calls === 1 ? jsonResponse({ err: "rate" }, 429, { "x-ratelimit-reset": "0" }) : jsonResponse({ teams: [] })));
    const c = createClickUpClient({ token: "pk", fetchImpl: fetchImpl as unknown as typeof fetch, sleep });
    await expect(c.getTeams()).resolves.toEqual({ teams: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalled();
  });

  it("throws ClickUpError with status on auth failure and never includes the token", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ err: "Token invalid", ECODE: "OAUTH_025" }, 401));
    const c = createClickUpClient({ token: "pk_SECRET", fetchImpl: fetchImpl as unknown as typeof fetch });
    const err = await c.getAuthorizedUser().catch((e) => e);
    expect(err).toBeInstanceOf(ClickUpError);
    expect(err.status).toBe(401);
    expect(String(err.message)).not.toContain("pk_SECRET");
  });

  it("builds the team task query with space ids and cursor", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ tasks: [task()], last_page: true }));
    const c = createClickUpClient({ token: "pk", fetchImpl: fetchImpl as unknown as typeof fetch });
    await c.getTeamTasks("T1", { spaceIds: ["S1", "S2"], page: 2, includeClosed: true, dateUpdatedGtMs: 123 });
    const url = new URL((fetchImpl.mock.calls[0] as unknown as [string])[0]);
    expect(url.pathname).toBe("/api/v2/team/T1/task");
    expect(url.searchParams.getAll("space_ids[]")).toEqual(["S1", "S2"]);
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("include_closed")).toBe("true");
    expect(url.searchParams.get("date_updated_gt")).toBe("123");
  });

  it("throttles itself below 100 requests per minute", async () => {
    let t = 0;
    const sleep = vi.fn(async (ms: number) => {
      t += ms;
    });
    const fetchImpl = vi.fn(async () => jsonResponse({ teams: [] }));
    const c = createClickUpClient({ token: "pk", fetchImpl: fetchImpl as unknown as typeof fetch, sleep, now: () => t });
    for (let i = 0; i < 95; i++) await c.getTeams();
    expect(sleep).toHaveBeenCalled(); // request 91+ had to wait for the window
    expect(t).toBeGreaterThanOrEqual(60_000);
  });
});

describe("mapping", () => {
  it("maps a task to a row", () => {
    const row = mapTask(taskSchema.parse(task()));
    expect(row).toMatchObject({ id: "abc", listId: "L1", folderId: "F1", spaceId: "S1", status: "client review", priority: 2, tags: ["ads"] });
    expect(row.dueAt?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(row.assignees[0]).toMatchObject({ id: "7", username: "Dan" });
  });

  it("treats hidden folders as folderless lists", () => {
    expect(mapTask(taskSchema.parse(task({ folder: { id: "F9", hidden: true } }))).folderId).toBeNull();
  });

  it("detects closed and archived tasks", () => {
    expect(isOpenTask(task() as never)).toBe(true);
    expect(isOpenTask(task({ status: { status: "complete", type: "closed" } }) as never)).toBe(false);
    expect(isOpenTask(task({ archived: true }) as never)).toBe(false);
    expect(isOpenTask(task({ date_closed: 5 }) as never)).toBe(false);
  });

  it("tracks the highest date_updated", () => {
    expect(maxUpdatedMs([{ date_updated: 5 }, { date_updated: 9 }] as never, 7)).toBe(9);
    expect(maxUpdatedMs([], 7)).toBe(7);
  });
});

describe("webhook security", () => {
  const body = JSON.stringify({ event: "taskUpdated", webhook_id: "w1", task_id: "abc" });
  const sig = createHmac("sha256", "s3cret").update(body).digest("hex");

  it("accepts a valid signature and rejects tampering, wrong secrets and junk", () => {
    expect(verifyClickUpSignature(body, sig, "s3cret")).toBe(true);
    expect(verifyClickUpSignature(body + " ", sig, "s3cret")).toBe(false);
    expect(verifyClickUpSignature(body, sig, "other")).toBe(false);
    expect(verifyClickUpSignature(body, null, "s3cret")).toBe(false);
    expect(verifyClickUpSignature(body, "zz", "s3cret")).toBe(false);
  });

  it("compares bearer secrets safely", () => {
    expect(safeEqual("Bearer a", "Bearer a")).toBe(true);
    expect(safeEqual("Bearer a", "Bearer b")).toBe(false);
    expect(safeEqual("short", "longer value")).toBe(false);
  });

  it("only registers webhooks for public https deployments", () => {
    expect(webhookEndpoint({ VERCEL_PROJECT_PRODUCTION_URL: "agent-village-green.vercel.app" })).toBe(
      "https://agent-village-green.vercel.app/api/webhooks/clickup",
    );
    expect(webhookEndpoint({ APP_BASE_URL: "http://localhost:3000" })).toBeNull();
    expect(webhookEndpoint({})).toBeNull();
  });
});
