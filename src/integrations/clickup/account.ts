import "server-only";

import { eq } from "drizzle-orm";

import { getDb, schema } from "@/db";
import { decryptSecret, secretContext } from "@/lib/crypto/secrets";

import { createClickUpClient, type ClickUpClient, type ClickUpTask } from "./client";
import { isOpenTask } from "./mapping";

export type ClickUpAccount = typeof schema.integrationAccounts.$inferSelect;

/** The single ClickUp connection of the default workspace (MVP), or null. Holds no task data. */
export async function getClickUpAccount(): Promise<ClickUpAccount | null> {
  const rows = await getDb()
    .select()
    .from(schema.integrationAccounts)
    .where(eq(schema.integrationAccounts.provider, "clickup"))
    .limit(1);
  return rows[0] ?? null;
}

/** API client with the decrypted token (kept in memory for this request only). */
export function clientFor(account: ClickUpAccount): ClickUpClient {
  const token = decryptSecret(account.tokenCiphertext, secretContext.clickupToken(account.id));
  return createClickUpClient({ token });
}

export const MAX_TASK_PAGES = 40; // 100 tasks per page

/**
 * A range of task pages of the allowed spaces, read LIVE from ClickUp in
 * parallel (nothing is stored). `done` is true once the last page was reached.
 */
export async function fetchTaskPages(
  account: ClickUpAccount,
  start: number,
  count: number,
): Promise<{ tasks: ClickUpTask[]; done: boolean }> {
  if (!account.teamId || account.selectedSpaceIds.length === 0) return { tasks: [], done: true };
  const client = clientFor(account);
  const pages = await Promise.all(
    Array.from({ length: count }, (_, i) =>
      client.getTeamTasks(account.teamId!, { spaceIds: account.selectedSpaceIds, page: start + i }),
    ),
  );
  const tasks: ClickUpTask[] = [];
  let done = start + count >= MAX_TASK_PAGES;
  for (const page of pages) {
    tasks.push(...page.tasks);
    if (page.last_page !== false || page.tasks.length === 0) {
      done = true;
      break;
    }
  }
  return { tasks: tasks.filter(isOpenTask), done };
}
