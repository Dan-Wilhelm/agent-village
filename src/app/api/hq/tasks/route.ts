import { requireOwnerForRoute } from "@/lib/auth/owner";
import { ClickUpError } from "@/integrations/clickup/client";
import { fetchTaskPages, getClickUpAccount, MAX_TASK_PAGES } from "@/integrations/clickup/account";
import { hierarchyFromTasks, toHqTask } from "@/integrations/clickup/mapping";
import { rateLimitResponse } from "@/lib/rate-limit";

/**
 * GET /api/hq/tasks?start=0&count=6 — one slice of open tasks for ClickUp HQ,
 * read live from ClickUp and returned to the owner. Nothing is stored.
 * (A route handler, not a server action, so the browser can load slices in parallel.)
 */
export async function GET(request: Request) {
  const owner = await requireOwnerForRoute();
  if (!owner.ok) return owner.response;
  const limited = await rateLimitResponse("readHeavy");
  if (limited) return limited;

  const url = new URL(request.url);
  const start = Number(url.searchParams.get("start") ?? "0");
  const count = Number(url.searchParams.get("count") ?? "6");
  if (!Number.isInteger(start) || !Number.isInteger(count) || start < 0 || start >= MAX_TASK_PAGES || count < 1 || count > 8) {
    return Response.json({ error: "bad range" }, { status: 400 });
  }

  const account = await getClickUpAccount();
  if (!account) return Response.json({ error: "not connected" }, { status: 409 });
  try {
    const { tasks, done } = await fetchTaskPages(account, start, Math.min(count, MAX_TASK_PAGES - start));
    const { lists, folders } = hierarchyFromTasks(tasks);
    return Response.json(
      { tasks: tasks.map(toHqTask), lists, folders, done },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const status = err instanceof ClickUpError ? err.status : 502;
    return Response.json({ error: "clickup", status }, { status: 502 });
  }
}
