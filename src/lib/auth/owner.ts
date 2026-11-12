import "server-only";

import { auth, currentUser } from "@clerk/nextjs/server";

import { decideOwner, type OwnerDecision } from "./owner-rules";

export type OwnerCheck =
  | { ok: true; userId: string; displayName: string }
  | { ok: false; reason: "signed_out" | Extract<OwnerDecision, { allowed: false }>["reason"] };

function ownerConfig() {
  return {
    ownerEmail: process.env.OWNER_EMAIL,
    ownerUserId: process.env.OWNER_USER_ID,
  };
}

/**
 * Checks that the current request belongs to the single owner of this instance.
 * Call this in EVERY page, server action and route handler that touches data —
 * the proxy only checks that someone is signed in, not that it is the owner.
 */
export async function checkOwner(): Promise<OwnerCheck> {
  const { userId } = await auth();
  if (!userId) return { ok: false, reason: "signed_out" };

  const user = await currentUser();
  if (!user) return { ok: false, reason: "signed_out" };

  const decision = decideOwner(
    {
      userId,
      emails: user.emailAddresses.map((e) => ({
        address: e.emailAddress,
        verified: e.verification?.status === "verified",
      })),
    },
    ownerConfig(),
  );

  if (!decision.allowed) return { ok: false, reason: decision.reason };
  return { ok: true, userId, displayName: user.firstName ?? "there" };
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
