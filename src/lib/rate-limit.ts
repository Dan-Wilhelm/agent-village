import "server-only";

import { sql } from "drizzle-orm";

import { getDb } from "@/db";
import { appRateLimits } from "@/db/schema";

/**
 * App-level rate limits (single owner, so buckets are global per action).
 * They cap runaway cost/abuse if a session were ever stolen or a page loops.
 */
export const LIMITS = {
  agentTurn: { limit: 120, windowSec: 600 }, // conversation turns (each can run up to 12 model calls)
  proposal: { limit: 120, windowSec: 600 }, // approve / reject
  dispatch: { limit: 60, windowSec: 600 }, // "I want to …"
  suggestAgent: { limit: 20, windowSec: 3600 }, // wizard "Fill in for me"
  authoring: { limit: 60, windowSec: 3600 }, // create / edit / archive / copy
  pushTest: { limit: 10, windowSec: 3600 },
  readHeavy: { limit: 600, windowSec: 600 }, // HQ pages, visits polling, activity
} as const;
export type LimitName = keyof typeof LIMITS;

export class RateLimitError extends Error {
  constructor(readonly retryAfterSec: number) {
    super("Too many requests — please wait a moment.");
    this.name = "RateLimitError";
  }
}

/** Counts one request; throws RateLimitError when the bucket is full. */
export async function hitRateLimit(name: LimitName) {
  const { limit, windowSec } = LIMITS[name];
  const [row] = await getDb()
    .insert(appRateLimits)
    .values({ key: name, count: 1 })
    .onConflictDoUpdate({
      target: appRateLimits.key,
      set: {
        count: sql`CASE WHEN ${appRateLimits.windowStart} < now() - make_interval(secs => ${windowSec}) THEN 1 ELSE ${appRateLimits.count} + 1 END`,
        windowStart: sql`CASE WHEN ${appRateLimits.windowStart} < now() - make_interval(secs => ${windowSec}) THEN now() ELSE ${appRateLimits.windowStart} END`,
      },
    })
    .returning({ count: appRateLimits.count, windowStart: appRateLimits.windowStart });
  if (row.count > limit) {
    const retry = Math.max(1, Math.ceil((row.windowStart.getTime() + windowSec * 1000 - Date.now()) / 1000));
    throw new RateLimitError(retry);
  }
}

/** For route handlers: a 429 Response, or null if the request may proceed. */
export async function rateLimitResponse(name: LimitName): Promise<Response | null> {
  try {
    await hitRateLimit(name);
    return null;
  } catch (err) {
    if (err instanceof RateLimitError) {
      return Response.json({ error: err.message }, { status: 429, headers: { "Retry-After": String(err.retryAfterSec) } });
    }
    throw err;
  }
}
