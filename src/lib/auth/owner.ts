import "server-only";

import { headers } from "next/headers";

import { auth } from "@/lib/auth";

import { decideOwner, type OwnerDecision } from "./owner-rules";

export type OwnerCheck =
  | { ok: true; userId: string; displayName: string }
  | { ok: false; reason: "signed_out" | Extract<OwnerDecision, { allowed: false }>["reason"] };

/**
 * Checks that the current request belongs to the single owner of this instance.
 * Call this in EVERY page, server action and route handler that touches data —
 * the proxy only checks that a session cookie exists, not that it is valid.
 */
export async function checkOwner(): Promise<OwnerCheck> {
  const result = await auth.api.getSession({ headers: await headers() });
  if (!result) return { ok: false, reason: "signed_out" };
  const { user } = result;

  const decision = decideOwner(
    { userId: user.id, emails: [{ address: user.email, verified: user.emailVerified }] },
    { ownerEmail: process.env.OWNER_EMAIL, ownerUserId: process.env.OWNER_USER_ID },
  );
  if (!decision.allowed) return { ok: false, reason: decision.reason };
  return { ok: true, userId: user.id, displayName: user.name.split(" ")[0] || "there" };
}

/** For route handlers: returns the owner's user id, or a 401/403 Response to return directly. */
export async function requireOwnerForRoute(): Promise<
  { ok: true; userId: string } | { ok: false; response: Response }
> {
  const check = await checkOwner();
  if (check.ok) return { ok: true, userId: check.userId };
  const status = check.reason === "signed_out" ? 401 : 403;
  return {
    ok: false,
    response: Response.json({ error: status === 401 ? "unauthorized" : "forbidden" }, { status }),
  };
}
